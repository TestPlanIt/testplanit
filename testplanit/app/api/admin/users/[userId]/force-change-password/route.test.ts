import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
  calculateDiff: vi.fn(),
}));

vi.mock("~/lib/session-cache", () => ({
  invalidateSessionUserCache: vi.fn().mockResolvedValue(undefined),
}));

import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { invalidateSessionUserCache } from "~/lib/session-cache";
import { POST } from "./route";

const mockGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockDb = vi.mocked(db);
const mockCaptureAuditEvent = vi.mocked(captureAuditEvent);
const mockInvalidateSessionUserCache = vi.mocked(invalidateSessionUserCache);

function makeAdminSession() {
  return { user: { id: "admin-1", access: "ADMIN", email: "admin@test.com" } } as any;
}

function makeRequest(userId = "user-1") {
  return new NextRequest(
    `http://localhost/api/admin/users/${userId}/force-change-password`,
    { method: "POST" }
  );
}

describe("POST /api/admin/users/[userId]/force-change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
    mockInvalidateSessionUserCache.mockResolvedValue(undefined);
  });

  it("returns 401 when no session", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    } as any);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(403);
  });

  it("returns 404 when user not found", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest("missing-user"), {
      params: Promise.resolve({ userId: "missing-user" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 when user is deleted", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      authMethod: "INTERNAL",
      email: "user@test.com",
      isDeleted: true,
    } as any);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 when user authMethod is SSO-only", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      authMethod: "SSO",
      email: "sso@test.com",
      isDeleted: false,
    } as any);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(400);
  });

  it("sets mustChangePassword=true and calls invalidateSessionUserCache on success", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      authMethod: "INTERNAL",
      email: "user@test.com",
      isDeleted: false,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(200);
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ mustChangePassword: true }),
      })
    );
    expect(mockInvalidateSessionUserCache).toHaveBeenCalledWith("user-1");
  });

  it("fires FORCE_PASSWORD_CHANGE audit event with scope 'individual'", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      authMethod: "INTERNAL",
      email: "user@test.com",
      isDeleted: false,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    // Wait for async audit
    await vi.waitFor(() => {
      expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "FORCE_PASSWORD_CHANGE",
          metadata: expect.objectContaining({ scope: "individual" }),
        })
      );
    });
  });

  it("also works for BOTH authMethod users", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      authMethod: "BOTH",
      email: "both@test.com",
      isDeleted: false,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(200);
  });
});
