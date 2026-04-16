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
    registrationSettings: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditPasswordChange: vi.fn().mockResolvedValue(undefined),
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/session-cache", () => ({
  invalidateSessionUserCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/validate-password-policy", () => ({
  validatePasswordPolicy: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/password-history", () => ({
  updatePasswordHistory: vi.fn().mockResolvedValue(undefined),
  isPasswordInHistory: vi.fn().mockResolvedValue(false),
}));

vi.mock("bcrypt", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("hashed-new-password"),
  },
}));

import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { validatePasswordPolicy } from "~/lib/validate-password-policy";
import { updatePasswordHistory } from "~/lib/password-history";
import { POST } from "./route";

const mockGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockDb = vi.mocked(db);
const mockValidatePasswordPolicy = vi.mocked(validatePasswordPolicy);
const mockUpdatePasswordHistory = vi.mocked(updatePasswordHistory);

function makeRequest(userId: string, body: Record<string, unknown> = {}) {
  return new NextRequest(
    `http://localhost/api/users/${userId}/change-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword2!",
        ...body,
      }),
    }
  );
}

function makeUserSession(userId = "user-1") {
  return { user: { id: userId, access: "USER", email: "user@test.com" } } as any;
}

describe("POST /api/users/[userId]/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidatePasswordPolicy.mockResolvedValue([]);
    mockUpdatePasswordHistory.mockResolvedValue(undefined);
  });

  it("calls validatePasswordPolicy and returns 400 with violation messages on policy violation", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "hashed-old-password",
      email: "user@test.com",
    } as any);
    mockValidatePasswordPolicy.mockResolvedValue([
      { rule: "minLength", message: "Password must be at least 12 characters" },
      { rule: "uppercase", message: "Password must contain at least one uppercase letter" },
    ]);

    const res = await POST(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors).toContain("Password must be at least 12 characters");
    expect(mockValidatePasswordPolicy).toHaveBeenCalledWith("user-1", "NewPassword2!");
  });

  it("calls updatePasswordHistory after successful password change when depth > 0", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "hashed-old-password",
      email: "user@test.com",
    } as any);
    mockDb.registrationSettings.findFirst.mockResolvedValue({
      passwordHistoryDepth: 5,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    await POST(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(mockUpdatePasswordHistory).toHaveBeenCalledWith(
      "user-1",
      "hashed-new-password",
      5
    );
  });

  it("does NOT call updatePasswordHistory when passwordHistoryDepth is 0", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "hashed-old-password",
      email: "user@test.com",
    } as any);
    mockDb.registrationSettings.findFirst.mockResolvedValue({
      passwordHistoryDepth: 0,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    await POST(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(mockUpdatePasswordHistory).not.toHaveBeenCalled();
  });

  it("sets mustChangePassword: false on successful password change", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "hashed-old-password",
      email: "user@test.com",
    } as any);
    mockDb.registrationSettings.findFirst.mockResolvedValue({
      passwordHistoryDepth: 0,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    const res = await POST(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(200);
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mustChangePassword: false }),
      })
    );
  });
});
