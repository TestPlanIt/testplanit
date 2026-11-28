// @vitest-environment node
/**
 * A passkey sign-in is checked and audited inside its own authorizer, so the
 * sign-in callbacks must treat it like the password form, not like an
 * identity provider: the account's sign-in method stays as it is, and the
 * "require 2FA for all logins" policy asks for nothing more.
 *
 * Both sets of callbacks are exercised: getAuthOptions() is what the NextAuth
 * route runs at sign-in, the static authOptions is what getServerSession runs.
 */
import type { NextAuthOptions } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

const findUniqueMock = vi.fn();
const findFirstUserMock = vi.fn();
const userUpdateMock = vi.fn();
const registrationSettingsMock = vi.fn();
const auditAuthEventMock = vi.fn();

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstUserMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
    ssoProvider: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    registrationSettings: {
      findFirst: (...args: unknown[]) => registrationSettingsMock(...args),
    },
  },
}));

vi.mock("~/lib/session-cache", () => ({
  getCachedSessionUser: vi.fn(),
  touchLastActive: vi.fn(),
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: vi.fn(),
  getAuditContext: vi.fn(),
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: (...args: unknown[]) => auditAuthEventMock(...args),
}));

vi.mock("~/lib/utils/email-domain-validation", () => ({
  isEmailDomainAllowed: vi.fn().mockResolvedValue(true),
}));

import { authOptions, getAuthOptions } from "./auth";

const signedInUser = { id: "user-1", email: "user@example.com", name: "User" };

const optionSets: [string, () => Promise<NextAuthOptions>][] = [
  ["getAuthOptions()", () => getAuthOptions()],
  ["authOptions", async () => authOptions],
];

beforeEach(() => {
  vi.clearAllMocks();
  auditAuthEventMock.mockResolvedValue(undefined);
  findUniqueMock.mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    name: "User",
    authMethod: "INTERNAL",
    isActive: true,
    access: "USER",
    isApi: false,
    twoFactorEnabled: true,
    passwordChangedAt: null,
    mustChangePassword: false,
  });
  findFirstUserMock.mockResolvedValue(null);
  registrationSettingsMock.mockResolvedValue({
    force2FAAllLogins: true,
    passwordExpirationDays: 0,
    allowOpenRegistration: true,
  });
});

describe("the passkey provider", () => {
  it("is registered where sign-ins are handled", async () => {
    const options = await getAuthOptions();
    // A provider's own settings sit under `options` until NextAuth merges
    // them over the provider type's defaults at request time.
    const passkey = options.providers.find(
      (provider) => provider.options?.id === "passkey"
    );
    expect(passkey).toBeDefined();
    expect(passkey?.type).toBe("credentials");
    expect(passkey?.options?.authorize).toBeTypeOf("function");
  });
});

describe.each(optionSets)("sign-in callbacks in %s", (_label, loadOptions) => {
  async function runSignIn(provider: string) {
    const options = await loadOptions();
    return options.callbacks!.signIn!({
      user: signedInUser,
      account: { provider, type: "credentials", providerAccountId: "user-1" },
    } as any);
  }

  async function runJwt(provider: string) {
    const options = await loadOptions();
    return (await options.callbacks!.jwt!({
      token: { sub: "user-1", name: "User", email: "user@example.com" },
      account: { provider, type: "credentials", providerAccountId: "user-1" },
      user: signedInUser,
    } as any)) as Record<string, unknown>;
  }

  it("lets a passkey sign-in through without changing the sign-in method", async () => {
    await expect(runSignIn("passkey")).resolves.toBe(true);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("still marks an identity-provider sign-in on a password account", async () => {
    await expect(runSignIn("google")).resolves.toBe(true);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { authMethod: "BOTH" },
    });
  });

  it("turns away a passkey sign-in for an inactive account", async () => {
    findUniqueMock.mockResolvedValue({
      authMethod: "INTERNAL",
      isActive: false,
      email: "user@example.com",
    });
    await expect(runSignIn("passkey")).resolves.toBe(false);
  });

  it("asks for no second factor after a passkey when 2FA is required for all logins", async () => {
    const token = await runJwt("passkey");

    expect(token.provider).toBe("passkey");
    expect(token.twoFactorRequired).toBeUndefined();
    expect(token.twoFactorSetupRequired).toBeUndefined();
    expect(token.access).toBe("USER");
  });

  it("still asks for the second factor after an emailed link", async () => {
    const token = await runJwt("email");

    expect(token.twoFactorRequired).toBe(true);
    expect(token.twoFactorVerified).toBe(false);
  });

  it("still carries a forced password change into a passkey session", async () => {
    findUniqueMock.mockResolvedValue({
      access: "USER",
      isApi: false,
      twoFactorEnabled: false,
      passwordChangedAt: null,
      mustChangePassword: true,
    });
    const token = await runJwt("passkey");

    expect(token.mustChangePassword).toBe(true);
  });
});
