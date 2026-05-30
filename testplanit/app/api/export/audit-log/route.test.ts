import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/api-token-auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("@zenstackhq/runtime", () => ({ enhance: vi.fn() }));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}));

import { enhance } from "@zenstackhq/runtime";
import { authenticateRequest } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
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

function buildAuditRow(id: string, timestamp: Date): unknown {
  return {
    id,
    timestamp,
    action: "CREATE",
    entityType: "TestRunResults",
    entityId: "42",
    entityName: "Smoke test",
    userId: "creator-1",
    userEmail: "c@example.com",
    userName: "Creator One",
    projectId: 100,
    changes: { status: { old: null, new: "PASSED" } },
    metadata: { ip: "127.0.0.1" },
  };
}

describe("GET /api/export/audit-log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    });
    const res = await GET(req("/api/export/audit-log"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin without projectId", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: PROJECT_USER,
    });
    const res = await GET(req("/api/export/audit-log"));
    expect(res.status).toBe(400);
  });

  it("enforces project access for non-admin", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: PROJECT_USER,
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
    } as never);
    vi.mocked(enhance).mockReturnValue({
      projects: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    const res = await GET(req("/api/export/audit-log?projectId=100"));
    expect(res.status).toBe(403);
  });

  it("streams audit rows with manifest and trailer", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    const t1 = new Date("2026-05-01T10:00:00.000Z");
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      buildAuditRow("audit-a", t1),
      buildAuditRow("audit-b", t1),
    ] as never);

    const res = await GET(req("/api/export/audit-log?pageSize=10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8"
    );

    const lines = (await readNdjson(res)) as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({
      type: "manifest",
      resource: "audit-log",
    });
    expect(lines[1]).toMatchObject({
      id: "audit-a",
      action: "CREATE",
      entityType: "TestRunResults",
      timestamp: t1.toISOString(),
      changes: { status: { old: null, new: "PASSED" } },
    });
    expect(lines[3]).toEqual({ type: "end", count: 2, cursor: null });
  });

  it("emits a continuation cursor with a string id when the page is full", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: ADMIN_USER,
    });
    const ts = new Date("2026-05-01T00:00:00.000Z");
    const rows = ["audit-a", "audit-b", "audit-c"].map((id) =>
      buildAuditRow(id, ts)
    );
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue(rows as never);

    const res = await GET(req("/api/export/audit-log?pageSize=3"));
    const lines = (await readNdjson(res)) as Array<Record<string, unknown>>;
    const trailer = lines[lines.length - 1] as {
      type: string;
      cursor: string;
    };
    const decoded = JSON.parse(
      Buffer.from(trailer.cursor, "base64url").toString("utf-8")
    );
    expect(decoded).toEqual({ k: ts.toISOString(), i: "audit-c" });
  });
});
