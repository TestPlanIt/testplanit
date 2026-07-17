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
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/api-token-auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("~/lib/zenstack", () => ({ getAuthDb: vi.fn() }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
    repositoryCases: { findMany: vi.fn() },
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

function req(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"));
}

const ADMIN_USER = { userId: "admin-1", access: "ADMIN" } as const;
const PROJECT_USER = { userId: "user-1", access: null } as const;

function buildCaseRow(
  id: number,
  createdAt: Date,
  overrides: Record<string, unknown> = {}
): unknown {
  return {
    id,
    projectId: 100,
    folderId: 50,
    templateId: 3,
    stateId: 1,
    name: `Case ${id}`,
    className: null,
    source: "MANUAL",
    automated: false,
    hasParameters: false,
    isArchived: false,
    estimate: null,
    forecastManual: null,
    forecastAutomated: null,
    currentVersion: 1,
    createdAt,
    creatorId: "creator-1",
    ...overrides,
  };
}

describe("GET /api/export/repository-cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    });
    const res = await GET(req("/api/export/repository-cases"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin without projectId", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: PROJECT_USER,
    });
    const res = await GET(req("/api/export/repository-cases"));
    expect(res.status).toBe(400);
  });

  it("enforces project access for non-admin", async () => {
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
    const res = await GET(req("/api/export/repository-cases?projectId=100"));
    expect(res.status).toBe(403);
  });

  it("streams cases with manifest and trailer", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    const t1 = new Date("2026-05-01T10:00:00.000Z");
    vi.mocked(baseDb.repositoryCases.findMany).mockResolvedValue([
      buildCaseRow(1, t1, { hasParameters: true }),
      buildCaseRow(2, t1),
    ] as never);

    const res = await GET(req("/api/export/repository-cases?pageSize=10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8"
    );

    const lines = (await readNdjson(res)) as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({
      type: "manifest",
      resource: "repository-cases",
      pageSize: 10,
    });
    expect(lines[1]).toMatchObject({
      id: 1,
      name: "Case 1",
      hasParameters: true,
      createdAt: t1.toISOString(),
    });
    expect(lines[3]).toEqual({ type: "end", count: 2, cursor: null });
  });

  it("emits a continuation cursor when the page fills up", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    const ts = new Date("2026-05-01T00:00:00.000Z");
    const rows = Array.from({ length: 3 }, (_, i) => buildCaseRow(i + 1, ts));
    vi.mocked(baseDb.repositoryCases.findMany).mockResolvedValue(rows as never);

    const res = await GET(req("/api/export/repository-cases?pageSize=3"));
    const lines = (await readNdjson(res)) as Array<Record<string, unknown>>;
    const trailer = lines[lines.length - 1] as {
      type: string;
      cursor: string;
    };
    const decoded = JSON.parse(
      Buffer.from(trailer.cursor, "base64url").toString("utf-8")
    );
    expect(decoded).toEqual({ k: ts.toISOString(), i: 3 });
  });

  it("applies projectId filter when admin supplies it", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    vi.mocked(baseDb.repositoryCases.findMany).mockResolvedValue([] as never);
    await GET(req("/api/export/repository-cases?projectId=99"));
    const call = vi.mocked(baseDb.repositoryCases.findMany).mock.calls[0]![0]!;
    expect((call.where as { projectId: number }).projectId).toBe(99);
  });

  it("applies the since filter on createdAt", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    vi.mocked(baseDb.repositoryCases.findMany).mockResolvedValue([] as never);
    await GET(req("/api/export/repository-cases?since=2026-01-01T00:00:00Z"));
    const call = vi.mocked(baseDb.repositoryCases.findMany).mock.calls[0]![0]!;
    expect(
      (call.where as { createdAt: { gte: Date } }).createdAt.gte.toISOString()
    ).toBe("2026-01-01T00:00:00.000Z");
  });
});
