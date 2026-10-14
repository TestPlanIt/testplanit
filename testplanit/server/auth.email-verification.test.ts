/**
 * A password account must confirm its email address before it can sign in,
 * and a session issued before that rule must not outlive it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  userFindFirstMock,
  userFindUniqueMock,
  registrationSettingsFindFirstMock,
  compareMock,
  auditAuthEventMock,
  getCachedSessionUserMock,
} = vi.hoisted(() => ({
  userFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  registrationSettingsFindFirstMock: vi.fn(),
  compareMock: vi.fn(),
  auditAuthEventMock: vi.fn(),
  getCachedSessionUserMock: vi.fn(),
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
  compare: (...args: unknown[]) => compareMock(...args),
}));

vi.mock("~/lib/session-cache", () => ({
  getCachedSessionUser: (...args: unknown[]) =>
    getCachedSessionUserMock(...args),
  touchLastActive: vi.fn(),
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: vi.fn(),
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: (...args: unknown[]) => auditAuthEventMock(...args),
}));

vi.mock("~/lib/utils/email-domain-validation", () => ({
  isEmailDomainAllowed: vi.fn().mockResolvedValue(true),
}));

import type { Session } from "next-auth";
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

const passwordUser = {
  id: "user-1",
  email: "user@example.com",
  name: "User One",
  password: "hashed-password",
  isActive: true,
  twoFactorEnabled: false,
  authMethod: "INTERNAL",
  failedLoginAttempts: 0,
  lockedUntil: null,
  passwordChangedAt: null,
  emailVerified: null as Date | null,
};

const signIn = () =>
  authorize({ email: "user@example.com", password: "correct-password" });

beforeEach(() => {
  vi.clearAllMocks();
  auditAuthEventMock.mockResolvedValue(undefined);
  registrationSettingsFindFirstMock.mockResolvedValue(null);
  compareMock.mockResolvedValue(true);
});

describe("password sign-in for an unverified address", () => {
  it("is refused once the password is right, and audited", async () => {
    userFindFirstMock.mockResolvedValue(passwordUser);
    await expect(signIn()).rejects.toThrow("EMAIL_NOT_VERIFIED");
    expect(auditAuthEventMock).toHaveBeenCalledWith(
      "LOGIN_FAILED",
      "user-1",
      "user@example.com",
      { reason: "email_not_verified" }
    );
  });

  it("says nothing about verification to a wrong password", async () => {
    userFindFirstMock.mockResolvedValue(passwordUser);
    compareMock.mockResolvedValue(false);
    await expect(signIn()).resolves.toBeNull();
  });

  it("lets a verified account in", async () => {
    userFindFirstMock.mockResolvedValue({
      ...passwordUser,
      emailVerified: new Date("2026-01-01T00:00:00Z"),
    });
    await expect(signIn()).resolves.toMatchObject({ id: "user-1" });
  });

  it("lets an SSO account that also has a password in, as the app's gate does", async () => {
    userFindFirstMock.mockResolvedValue({
      ...passwordUser,
      authMethod: "BOTH",
    });
    await expect(signIn()).resolves.toMatchObject({ id: "user-1" });
  });
});

describe("session for an unverified address", () => {
  const session = () =>
    authOptions.callbacks!.session!({
      session: {
        user: { id: "user-1", email: "user@example.com" },
        expires: "2099-01-01T00:00:00Z",
      } as Session,
      token: { sub: "user-1" },
    } as never) as Promise<Session>;

  beforeEach(() => {
    getCachedSessionUserMock.mockResolvedValue({
      access: "NONE",
      emailVerified: null,
      authMethod: "INTERNAL",
    });
  });

  it("is ended, so a session issued before the rule cannot be used", async () => {
    userFindUniqueMock.mockResolvedValue({
      passwordChangedAt: null,
      isActive: true,
      emailVerified: null,
      authMethod: "INTERNAL",
    });
    expect(await session()).toEqual({});
  });

  it("stays for a verified account", async () => {
    userFindUniqueMock.mockResolvedValue({
      passwordChangedAt: null,
      isActive: true,
      emailVerified: new Date("2026-01-01T00:00:00Z"),
      authMethod: "INTERNAL",
    });
    expect((await session()).user).toMatchObject({ id: "user-1" });
  });
});
