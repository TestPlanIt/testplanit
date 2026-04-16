import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock ~/server/db
vi.mock("~/server/db", () => ({
  db: {
    registrationSettings: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock ~/lib/password-history
vi.mock("~/lib/password-history", () => ({
  isPasswordInHistory: vi.fn(),
}));

import { db } from "~/server/db";
import { isPasswordInHistory } from "~/lib/password-history";
import { validatePasswordPolicy } from "~/lib/validate-password-policy";

const mockFindFirst = vi.mocked(db.registrationSettings.findFirst);
const mockIsPasswordInHistory = vi.mocked(isPasswordInHistory);

/** Helper: build a settings object with sensible defaults (all rules disabled). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSettings(overrides: Partial<{
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requiredSpecialChars: string | null;
  passwordHistoryDepth: number;
}> = {}): any {
  return {
    minPasswordLength: 8,
    requireUppercase: false,
    requireLowercase: false,
    requireNumbers: false,
    requiredSpecialChars: null,
    passwordHistoryDepth: 0,
    ...overrides,
  };
}

describe("validatePasswordPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPasswordInHistory.mockResolvedValue(false);
  });

  it("returns [] when password meets all policy rules", async () => {
    mockFindFirst.mockResolvedValue(makeSettings() as any);
    const violations = await validatePasswordPolicy("user-1", "password123");
    expect(violations).toEqual([]);
  });

  it("returns [] when no settings are found", async () => {
    mockFindFirst.mockResolvedValue(null);
    const violations = await validatePasswordPolicy("user-1", "x");
    expect(violations).toEqual([]);
  });

  it("returns a length violation when password is shorter than minPasswordLength", async () => {
    mockFindFirst.mockResolvedValue(makeSettings({ minPasswordLength: 12 }));
    const violations = await validatePasswordPolicy("user-1", "short");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("minLength");
    expect(violations[0].message).toBe("Password must be at least 12 characters");
  });

  it("returns an uppercase violation when requireUppercase is true and password has no uppercase", async () => {
    mockFindFirst.mockResolvedValue(makeSettings({ requireUppercase: true }));
    const violations = await validatePasswordPolicy("user-1", "alllowercase");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("uppercase");
    expect(violations[0].message).toContain("uppercase");
  });

  it("does not return uppercase violation when requireUppercase is false", async () => {
    mockFindFirst.mockResolvedValue(makeSettings({ requireUppercase: false }));
    const violations = await validatePasswordPolicy("user-1", "alllowercase");
    expect(violations).toEqual([]);
  });

  it("returns a lowercase violation when requireLowercase is true and password has no lowercase", async () => {
    mockFindFirst.mockResolvedValue(makeSettings({ requireLowercase: true }));
    const violations = await validatePasswordPolicy("user-1", "ALLUPPERCASE");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("lowercase");
    expect(violations[0].message).toContain("lowercase");
  });

  it("returns a numbers violation when requireNumbers is true and password has no digit", async () => {
    mockFindFirst.mockResolvedValue(makeSettings({ requireNumbers: true }));
    const violations = await validatePasswordPolicy("user-1", "NoDigitsHere");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("numbers");
    expect(violations[0].message).toContain("number");
  });

  it("returns a specialChars violation when requiredSpecialChars is set and password has none of those chars", async () => {
    mockFindFirst.mockResolvedValue(
      makeSettings({ requiredSpecialChars: "!@#$" })
    );
    const violations = await validatePasswordPolicy("user-1", "NoSpecialChars");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("specialChars");
    expect(violations[0].message).toContain("special character");
    expect(violations[0].message).toContain("!@#$");
  });

  it("does not return specialChars violation when password contains a required special char", async () => {
    mockFindFirst.mockResolvedValue(
      makeSettings({ requiredSpecialChars: "!@#$" })
    );
    const violations = await validatePasswordPolicy("user-1", "HasSpecial!");
    expect(violations).toEqual([]);
  });

  it("returns a history violation when password is in history (mock isPasswordInHistory returns true)", async () => {
    mockFindFirst.mockResolvedValue(
      makeSettings({ passwordHistoryDepth: 5 })
    );
    mockIsPasswordInHistory.mockResolvedValue(true);
    const violations = await validatePasswordPolicy("user-1", "OldPassword1");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("history");
    expect(violations[0].message).toContain("last 5 passwords");
    expect(mockIsPasswordInHistory).toHaveBeenCalledWith("user-1", "OldPassword1", 5);
  });

  it("skips history check when passwordHistoryDepth is 0", async () => {
    mockFindFirst.mockResolvedValue(
      makeSettings({ passwordHistoryDepth: 0 })
    );
    const violations = await validatePasswordPolicy("user-1", "AnyPassword1");
    expect(violations).toEqual([]);
    expect(mockIsPasswordInHistory).not.toHaveBeenCalled();
  });

  it("returns multiple violations when multiple rules fail simultaneously", async () => {
    mockFindFirst.mockResolvedValue(
      makeSettings({
        minPasswordLength: 20,
        requireUppercase: true,
        requireNumbers: true,
        requiredSpecialChars: "!@",
      })
    );
    // Short, all-lowercase, no digits, no special chars
    const violations = await validatePasswordPolicy("user-1", "short");
    expect(violations.length).toBeGreaterThanOrEqual(4);
    const rules = violations.map((v) => v.rule);
    expect(rules).toContain("minLength");
    expect(rules).toContain("uppercase");
    expect(rules).toContain("numbers");
    expect(rules).toContain("specialChars");
  });
});
