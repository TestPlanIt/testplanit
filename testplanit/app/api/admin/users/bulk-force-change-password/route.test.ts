import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    user: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
  calculateDiff: vi.fn(),
}));

import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { POST } from "./route";

const mockGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockDb = vi.mocked(db);
const mockCaptureAuditEvent = vi.mocked(captureAuditEvent);

function makeAdminSession() {
  return { user: { id: "admin-1", access: "ADMIN", email: "admin@test.com" } } as any;
}

function makeRequest() {
  return new NextRequest(
    "http://localhost/api/admin/users/bulk-force-change-password",
    { method: "POST" }
  );
}

describe("POST /api/admin/users/bulk-force-change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
  });

  it("returns 401 when no session", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    } as any);

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
  });

  it("calls updateMany with authMethod IN [INTERNAL, BOTH] and mustChangePassword: false filter", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.updateMany.mockResolvedValue({ count: 5 });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockDb.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          authMethod: { in: ["INTERNAL", "BOTH"] },
          mustChangePassword: false,
          isDeleted: false,
          isActive: true,
        }),
        data: expect.objectContaining({ mustChangePassword: true }),
      })
    );
  });

  it("fires FORCE_PASSWORD_CHANGE audit event with scope 'bulk' and count", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.updateMany.mockResolvedValue({ count: 7 });

    await POST(makeRequest());

    await vi.waitFor(() => {
      expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "FORCE_PASSWORD_CHANGE",
          metadata: expect.objectContaining({
            scope: "bulk",
            count: 7,
          }),
        })
      );
    });
  });

  it("returns count in response", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.updateMany.mockResolvedValue({ count: 3 });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.count).toBe(3);
    expect(body.success).toBe(true);
  });
});
