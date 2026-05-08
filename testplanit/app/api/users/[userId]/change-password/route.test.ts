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
  // Plan 05 Task 3 D-18 addition — the route calls auditPasswordChange,
  // not captureAuditEvent directly. We re-export both so the test can
  // assert on either path.
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
import { auditPasswordChange } from "~/lib/services/auditLog";
import { expectAuditRowComplete } from "~/lib/testing/auditAssertions";
import { POST } from "./route";

const mockGetServerAuthSession = vi.mocked(getServerAuthSession);
const mockDb = vi.mocked(db, true);
const mockValidatePasswordPolicy = vi.mocked(validatePasswordPolicy);
const mockUpdatePasswordHistory = vi.mocked(updatePasswordHistory);

function makeRequest(userId: string, body: Record<string, unknown> = {}) {
  return new NextRequest(
    `http://localhost/api/users/${userId}/change-password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // D-18: populate headers withAuditContext extracts so the ALS
        // frame carries ipAddress/userAgent/requestId on every test.
        "x-forwarded-for": "10.0.0.1",
        "user-agent": "vitest-agent/1.0",
      },
      body: JSON.stringify({
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword2!",
        ...body,
      }),
    }
  );
}

function makeUserSession(userId = "user-1") {
  return {
    user: { id: userId, access: "USER", email: "user@test.com" },
  } as any;
}

describe("POST /api/users/[userId]/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidatePasswordPolicy.mockResolvedValue([]);
    mockUpdatePasswordHistory.mockResolvedValue(undefined);
  });

  it("calls validatePasswordPolicy and returns 400 with structured violations on policy violation", async () => {
    mockGetServerAuthSession.mockResolvedValue(makeUserSession());
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "hashed-old-password",
      email: "user@test.com",
    } as any);
    mockValidatePasswordPolicy.mockResolvedValue([
      { rule: "minLength", params: { count: 12 } },
      { rule: "uppercase" },
    ]);

    const res = await POST(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors).toEqual([
      { rule: "minLength", params: { count: 12 } },
      { rule: "uppercase" },
    ]);
    expect(mockValidatePasswordPolicy).toHaveBeenCalledWith(
      "user-1",
      "NewPassword2!"
    );
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

  describe("SSO user without bcrypt password", () => {
    it("allows password set when user has null password (no currentPassword required)", async () => {
      mockGetServerAuthSession.mockResolvedValue(makeUserSession());
      mockDb.user.findUnique.mockResolvedValue({
        id: "user-1",
        password: null,
        email: "user@test.com",
      } as any);
      mockDb.registrationSettings.findFirst.mockResolvedValue({
        passwordHistoryDepth: 0,
      } as any);
      mockDb.user.update.mockResolvedValue({} as any);

      const res = await POST(
        makeRequest("user-1", { currentPassword: undefined }),
        { params: Promise.resolve({ userId: "user-1" }) }
      );

      expect(res.status).toBe(200);
    });

    it("allows password set when user has plain-text UUID password (no currentPassword required)", async () => {
      mockGetServerAuthSession.mockResolvedValue(makeUserSession());
      mockDb.user.findUnique.mockResolvedValue({
        id: "user-1",
        password: "3f2a1b4c-5d6e-7f8a-9b0c-1d2e3f4a5b6c",
        email: "user@test.com",
      } as any);
      mockDb.registrationSettings.findFirst.mockResolvedValue({
        passwordHistoryDepth: 0,
      } as any);
      mockDb.user.update.mockResolvedValue({} as any);

      const res = await POST(
        makeRequest("user-1", { currentPassword: undefined }),
        { params: Promise.resolve({ userId: "user-1" }) }
      );

      expect(res.status).toBe(200);
    });

    it("returns 400 when user has bcrypt password but currentPassword is missing", async () => {
      mockGetServerAuthSession.mockResolvedValue(makeUserSession());
      mockDb.user.findUnique.mockResolvedValue({
        id: "user-1",
        password: "$2b$10$abcdefghijklmnopqrstuuVGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        email: "user@test.com",
      } as any);

      const res = await POST(
        makeRequest("user-1", { currentPassword: undefined }),
        { params: Promise.resolve({ userId: "user-1" }) }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/current password/i);
    });

    it("returns 400 when user has bcrypt password and currentPassword is wrong", async () => {
      const bcrypt = (await import("bcrypt")).default;
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      mockGetServerAuthSession.mockResolvedValue(makeUserSession());
      mockDb.user.findUnique.mockResolvedValue({
        id: "user-1",
        password: "$2b$10$abcdefghijklmnopqrstuuVGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        email: "user@test.com",
      } as any);

      const res = await POST(
        makeRequest("user-1", { currentPassword: "WrongPassword!" }),
        { params: Promise.resolve({ userId: "user-1" }) }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid current password/i);
    });
  });

  it("emits audit row with complete actor context (D-18)", async () => {
    const { updateAuditContext, getAuditContext } =
      await import("~/lib/auditContext");
    mockGetServerAuthSession.mockImplementation(async () => {
      updateAuditContext({
        userId: "user-1",
        userEmail: "user@test.com",
        userName: "User",
      });
      return makeUserSession();
    });
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "hashed-old-password",
      email: "user@test.com",
    } as any);
    mockDb.registrationSettings.findFirst.mockResolvedValue({
      passwordHistoryDepth: 0,
    } as any);
    mockDb.user.update.mockResolvedValue({} as any);

    let capturedRow: Record<string, unknown> | null = null;
    vi.mocked(auditPasswordChange).mockImplementation(
      async (
        userId: string,
        email: string,
        _isReset?: boolean
      ): Promise<void> => {
        const ctx = getAuditContext();
        capturedRow = {
          userId: userId ?? ctx?.userId ?? null,
          userEmail: email || ctx?.userEmail || null,
          userName: ctx?.userName ?? null,
          ipAddress: ctx?.ipAddress ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
          metadata: null,
        };
      }
    );

    const res = await POST(makeRequest("user-1"), {
      params: Promise.resolve({ userId: "user-1" }),
    });

    expect(res.status).toBe(200);
    expect(auditPasswordChange).toHaveBeenCalled();
    expect(capturedRow).not.toBeNull();
    expectAuditRowComplete(capturedRow!);
  });
});
