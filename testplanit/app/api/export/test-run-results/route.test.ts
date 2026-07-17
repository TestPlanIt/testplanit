import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/recordKeyConfig", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/recordKeyConfig")>();
  return {
    ...actual,
    readRecordKeyConfig: async () => ({
      enabled: false,
      tokens: actual.DEFAULT_TYPE_TOKENS,
    }),
  };
});

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("~/lib/zenstack", () => ({
  getAuthDb: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
    testRunResults: { findMany: vi.fn() },
  },
}));

import { getAuthDb } from "~/lib/zenstack";
import { authenticateRequest } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { GET } from "./route";

async function readNdjson(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"), { headers });
}

const ADMIN_USER = { userId: "admin-1", access: "ADMIN" } as const;
const PROJECT_USER = { userId: "user-1", access: null } as const;

function buildResultRow(
  id: number,
  executedAt: Date,
  overrides: Record<string, unknown> = {}
): unknown {
  return {
    id,
    testRunId: 10,
    testRunCaseId: 20 + id,
    executedAt,
    executedById: "exec-1",
    elapsed: 250,
    attempt: 1,
    iterationId: null,
    editedAt: null,
    editedById: null,
    statusId: 5,
    status: { name: "Passed", isSuccess: true, isFailure: false },
    testRun: { projectId: 100 },
    testRunCase: { repositoryCaseId: 200 + id },
    ...overrides,
  };
}

describe("GET /api/export/test-run-results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("auth", () => {
    it("returns 401 when authenticateRequest fails", async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        authenticated: false,
        error: "Unauthorized",
        status: 401,
      });
      const res = await GET(req("/api/export/test-run-results"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("returns 400 when non-admin omits projectId", async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        authenticated: true,
        user: PROJECT_USER,
      });
      const res = await GET(req("/api/export/test-run-results"));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/projectId is required/);
    });

    it("returns 403 when non-admin has no access to the project", async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        authenticated: true,
        user: PROJECT_USER,
      });
      vi.mocked(baseDb.user.findUnique).mockResolvedValue({
        id: "user-1",
      } as never);
      vi.mocked(getAuthDb).mockReturnValue({
        projects: { findFirst: vi.fn().mockResolvedValue(null) },
      } as never);

      const res = await GET(req("/api/export/test-run-results?projectId=100"));
      expect(res.status).toBe(403);
    });
  });

  describe("streaming", () => {
    beforeEach(() => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        authenticated: true,
        user: ADMIN_USER,
      });
    });

    it("streams NDJSON with a manifest, rows, and an end trailer", async () => {
      const t1 = new Date("2026-05-01T10:00:00.000Z");
      const t2 = new Date("2026-05-01T10:00:01.000Z");
      vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([
        buildResultRow(1, t1),
        buildResultRow(2, t2),
      ] as never);

      const res = await GET(req("/api/export/test-run-results?pageSize=10"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(
        "application/x-ndjson; charset=utf-8"
      );

      const lines = (await readNdjson(res)) as Array<Record<string, unknown>>;
      expect(lines).toHaveLength(4);
      expect(lines[0]).toMatchObject({
        type: "manifest",
        resource: "test-run-results",
        schemaVersion: 1,
        pageSize: 10,
        projectId: null,
      });
      expect(lines[1]).toMatchObject({
        id: 1,
        testCaseId: 201,
        projectId: 100,
        statusName: "Passed",
        isPass: true,
        executedAt: t1.toISOString(),
      });
      expect(lines[2]).toMatchObject({ id: 2 });
      // page (2 rows) < pageSize (10) → no continuation cursor
      expect(lines[3]).toEqual({ type: "end", count: 2, cursor: null });
    });

    it("emits a continuation cursor when the page is full", async () => {
      const ts = new Date("2026-05-01T10:00:00.000Z");
      const rows = Array.from({ length: 3 }, (_, i) =>
        buildResultRow(i + 1, ts)
      );
      vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue(
        rows as never
      );

      const res = await GET(req("/api/export/test-run-results?pageSize=3"));
      const lines = (await readNdjson(res)) as Array<Record<string, unknown>>;

      const trailer = lines[lines.length - 1] as {
        type: string;
        count: number;
        cursor: string;
      };
      expect(trailer.type).toBe("end");
      expect(trailer.count).toBe(3);
      expect(typeof trailer.cursor).toBe("string");

      const decoded = JSON.parse(
        Buffer.from(trailer.cursor, "base64url").toString("utf-8")
      );
      expect(decoded).toEqual({ k: ts.toISOString(), i: 3 });
    });

    it("applies the `since` filter to executedAt", async () => {
      vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([] as never);
      await GET(
        req(
          "/api/export/test-run-results?since=2026-05-01T00:00:00Z&pageSize=100"
        )
      );

      const call = vi.mocked(baseDb.testRunResults.findMany).mock.calls[0]![0]!;
      expect(
        (
          call.where as { executedAt: { gte: Date } }
        ).executedAt.gte.toISOString()
      ).toBe("2026-05-01T00:00:00.000Z");
    });

    it("applies the decoded cursor as a strict forward filter", async () => {
      vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([] as never);
      const cursor = Buffer.from(
        JSON.stringify({ k: "2026-05-01T10:00:00.000Z", i: 42 })
      ).toString("base64url");

      await GET(
        req(`/api/export/test-run-results?cursor=${cursor}&pageSize=100`)
      );

      const call = vi.mocked(baseDb.testRunResults.findMany).mock.calls[0]![0]!;
      const orClause = (call.where as { OR: unknown[] }).OR;
      expect(orClause).toEqual([
        { executedAt: { gt: new Date("2026-05-01T10:00:00.000Z") } },
        { executedAt: new Date("2026-05-01T10:00:00.000Z"), id: { gt: 42 } },
      ]);
    });

    it("ignores malformed cursors without 400ing", async () => {
      vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([] as never);
      await GET(req("/api/export/test-run-results?cursor=not-a-cursor"));
      const call = vi.mocked(baseDb.testRunResults.findMany).mock.calls[0]![0]!;
      expect((call.where as { OR?: unknown }).OR).toBeUndefined();
    });

    it("clamps pageSize to the upper bound", async () => {
      vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([] as never);
      await GET(req("/api/export/test-run-results?pageSize=99999"));
      const call = vi.mocked(baseDb.testRunResults.findMany).mock.calls[0]![0]!;
      expect(call.take).toBe(5000);
    });

    it("filters by projectId when supplied by an admin", async () => {
      vi.mocked(baseDb.testRunResults.findMany).mockResolvedValue([] as never);
      await GET(req("/api/export/test-run-results?projectId=42"));
      const call = vi.mocked(baseDb.testRunResults.findMany).mock.calls[0]![0]!;
      expect((call.where as { testRun: unknown }).testRun).toEqual({
        projectId: 42,
        isDeleted: false,
      });
    });
  });
});
