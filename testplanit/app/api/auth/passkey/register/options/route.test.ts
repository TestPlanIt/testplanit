// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_URL = "https://app.example.com";
  delete process.env.APP_URL;
});

const {
  mockGetSession,
  mockGetToken,
  mockFindUser,
  mockAvailability,
  mockBuildOptions,
  mockVerifyPassword,
  mockVerifyTOTP,
  mockAuditAuthEvent,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetToken: vi.fn(),
  mockFindUser: vi.fn(),
  mockAvailability: vi.fn(),
  mockBuildOptions: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockVerifyTOTP: vi.fn(),
  mockAuditAuthEvent: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ getServerAuthSession: mockGetSession }));
vi.mock("next-auth/jwt", () => ({ getToken: mockGetToken }));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mockFindUser } },
}));
vi.mock("~/lib/passkey", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/passkey")>()),
  getPasskeyAvailability: mockAvailability,
  buildPasskeyRegistrationOptions: mockBuildOptions,
}));
vi.mock("~/lib/auth/verifyCurrentPassword", () => ({
  verifyCurrentPassword: mockVerifyPassword,
}));
vi.mock("~/lib/two-factor", () => ({
  verifyTOTP: mockVerifyTOTP,
  decryptSecret: (value: string) => `decrypted:${value}`,
}));
vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: mockAuditAuthEvent,
}));

import { POST } from "./route";

const dbUser = {
  id: "user-1",
  email: "user@example.com",
  name: "User One",
  isActive: true,
  isDeleted: false,
  authMethod: "INTERNAL",
  password: "$2b$10$hash",
  twoFactorEnabled: false,
  twoFactorSecret: null,
};

function makePost(
  body: unknown = { currentPassword: "secret" },
  origin = "https://app.example.com"
) {
  return new NextRequest("http://localhost/api/auth/passkey/register/options", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
  mockGetToken.mockResolvedValue({ sub: "user-1" });
  mockFindUser.mockResolvedValue(dbUser);
  mockAvailability.mockResolvedValue({ available: true });
  mockVerifyPassword.mockResolvedValue("ok");
  mockVerifyTOTP.mockResolvedValue(true);
  mockAuditAuthEvent.mockResolvedValue(undefined);
  mockBuildOptions.mockResolvedValue({
    ok: true,
    options: { challenge: "challenge-1" },
    challengeToken: "token-1",
  });
});

describe("POST /api/auth/passkey/register/options", () => {
  it("issues a challenge once the password is confirmed", async () => {
    const response = await POST(makePost());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      options: { challenge: "challenge-1" },
      challengeToken: "token-1",
    });
    expect(mockVerifyPassword).toHaveBeenCalledWith(
      "user-1",
      "$2b$10$hash",
      "secret"
    );
    expect(mockVerifyTOTP).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST(makePost())).status).toBe(401);
    expect(mockBuildOptions).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a second factor still owed",
      { twoFactorRequired: true, twoFactorVerified: false },
    ],
    ["two-factor setup still owed", { twoFactorSetupRequired: true }],
    ["a forced password change still owed", { mustChangePassword: true }],
  ])("refuses a session with %s", async (_label, claims) => {
    mockGetToken.mockResolvedValue({ sub: "user-1", ...claims });
    const response = await POST(makePost());

    expect(response.status).toBe(403);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockBuildOptions).not.toHaveBeenCalled();
  });

  it("accepts a session whose second factor was verified", async () => {
    mockGetToken.mockResolvedValue({
      sub: "user-1",
      twoFactorRequired: true,
      twoFactorVerified: true,
    });
    expect((await POST(makePost())).status).toBe(200);
  });

  it("refuses while passkeys are unavailable", async () => {
    mockAvailability.mockResolvedValue({
      available: false,
      reason: "disabled",
    });
    const response = await POST(makePost());

    expect(response.status).toBe(403);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it("refuses a page on another address than the configured one, before any prompt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await POST(
      makePost({ currentPassword: "secret" }, "https://app.example.com:3001")
    );

    expect(response.status).toBe(409);
    expect((await response.json()).errorCode).toBe(
      "auth.signin.passkey.addressMismatch"
    );
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockBuildOptions).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each(["SSO", "SCIM"])("refuses a %s account", async (authMethod) => {
    mockFindUser.mockResolvedValue({ ...dbUser, authMethod });
    const response = await POST(makePost());

    expect(response.status).toBe(403);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it("refuses an inactive account", async () => {
    mockFindUser.mockResolvedValue({ ...dbUser, isActive: false });
    expect((await POST(makePost())).status).toBe(401);
  });

  it("rejects a missing password", async () => {
    const response = await POST(makePost({}));

    expect(response.status).toBe(400);
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it("rejects the wrong password and records it", async () => {
    mockVerifyPassword.mockResolvedValue("invalid");
    const response = await POST(makePost());

    expect(response.status).toBe(400);
    expect((await response.json()).errorCode).toBe(
      "users.profile.passkeys.errors.invalidPassword"
    );
    expect(mockAuditAuthEvent).toHaveBeenCalledWith(
      "LOGIN_FAILED",
      "user-1",
      "user@example.com",
      { provider: "passkey", reason: "passkey_step_up_password" }
    );
    expect(mockBuildOptions).not.toHaveBeenCalled();
  });

  it("returns 429 once the password check is rate limited", async () => {
    mockVerifyPassword.mockResolvedValue("rate_limited");
    const response = await POST(makePost());

    expect(response.status).toBe(429);
    expect(mockBuildOptions).not.toHaveBeenCalled();
  });

  it("returns 409 when the account has no password of its own", async () => {
    mockVerifyPassword.mockResolvedValue("not_set");
    const response = await POST(makePost());

    expect(response.status).toBe(409);
    expect((await response.json()).errorCode).toBe(
      "users.profile.passkeys.errors.passwordNotSet"
    );
  });

  describe("when the user has two-factor authentication on", () => {
    beforeEach(() => {
      mockFindUser.mockResolvedValue({
        ...dbUser,
        twoFactorEnabled: true,
        twoFactorSecret: "v2:secret",
      });
    });

    it("also requires a valid authenticator code", async () => {
      const response = await POST(
        makePost({ currentPassword: "secret", totpCode: "123456" })
      );

      expect(response.status).toBe(200);
      expect(mockVerifyTOTP).toHaveBeenCalledWith(
        "123456",
        "decrypted:v2:secret"
      );
    });

    it("refuses when the code is missing", async () => {
      const response = await POST(makePost());

      expect(response.status).toBe(400);
      expect((await response.json()).errorCode).toBe(
        "auth.errors.invalid2FACode"
      );
      expect(mockBuildOptions).not.toHaveBeenCalled();
    });

    it("refuses a wrong code and records it", async () => {
      mockVerifyTOTP.mockResolvedValue(false);
      const response = await POST(
        makePost({ currentPassword: "secret", totpCode: "000000" })
      );

      expect(response.status).toBe(400);
      expect(mockAuditAuthEvent).toHaveBeenCalledWith(
        "LOGIN_FAILED",
        "user-1",
        "user@example.com",
        { provider: "passkey", reason: "passkey_step_up_totp" }
      );
      expect(mockBuildOptions).not.toHaveBeenCalled();
    });
  });

  it("returns 409 once the account holds the maximum", async () => {
    mockBuildOptions.mockResolvedValue({ ok: false, reason: "limit_reached" });
    const response = await POST(makePost());

    expect(response.status).toBe(409);
    expect((await response.json()).errorCode).toBe(
      "users.profile.passkeys.errors.limitReached"
    );
  });
});
