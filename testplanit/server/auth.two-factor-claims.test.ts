// @vitest-environment node
/**
 * Whether a session has passed its second factor is recorded by the server,
 * on the cookie it re-issues once a code has been verified. A session update
 * is sent by the browser, so the `jwt` callback must not take the browser's
 * word for it: a session that still owes a code would otherwise clear its own
 * flag.
 *
 * Both sets of callbacks are exercised: getAuthOptions() is what the NextAuth
 * route runs, the static authOptions is what getServerSession runs.
 */
import type { NextAuthOptions } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

const findUniqueMock = vi.fn();
const registrationSettingsMock = vi.fn();

vi.mock("~/server/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: vi.fn(),
    },
    ssoProvider: { findMany: vi.fn().mockResolvedValue([]) },
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
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/utils/email-domain-validation", () => ({
  isEmailDomainAllowed: vi.fn().mockResolvedValue(true),
}));

import { authOptions, getAuthOptions } from "./auth";

const optionSets: [string, () => Promise<NextAuthOptions>][] = [
  ["getAuthOptions()", () => getAuthOptions()],
  ["authOptions", async () => authOptions],
];

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueMock.mockResolvedValue({
    access: "USER",
    isApi: false,
    twoFactorEnabled: true,
    passwordChangedAt: null,
    mustChangePassword: false,
  });
  registrationSettingsMock.mockResolvedValue({
    force2FAAllLogins: true,
    passwordExpirationDays: 0,
  });
});

describe.each(optionSets)(
  "session updates sent by the browser, in %s",
  (_label, loadOptions) => {
    async function update(
      token: Record<string, unknown>,
      session: Record<string, unknown> | undefined
    ) {
      const options = await loadOptions();
      return (await options.callbacks!.jwt!({
        token: { sub: "user-1", access: "USER", ...token },
        trigger: "update",
        session,
      } as any)) as Record<string, unknown>;
    }

    it("cannot mark a pending second factor as verified", async () => {
      const token = await update(
        { twoFactorRequired: true, twoFactorVerified: false },
        { twoFactorVerified: true }
      );

      expect(token.twoFactorRequired).toBe(true);
      expect(token.twoFactorVerified).toBe(false);
    });

    it("cannot mark a pending two-factor setup as complete", async () => {
      const token = await update(
        { twoFactorSetupRequired: true },
        { twoFactorSetupComplete: true }
      );

      expect(token.twoFactorSetupRequired).toBe(true);
      expect(token.twoFactorVerified).toBeUndefined();
    });

    it("keeps a verified second factor across later updates", async () => {
      const token = await update(
        { twoFactorRequired: false, twoFactorVerified: true },
        undefined
      );

      expect(token.twoFactorRequired).toBe(false);
      expect(token.twoFactorVerified).toBe(true);
    });

    it("still refreshes the account's access on an update", async () => {
      findUniqueMock.mockResolvedValue({
        access: "ADMIN",
        isApi: true,
        twoFactorEnabled: true,
        passwordChangedAt: null,
        mustChangePassword: false,
      });
      const token = await update(
        { twoFactorRequired: true, twoFactorVerified: false },
        { twoFactorVerified: true }
      );

      expect(token.access).toBe("ADMIN");
      expect(token.isApi).toBe(true);
    });
  }
);
