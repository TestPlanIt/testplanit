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
    ssoProvider: {
      findFirst: vi.fn(),
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
const mockDb = vi.mocked(db, true);
const mockCaptureAuditEvent = vi.mocked(captureAuditEvent);
const mockInvalidateSessionUserCache = vi.mocked(invalidateSessionUserCache);

function makeAdminSession() {
  return { user: { id: "admin-1", access: "ADMIN", email: "admin@test.com" } } as any;
}

function makeRequest(userId = "user-1") {
  return new NextRequest(
    `http://localhost/api/admin/users/${userId}/revoke-password`,
    { method: "POST" }
  );
}

function setEmailEnv(configured: boolean) {
  if (configured) {
    process.env.EMAIL_SERVER_HOST = "smtp.example.com";
    process.env.EMAIL_SERVER_PORT = "587";
    process.env.EMAIL_SERVER_USER = "user";
    process.env.EMAIL_SERVER_PASSWORD = "pass";
    process.env.EMAIL_FROM = "noreply@example.com";
  } else {
    delete process.env.EMAIL_SERVER_HOST;
    delete process.env.EMAIL_SERVER_PORT;
    delete process.env.EMAIL_SERVER_USER;
    delete process.env.EMAIL_SERVER_PASSWORD;
    delete process.env.EMAIL_FROM;
  }
}

describe("POST /api/admin/users/[userId]/revoke-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEmailEnv(false);
    mockCaptureAuditEvent.mockResolvedValue(undefined);
    mockInvalidateSessionUserCache.mockResolvedValue(undefined);
    mockDb.ssoProvider.findFirst.mockResolvedValue(null);
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

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 when user has no password to revoke", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      isDeleted: false,
      authMethod: "SSO",
      password: null,
    } as any);
    setEmailEnv(true); // email is configured but user has no password

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("password to revoke");
  });

  it("returns 400 when no passwordless login method is configured", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      isDeleted: false,
      authMethod: "INTERNAL",
      password: "hashed-password",
    } as any);
    mockDb.ssoProvider.findFirst.mockResolvedValue(null);
    // email env NOT set (from beforeEach)

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("no passwordless login method");
  });

  it("succeeds when Magic Link SSO provider is configured", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      isDeleted: false,
      authMethod: "INTERNAL",
      password: "hashed-password",
    } as any);
    mockDb.ssoProvider.findFirst.mockResolvedValue({
      id: "sso-1",
      type: "MAGIC_LINK",
      enabled: true,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(200);
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          password: null,
          mustChangePassword: false,
        }),
      })
    );
    expect(mockInvalidateSessionUserCache).toHaveBeenCalledWith("user-1");
  });

  it("succeeds when email server is configured", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      isDeleted: false,
      authMethod: "INTERNAL",
      password: "hashed-password",
    } as any);
    setEmailEnv(true);
    mockDb.user.update.mockResolvedValue({} as any);

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(200);
  });

  it("sets password to null and updates passwordChangedAt on success", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      isDeleted: false,
      authMethod: "INTERNAL",
      password: "hashed-password",
    } as any);
    setEmailEnv(true);
    mockDb.user.update.mockResolvedValue({} as any);

    await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          password: null,
          passwordChangedAt: expect.any(Date),
        }),
      })
    );
  });

  it("fires PASSWORD_REVOKED audit event with revokedBy metadata", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeAdminSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@test.com",
      isDeleted: false,
      authMethod: "INTERNAL",
      password: "hashed-password",
    } as any);
    setEmailEnv(true);
    mockDb.user.update.mockResolvedValue({} as any);

    await POST(makeRequest(), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    await vi.waitFor(() => {
      expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PASSWORD_REVOKED",
          metadata: expect.objectContaining({ revokedBy: "admin-1" }),
        })
      );
    });
  });
});
