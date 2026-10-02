/**
 * Unit tests for Force SSO enforcement in the credentials provider.
 *
 * The sign-in page hides the password form when any SSO provider has
 * `forceSso` set; `authorize` must refuse the same sign-in when the
 * credentials callback is called directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ssoProviderFindFirstMock,
  userFindFirstMock,
  userFindUniqueMock,
  registrationSettingsFindFirstMock,
  compareMock,
  auditAuthEventMock,
} = vi.hoisted(() => ({
  ssoProviderFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  registrationSettingsFindFirstMock: vi.fn(),
  compareMock: vi.fn(),
  auditAuthEventMock: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findFirst: (...args: unknown[]) => userFindFirstMock(...args),
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: vi.fn(),
    },
    ssoProvider: {
      findFirst: (...args: unknown[]) => ssoProviderFindFirstMock(...args),
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
  getCachedSessionUser: vi.fn(),
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

import { authOptions } from "./auth";

type Credentials = Partial<
  Record<"email" | "password" | "twoFactorToken" | "pendingAuthToken", string>
>;

const credentialsProvider = authOptions.providers.find(
  (provider) => provider.id === "credentials"
) as unknown as {
  options: { authorize: (credentials: Credentials) => Promise<unknown> };
};
const authorize = credentialsProvider.options.authorize;

const activeUser = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  auditAuthEventMock.mockResolvedValue(undefined);
  userFindFirstMock.mockResolvedValue(activeUser);
  registrationSettingsFindFirstMock.mockResolvedValue(null);
  compareMock.mockResolvedValue(true);
});

describe("credentials authorize - Force SSO", () => {
  it("refuses a valid password when a provider has forceSso set", async () => {
    ssoProviderFindFirstMock.mockResolvedValue({ id: "provider-1" });

    const result = await authorize({
      email: "user@example.com",
      password: "correct-password",
    });

    expect(result).toBeNull();
    expect(ssoProviderFindFirstMock).toHaveBeenCalledWith({
      where: { forceSso: true },
      select: { id: true },
    });
    expect(userFindFirstMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
    expect(auditAuthEventMock).toHaveBeenCalledWith(
      "LOGIN_FAILED",
      null,
      "user@example.com",
      { reason: "force_sso", provider: "credentials" }
    );
  });

  it("refuses the 2FA completion step when a provider has forceSso set", async () => {
    ssoProviderFindFirstMock.mockResolvedValue({ id: "provider-1" });

    const result = await authorize({
      pendingAuthToken: "pending-token",
      twoFactorToken: "123456",
    });

    expect(result).toBeNull();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("signs in with a valid password when no provider has forceSso set", async () => {
    ssoProviderFindFirstMock.mockResolvedValue(null);

    const result = await authorize({
      email: "user@example.com",
      password: "correct-password",
    });

    expect(result).toEqual({
      id: "user-1",
      email: "user@example.com",
      name: "User One",
    });
    expect(compareMock).toHaveBeenCalledWith(
      "correct-password",
      "hashed-password"
    );
  });
});
