// @vitest-environment node
/**
 * The `mustChangePasswordCleared` session update (sent by the force-change
 * page right after a successful POST) must fall through to the DB refresh so
 * the token picks up the new passwordChangedAt. Returning early used to leave
 * the stale timestamp in place, which the SECURITY-03 guard now treats as
 * "issued before the change" — i.e. the user would be signed out by the very
 * next request after being forced to change their password.
 */
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

import { authOptions } from "./auth";

const jwtCallback = authOptions.callbacks!.jwt!;

const CHANGED_AT = new Date("2026-11-02T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  registrationSettingsMock.mockResolvedValue({
    force2FAAllLogins: false,
    passwordExpirationDays: 0,
  });
});

describe("jwt callback - mustChangePasswordCleared update", () => {
  it("clears the flag AND refreshes passwordChangedAt from the DB", async () => {
    findUniqueMock.mockResolvedValue({
      access: "USER",
      isApi: false,
      twoFactorEnabled: false,
      passwordChangedAt: CHANGED_AT,
      mustChangePassword: false,
    });

    const token = (await jwtCallback({
      token: {
        sub: "user-1",
        access: "USER",
        passwordChangedAt: null,
        mustChangePassword: true,
        mustChangePasswordReason: "admin",
      } as any,
      trigger: "update",
      session: { mustChangePasswordCleared: true },
    } as any)) as Record<string, unknown>;

    expect(token.mustChangePassword).toBe(false);
    expect(token.mustChangePasswordReason).toBeUndefined();
    expect(token.passwordChangedAt).toBe(CHANGED_AT.toISOString());
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });
});
