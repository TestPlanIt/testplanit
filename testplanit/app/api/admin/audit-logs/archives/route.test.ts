import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const mockAuthenticateRequest = vi.fn();
const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockFindUnique = vi.fn();
const mockS3Send = vi.fn();
const mockCaptureAuditEvent = vi.fn();
const mockGetCurrentTenantId = vi.fn();
const mockGetTenantConfig = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetSession(),
}));
vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));
vi.mock("~/server/db", () => ({
  db: {
    auditLogArchive: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));
vi.mock("~/lib/s3Client", () => ({
  getS3Client: () => ({ send: (...args: unknown[]) => mockS3Send(...args) }),
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: () => mockGetCurrentTenantId(),
  getTenantConfig: (id: string) => mockGetTenantConfig(id),
}));
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => mockCaptureAuditEvent(...args),
}));

import { GET as GET_ONE } from "./[id]/route";
import { GET as LIST } from "./route";

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function asAdmin() {
  mockGetSession.mockResolvedValue({
    user: { id: "admin-1", access: "ADMIN", email: "a@x.io", name: "Ada" },
  });
  mockAuthenticateRequest.mockResolvedValue({
    authenticated: true,
    user: { userId: "admin-1", access: "ADMIN" },
  });
}

const archive = {
  id: 7,
  bucket: "archive-bucket",
  key: "audit-log-archive/2026/01/20260101T000000000Z-abc-0123456789ab.ndjson.gz",
  periodStart: new Date("2026-01-01T00:00:00Z"),
  firstTimestamp: new Date("2026-01-01T00:00:00Z"),
  lastTimestamp: new Date("2026-01-31T23:00:00Z"),
  rowCount: 100,
  byteSize: 2048,
  sha256: "f".repeat(64),
  createdAt: new Date("2026-10-10T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentTenantId.mockReturnValue(undefined);
  delete process.env.AUDIT_LOG_RETENTION_DAYS;
  delete process.env.AUDIT_LOG_RETENTION_MODE;
});

describe("GET /api/admin/audit-logs/archives", () => {
  it("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    });
    const res = await LIST(request("/api/admin/audit-logs/archives"));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects non-admins, including non-admin API tokens", async () => {
    mockGetSession.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "u1", access: "USER" },
    });
    const res = await LIST(request("/api/admin/audit-logs/archives"));
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("lists archives overlapping the range, oldest first", async () => {
    asAdmin();
    process.env.AUDIT_LOG_RETENTION_DAYS = "365";
    mockFindMany.mockResolvedValue([archive]);
    mockCount.mockResolvedValue(1);

    const res = await LIST(
      request(
        "/api/admin/audit-logs/archives?from=2026-01-15T00:00:00Z&to=2026-02-01T00:00:00Z&take=5000"
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      retention: { days: 365, mode: "archive" },
      total: 1,
      take: 1000,
    });
    expect(body.archives).toHaveLength(1);
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where).toEqual({
      lastTimestamp: { gte: new Date("2026-01-15T00:00:00Z") },
      firstTimestamp: { lte: new Date("2026-02-01T00:00:00Z") },
    });
    expect(args.orderBy).toEqual([{ firstTimestamp: "asc" }, { id: "asc" }]);
    expect(args.select.bucket).toBeUndefined();
    expect(args.select.key).toBeUndefined();
  });

  it("reports the serving tenant's own retention", async () => {
    asAdmin();
    process.env.AUDIT_LOG_RETENTION_DAYS = "365";
    mockGetCurrentTenantId.mockReturnValue("acme");
    mockGetTenantConfig.mockReturnValue({
      auditLogRetentionDays: 30,
      auditLogRetentionMode: "delete",
    });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const body = await (
      await LIST(request("/api/admin/audit-logs/archives"))
    ).json();

    expect(mockGetTenantConfig).toHaveBeenCalledWith("acme");
    expect(body.retention).toEqual({ days: 30, mode: "delete" });
  });

  it("rejects malformed dates", async () => {
    asAdmin();
    const res = await LIST(
      request("/api/admin/audit-logs/archives?from=not-a-date")
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/audit-logs/archives/:id", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("rejects non-admins", async () => {
    mockGetSession.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "u1", access: "USER" },
    });
    const res = await GET_ONE(request("/x"), params("7"));
    expect(res.status).toBe(403);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id", async () => {
    asAdmin();
    const res = await GET_ONE(request("/x"), params("7abc"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown archive", async () => {
    asAdmin();
    mockFindUnique.mockResolvedValue(null);
    const res = await GET_ONE(request("/x"), params("99"));
    expect(res.status).toBe(404);
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("streams the object and records the export", async () => {
    asAdmin();
    mockFindUnique.mockResolvedValue(archive);
    const bytes = new Uint8Array([31, 139, 8, 0]);
    mockS3Send.mockResolvedValue({
      Body: {
        transformToWebStream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      },
    });

    const res = await GET_ONE(request("/x"), params("7"));

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("content-type")).toBe("application/gzip");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="20260101T000000000Z-abc-0123456789ab.ndjson.gz"'
    );
    expect(res.headers.get("x-archive-sha256")).toBe(archive.sha256);
    expect(res.headers.get("x-archive-row-count")).toBe("100");
    expect(mockS3Send.mock.calls[0][0].input).toEqual({
      Bucket: "archive-bucket",
      Key: archive.key,
    });

    expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DATA_EXPORTED",
        entityType: "AuditLogArchive",
        entityId: "7",
        userId: "admin-1",
      })
    );
  });

  it("does not record an export when storage fails", async () => {
    asAdmin();
    mockFindUnique.mockResolvedValue(archive);
    mockS3Send.mockRejectedValue(new Error("NoSuchKey"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET_ONE(request("/x"), params("7"));

    expect(res.status).toBe(500);
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });
});
