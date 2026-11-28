// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCompare, mockCheckRateLimit } = vi.hoisted(() => ({
  mockCompare: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock("bcrypt", () => ({ default: { compare: mockCompare } }));
vi.mock("~/lib/auth-security", () => ({ checkRateLimit: mockCheckRateLimit }));

import {
  CURRENT_PASSWORD_RATE_LIMIT,
  hasRealPassword,
  verifyCurrentPassword,
} from "./verifyCurrentPassword";

const HASH = "$2b$10$abcdefghijklmnopqrstuv";

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue(true);
  mockCompare.mockResolvedValue(true);
});

describe("hasRealPassword", () => {
  it("accepts bcrypt hashes", () => {
    expect(hasRealPassword(HASH)).toBe(true);
    expect(hasRealPassword("$2a$10$abcdefghijklmnopqrstuv")).toBe(true);
  });

  it("rejects placeholders and missing passwords", () => {
    expect(hasRealPassword("3f0c2c1e-7d0b-4c7b-9c57-0f1f4a4c9a11")).toBe(false);
    expect(hasRealPassword(null)).toBe(false);
    expect(hasRealPassword(undefined)).toBe(false);
  });
});

describe("verifyCurrentPassword", () => {
  it("accepts the right password", async () => {
    expect(await verifyCurrentPassword("user-1", HASH, "secret")).toBe("ok");
    expect(mockCompare).toHaveBeenCalledWith("secret", HASH);
  });

  it("rejects the wrong password", async () => {
    mockCompare.mockResolvedValue(false);
    expect(await verifyCurrentPassword("user-1", HASH, "nope")).toBe("invalid");
  });

  it("reports an account with no password of its own", async () => {
    expect(await verifyCurrentPassword("user-1", null, "secret")).toBe(
      "not_set"
    );
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it("rejects a missing candidate without spending an attempt", async () => {
    expect(await verifyCurrentPassword("user-1", HASH, "")).toBe("invalid");
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("stops comparing once the user is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    expect(await verifyCurrentPassword("user-1", HASH, "secret")).toBe(
      "rate_limited"
    );
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it("counts every caller against one per-user limit", async () => {
    await verifyCurrentPassword("user-1", HASH, "secret");
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "current-password:user-1",
      CURRENT_PASSWORD_RATE_LIMIT
    );
  });
});
