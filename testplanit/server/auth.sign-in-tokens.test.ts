// @vitest-environment node
/**
 * The password sign-in hands the browser a token when a second factor is
 * still owed (2FA_REQUIRED) or still has to be set up (2FA_SETUP_REQUIRED).
 * Those tokens and the SAML completion token are signed with the same secret,
 * so each must be good for its own step only. The SAML completion route mints
 * a full session, and without Valkey nothing but the token itself decides
 * whether it does.
 */
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  const secret = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_SECRET = secret;
  process.env.NEXTAUTH_URL = "https://app.example.com";
  return secret;
});

const {
  userFindFirstMock,
  userFindUniqueMock,
  registrationSettingsFindFirstMock,
  verifyTOTPMock,
} = vi.hoisted(() => ({
  userFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  registrationSettingsFindFirstMock: vi.fn(),
  verifyTOTPMock: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findFirst: (...args: unknown[]) => userFindFirstMock(...args),
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: vi.fn(),
    },
    ssoProvider: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    registrationSettings: {
      findFirst: (...args: unknown[]) =>
        registrationSettingsFindFirstMock(...args),
    },
  },
}));

vi.mock("bcrypt", () => ({
  compare: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/lib/valkey", () => ({ default: null }));

vi.mock("~/lib/session-cache", () => ({
  getCachedSessionUser: vi.fn(),
  touchLastActive: vi.fn(),
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: vi.fn(),
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/utils/email-domain-validation", () => ({
  isEmailDomainAllowed: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/lib/two-factor", () => ({
  verifyTOTP: (...args: unknown[]) => verifyTOTPMock(...args),
  decryptSecret: vi.fn().mockReturnValue("totp-secret"),
  encryptSecret: vi.fn(),
  isLegacyEncryption: vi.fn().mockReturnValue(false),
  verifyBackupCode: vi.fn().mockReturnValue(-1),
}));

import {
  consumeTempSessionToken,
  createTempSessionToken,
} from "~/lib/auth-security";
import { authOptions } from "./auth";

type Credentials = Partial<
  Record<"email" | "password" | "twoFactorToken" | "pendingAuthToken", string>
>;

const authorize = (
  authOptions.providers.find(
    (provider) => provider.id === "credentials"
  ) as unknown as {
    options: { authorize: (credentials: Credentials) => Promise<unknown> };
  }
).options.authorize;

const user = {
  id: "user-1",
  email: "user@example.com",
  name: "User One",
  password: "hashed-password",
  isActive: true,
  twoFactorEnabled: true,
  twoFactorSecret: "encrypted-secret",
  twoFactorBackupCodes: null,
  authMethod: "INTERNAL",
  failedLoginAttempts: 0,
  lockedUntil: null,
  passwordChangedAt: null,
  emailVerified: new Date("2026-01-01T00:00:00Z"),
};

/** The token a password sign-in hands back in its error, by its prefix. */
async function tokenFromPasswordSignIn(prefix: string): Promise<string> {
  const error = await authorize({
    email: user.email,
    password: "correct-password",
  }).then(
    () => null,
    (thrown: Error) => thrown
  );
  expect(error?.message.startsWith(`${prefix}:`)).toBe(true);
  return error!.message.slice(prefix.length + 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindFirstMock.mockResolvedValue(user);
  userFindUniqueMock.mockResolvedValue(user);
  registrationSettingsFindFirstMock.mockResolvedValue(null);
  verifyTOTPMock.mockResolvedValue(true);
});

describe("tokens from a password sign-in that still owes two-factor", () => {
  it("the 2FA_REQUIRED token does not complete a SAML sign-in", async () => {
    const token = await tokenFromPasswordSignIn("2FA_REQUIRED");

    expect(await consumeTempSessionToken(token)).toBeNull();
  });

  it("the 2FA_SETUP_REQUIRED token does not complete a SAML sign-in", async () => {
    userFindFirstMock.mockResolvedValue({ ...user, twoFactorEnabled: false });
    registrationSettingsFindFirstMock.mockResolvedValue({
      force2FANonSSO: true,
      force2FAAllLogins: false,
    });
    const token = await tokenFromPasswordSignIn("2FA_SETUP_REQUIRED");

    expect(await consumeTempSessionToken(token)).toBeNull();
  });

  it("the 2FA_REQUIRED token still completes the password sign-in with a code", async () => {
    const token = await tokenFromPasswordSignIn("2FA_REQUIRED");

    const result = await authorize({
      pendingAuthToken: token,
      twoFactorToken: "123456",
    });

    expect(result).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  });
});

describe("the two-factor step of a password sign-in", () => {
  it("refuses a SAML completion token, even with a valid code", async () => {
    const samlToken = await createTempSessionToken({
      userId: user.id,
      provider: "saml",
      email: user.email,
    });

    await expect(
      authorize({ pendingAuthToken: samlToken, twoFactorToken: "123456" })
    ).rejects.toThrow("2FA verification failed");
    expect(verifyTOTPMock).not.toHaveBeenCalled();
  });

  it("refuses a token that names no purpose, whatever it claims", async () => {
    const unlabelled = jwt.sign(
      { userId: user.id, email: user.email, twoFactorPending: true },
      SECRET,
      { expiresIn: "5m" }
    );

    await expect(
      authorize({ pendingAuthToken: unlabelled, twoFactorToken: "123456" })
    ).rejects.toThrow("2FA verification failed");
    expect(verifyTOTPMock).not.toHaveBeenCalled();
  });
});
