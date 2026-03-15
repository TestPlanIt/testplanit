import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock valkey module — null by default (no connection)
const mockIncr = vi.fn();
const mockExpire = vi.fn();

vi.mock("./valkey", () => ({
  default: null,
}));

import {
  checkApiRateLimit,
  getTierLimit,
  _resetForTesting
} from "./api-rate-limit";

// Helper to enable the mock Valkey connection for specific tests
async function withValkeyMock(
  fn: () => Promise<void>,
  incrImpl?: (key: string) => number | Promise<number>
) {
  const mod = await import("./valkey");
  const original = mod.default;
  // @ts-expect-error — replacing the default export for testing
  mod.default = {
    incr: incrImpl ? vi.fn(incrImpl) : mockIncr,
    expire: mockExpire,
  };
  try {
    await fn();
  } finally {
    mod.default = original;
  }
}

describe("api-rate-limit", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.unstubAllEnvs();
    mockIncr.mockReset();
    mockExpire.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("getTierLimit", () => {
    it("should return 1000 for essentials tier", () => {
      vi.stubEnv("TIER", "essentials");
      expect(getTierLimit()).toBe(1_000);
    });

    it("should return 5000 for team tier", () => {
      vi.stubEnv("TIER", "team");
      expect(getTierLimit()).toBe(5_000);
    });

    it("should return 10000 for professional tier", () => {
      vi.stubEnv("TIER", "professional");
      expect(getTierLimit()).toBe(10_000);
    });

    it("should return 25000 for dedicated tier", () => {
      vi.stubEnv("TIER", "dedicated");
      expect(getTierLimit()).toBe(25_000);
    });

    it("should be case-insensitive", () => {
      vi.stubEnv("TIER", "Team");
      expect(getTierLimit()).toBe(5_000);

      vi.stubEnv("TIER", "PROFESSIONAL");
      expect(getTierLimit()).toBe(10_000);

      vi.stubEnv("TIER", "Dedicated");
      expect(getTierLimit()).toBe(25_000);
    });

    it("should default to essentials for unknown tier", () => {
      vi.stubEnv("TIER", "unknown");
      expect(getTierLimit()).toBe(1_000);
    });

    it("should default to essentials when TIER env var is not set", () => {
      vi.stubEnv("TIER", "");
      expect(getTierLimit()).toBe(1_000);
    });
  });

  describe("checkApiRateLimit (in-memory fallback)", () => {
    // With valkey mocked as null, these test the in-memory fallback path

    it("should allow requests under the limit", async () => {
      vi.stubEnv("TIER", "essentials");

      const result = await checkApiRateLimit();

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(1_000);
      expect(result.remaining).toBe(999);
    });

    it("should decrement remaining with each call", async () => {
      vi.stubEnv("TIER", "essentials");

      const result1 = await checkApiRateLimit();
      expect(result1.remaining).toBe(999);

      const result2 = await checkApiRateLimit();
      expect(result2.remaining).toBe(998);

      const result3 = await checkApiRateLimit();
      expect(result3.remaining).toBe(997);
    });

    it("should return allowed=false when limit is exceeded", async () => {
      vi.stubEnv("TIER", "essentials");

      // Exhaust the limit
      for (let i = 0; i < 1_000; i++) {
        const result = await checkApiRateLimit();
        expect(result.allowed).toBe(true);
      }

      // Next request should be blocked
      const result = await checkApiRateLimit();
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(1_000);
    });

    it("should return a resetAt timestamp aligned to the next hour boundary", async () => {
      vi.useFakeTimers();
      // Set time to 2024-01-01 10:30:00 UTC
      const fixedTime = new Date("2024-01-01T10:30:00Z").getTime();
      vi.setSystemTime(fixedTime);

      const result = await checkApiRateLimit();

      // resetAt should be 2024-01-01 11:00:00 UTC
      const expectedResetAt =
        new Date("2024-01-01T11:00:00Z").getTime() / 1000;
      expect(result.resetAt).toBe(expectedResetAt);
    });

    it("should reset the counter when a new hour window starts", async () => {
      vi.useFakeTimers();
      vi.stubEnv("TIER", "essentials");

      // Set time to 10:30:00
      vi.setSystemTime(new Date("2024-01-01T10:30:00Z").getTime());

      // Use up some of the limit
      for (let i = 0; i < 500; i++) {
        await checkApiRateLimit();
      }

      let result = await checkApiRateLimit();
      expect(result.remaining).toBe(499);

      // Advance to next hour (11:00:00)
      vi.setSystemTime(new Date("2024-01-01T11:00:00Z").getTime());

      // Counter should be reset
      result = await checkApiRateLimit();
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(999);
    });

    it("should respect different tier limits", async () => {
      vi.stubEnv("TIER", "team");

      const result = await checkApiRateLimit();

      expect(result.limit).toBe(5_000);
      expect(result.remaining).toBe(4_999);
    });

    it("should clean up old window entries", async () => {
      vi.useFakeTimers();

      // Set time to hour 10
      vi.setSystemTime(new Date("2024-01-01T10:00:00Z").getTime());
      await checkApiRateLimit();

      // Advance to hour 11
      vi.setSystemTime(new Date("2024-01-01T11:00:00Z").getTime());
      await checkApiRateLimit();

      // Advance to hour 12 — hour 10 entry should be cleaned up
      vi.setSystemTime(new Date("2024-01-01T12:00:00Z").getTime());
      const result = await checkApiRateLimit();

      // Should only count this request (new window)
      expect(result.remaining).toBe(999);
    });
  });

  describe("checkApiRateLimit (with Valkey)", () => {
    it("should use Valkey INCR for counting", async () => {
      vi.stubEnv("TIER", "essentials");
      let callCount = 0;

      await withValkeyMock(async () => {
        mockIncr.mockResolvedValue(1);
        mockExpire.mockResolvedValue(1);

        const result = await checkApiRateLimit();

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(999);
        expect(mockIncr).toHaveBeenCalledTimes(1);
        expect(mockIncr.mock.calls[0][0]).toMatch(
          /^ratelimit:api:global:\d+$/
        );
      });
    });

    it("should set TTL on first increment", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockIncr.mockResolvedValue(1); // count = 1 → first increment
        mockExpire.mockResolvedValue(1);

        await checkApiRateLimit();

        expect(mockExpire).toHaveBeenCalledTimes(1);
        expect(mockExpire.mock.calls[0][1]).toBe(7200); // 2-hour TTL
      });
    });

    it("should NOT set TTL on subsequent increments", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockIncr.mockResolvedValue(5); // count > 1
        mockExpire.mockResolvedValue(1);

        await checkApiRateLimit();

        expect(mockExpire).not.toHaveBeenCalled();
      });
    });

    it("should return allowed=false when Valkey count exceeds limit", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockIncr.mockResolvedValue(1_001); // over the 1000 limit

        const result = await checkApiRateLimit();

        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
      });
    });

    it("should fall back to in-memory on Valkey error", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockIncr.mockRejectedValue(new Error("Connection refused"));

        const result = await checkApiRateLimit();

        // Should fall back gracefully, not throw
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(999);
      });
    });
  });
});
