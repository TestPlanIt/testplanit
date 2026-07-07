// @vitest-environment node
/**
 * ACCEPTANCE #1 (claims parity): a sign-in through the passwordless-complete
 * provider must produce a session equivalent to today's email (magic-link)
 * sign-in — the authorization gate reads token.access (and role/2FA claims)
 * from the JWT, so these must not regress.
 *
 * Both providers return the same { id, email, name } user object and flow
 * through the same jwt/session callbacks; these tests pin that equivalence
 * by running the real callbacks side by side.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
  process.env.PASSWORDLESS_DEVICE_BOUND = "true";
});

const findUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const registrationSettingsMock = vi.fn();
const getCachedSessionUserMock = vi.fn();

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
    ssoProvider: { findMany: vi.fn().mockResolvedValue([]) },
    registrationSettings: {
      findFirst: (...args: unknown[]) => registrationSettingsMock(...args),
    },
  },
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
  auditAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/utils/email-domain-validation", () => ({
  isEmailDomainAllowed: vi.fn().mockResolvedValue(true),
}));

import { authOptions } from "./auth";

const jwtCallback = authOptions.callbacks!.jwt!;
const sessionCallback = authOptions.callbacks!.session!;
const signInCallback = authOptions.callbacks!.signIn!;

const dbUser = {
  access: "USER",
  isApi: false,
  twoFactorEnabled: false,
  passwordChangedAt: null,
  mustChangePassword: false,
};

const signedInUser = { id: "user-1", email: "user@example.com", name: "User" };

function setupJwtMocks() {
  findUniqueMock.mockResolvedValue(dbUser);
  registrationSettingsMock.mockResolvedValue({
    force2FAAllLogins: false,
    passwordExpirationDays: 0,
    allowOpenRegistration: false,
  });
}

async function runJwtFor(provider: string) {
  const token: Record<string, unknown> = {
    sub: "user-1",
    name: "User",
    email: "user@example.com",
  };
  return (await jwtCallback({
    token: token as any,
    account: { provider, type: "credentials" } as any,
    user: signedInUser as any,
  } as any)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupJwtMocks();
});

describe("JWT claims parity: passwordless-complete vs email", () => {
  it("produces identical claims apart from the provider label", async () => {
    const emailToken = await runJwtFor("email");
    const passwordlessToken = await runJwtFor("passwordless-complete");

    expect(emailToken.provider).toBe("email");
    expect(passwordlessToken.provider).toBe("passwordless-complete");

    const { provider: _p1, ...emailClaims } = emailToken;
    const { provider: _p2, ...passwordlessClaims } = passwordlessToken;
    expect(passwordlessClaims).toEqual(emailClaims);

    // The claims the authorization gate depends on.
    expect(passwordlessToken.access).toBe("USER");
    expect(passwordlessToken.isApi).toBe(false);
    expect(passwordlessToken.mustChangePassword).toBe(false);
  });

  it("applies force-2FA-on-all-logins identically to both providers", async () => {
    registrationSettingsMock.mockResolvedValue({
      force2FAAllLogins: true,
      passwordExpirationDays: 0,
    });
    findUniqueMock.mockResolvedValue({ ...dbUser, twoFactorEnabled: true });

    const emailToken = await runJwtFor("email");
    const passwordlessToken = await runJwtFor("passwordless-complete");
    for (const token of [emailToken, passwordlessToken]) {
      expect(token.twoFactorRequired).toBe(true);
      expect(token.twoFactorVerified).toBe(false);
    }
  });
});

describe("session parity", () => {
  it("the session callback resolves the same session from either provider's token", async () => {
    const cached = {
      name: "User",
      access: "USER",
      image: null,
      emailVerified: null,
      authMethod: "SSO",
      preferences: undefined,
    };
    getCachedSessionUserMock.mockResolvedValue(cached);
    findUniqueMock.mockResolvedValue({ isActive: true });

    const makeSession = () => ({
      user: { id: "", email: "user@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    });

    const emailToken = await runJwtFor("email");
    const passwordlessToken = await runJwtFor("passwordless-complete");

    const viaEmail = await sessionCallback({
      session: makeSession() as any,
      token: emailToken as any,
    } as any);
    const viaPasswordless = await sessionCallback({
      session: makeSession() as any,
      token: passwordlessToken as any,
    } as any);

    expect(viaPasswordless).toEqual(viaEmail);
    expect((viaPasswordless as any).user.access).toBe("USER");
  });
});

describe("signIn callback treats passwordless-complete like the email provider", () => {
  it("rejects inactive users", async () => {
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      authMethod: "INTERNAL",
      isActive: false,
      email: "user@example.com",
      name: "User",
    });
    const allowed = await signInCallback({
      user: signedInUser as any,
      account: { provider: "passwordless-complete" } as any,
    } as any);
    expect(allowed).toBe(false);
  });

  it("upgrades INTERNAL users to BOTH, exactly as the email provider does", async () => {
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      authMethod: "INTERNAL",
      isActive: true,
      email: "user@example.com",
      name: "User",
    });
    userUpdateMock.mockResolvedValue({});

    const allowed = await signInCallback({
      user: signedInUser as any,
      account: { provider: "passwordless-complete" } as any,
    } as any);
    expect(allowed).toBe(true);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { authMethod: "BOTH" },
    });
  });
});
