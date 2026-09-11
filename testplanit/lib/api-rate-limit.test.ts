import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock valkey module — null by default (no connection)
const mockEval = vi.fn();

vi.mock("./valkey", () => ({
  default: null,
}));

import {
  checkApiRateLimit,
  getTierLimit,
  _resetForTesting,
} from "./api-rate-limit";

type EvalImpl = (
  script: string,
  numKeys: number,
  key: string,
  ttl: number
) => number | Promise<number>;

// Helper to enable the mock Valkey connection for specific tests. The client
// exposes only `eval`: the limiter must count through the atomic script, never
// through separate INCR/EXPIRE round-trips.
async function withValkeyMock(fn: () => Promise<void>, evalImpl?: EvalImpl) {
  const mod = await import("./valkey");
  const original = mod.default;
  // @ts-expect-error — replacing the default export for testing
  mod.default = { eval: evalImpl ? vi.fn(evalImpl) : mockEval };
  try {
    await fn();
  } finally {
    mod.default = original;
  }
}

// Server-side emulation of the script: INCR, and EXPIRE only on the first hit.
function scriptedValkey() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const impl: EvalImpl = (_script, _numKeys, key, ttl) => {
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (next === 1) ttls.set(key, Number(ttl));
    return next;
  };
  return { counts, ttls, impl };
}

describe("api-rate-limit", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.unstubAllEnvs();
    mockEval.mockReset();
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

    it("should default to professional for unknown tier", () => {
      vi.stubEnv("TIER", "unknown");
      expect(getTierLimit()).toBe(10_000);
    });

    it("should default to professional when TIER env var is not set", () => {
      vi.stubEnv("TIER", "");
      expect(getTierLimit()).toBe(10_000);
    });

    describe("API_RATE_LIMIT override", () => {
      it("should use API_RATE_LIMIT when set to a positive integer", () => {
        vi.stubEnv("API_RATE_LIMIT", "100000");
        expect(getTierLimit()).toBe(100_000);
      });

      it("should take precedence over TIER", () => {
        vi.stubEnv("TIER", "essentials");
        vi.stubEnv("API_RATE_LIMIT", "50000");
        expect(getTierLimit()).toBe(50_000);
      });

      it("should ignore surrounding whitespace", () => {
        vi.stubEnv("API_RATE_LIMIT", "  75000  ");
        expect(getTierLimit()).toBe(75_000);
      });

      it.each(["0", "-100", "abc", "10.5", "1e5", "1_000", " "])(
        "should ignore invalid value %j and fall back to TIER",
        (value) => {
          vi.stubEnv("TIER", "team");
          vi.stubEnv("API_RATE_LIMIT", value);
          expect(getTierLimit()).toBe(5_000);
        }
      );
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
      const expectedResetAt = new Date("2024-01-01T11:00:00Z").getTime() / 1000;
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
      vi.stubEnv("TIER", "essentials");
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
    it("counts through one atomic script call per request", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockEval.mockResolvedValue(1);

        const result = await checkApiRateLimit();

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(999);
        expect(mockEval).toHaveBeenCalledTimes(1);
        const [script, numKeys, key, ttl] = mockEval.mock.calls[0];
        expect(numKeys).toBe(1);
        expect(key).toMatch(/^ratelimit:api:global:\d+$/);
        expect(ttl).toBe(7200); // 2-hour TTL
        // The script itself carries both halves of the window bookkeeping.
        expect(script).toMatch(/INCR/);
        expect(script).toMatch(/EXPIRE/);
        expect(script).toMatch(/count == 1/);
      });
    });

    it("arms the TTL once per window, never on later hits", async () => {
      vi.stubEnv("TIER", "essentials");
      const valkey = scriptedValkey();

      await withValkeyMock(async () => {
        for (let i = 0; i < 10; i++) await checkApiRateLimit();

        // Ten increments, one EXPIRE — the key is not re-armed on every
        // request, which would slide the window forward indefinitely.
        expect([...valkey.counts.values()]).toEqual([10]);
        expect([...valkey.ttls.values()]).toEqual([7200]);
      }, valkey.impl);
    });

    it("should return allowed=false when Valkey count exceeds limit", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockEval.mockResolvedValue(1_001); // over the 1000 limit

        const result = await checkApiRateLimit();

        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
      });
    });

    it("coerces a string reply from the script into a number", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockEval.mockResolvedValue("1000" as unknown as number);

        const result = await checkApiRateLimit();

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(0);
      });
    });

    it("falls back to in-memory on a Valkey error and counts the request once", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockEval.mockRejectedValue(new Error("Connection refused"));
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const result = await checkApiRateLimit();

        // Should fall back gracefully, not throw; counted exactly once.
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(999);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[API Rate Limit] Valkey error, falling back to in-memory:",
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
      });
    });

    it("counts the window key derived from the clock, not a fixed key", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T10:30:00Z").getTime());
      const valkey = scriptedValkey();

      await withValkeyMock(async () => {
        await checkApiRateLimit();
        // Next hour → a different fixed-window key, so the counter restarts.
        vi.setSystemTime(new Date("2024-01-01T11:00:00Z").getTime());
        await checkApiRateLimit();

        const windowAt = (iso: string) =>
          Math.floor(new Date(iso).getTime() / 1000 / 3600);
        const firstKey = `ratelimit:api:global:${windowAt("2024-01-01T10:30:00Z")}`;
        const secondKey = `ratelimit:api:global:${windowAt("2024-01-01T11:00:00Z")}`;
        expect(secondKey).not.toBe(firstKey);
        expect([...valkey.counts.keys()]).toEqual([firstKey, secondKey]);
        // TTL is armed per window, on the first increment of each.
        expect([...valkey.ttls.keys()]).toEqual([firstKey, secondKey]);
      }, valkey.impl);
    });

    it("reports remaining from the Valkey count, not a local tally", async () => {
      vi.stubEnv("TIER", "team");

      await withValkeyMock(async () => {
        // Another instance already burned 4,000 of the shared window.
        mockEval.mockResolvedValue(4_001);

        const result = await checkApiRateLimit();

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(5_000);
        expect(result.remaining).toBe(999);
      });
    });

    it("allows the request that exactly reaches the limit, blocks the next", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockEval.mockResolvedValueOnce(1_000);
        const atLimit = await checkApiRateLimit();
        expect(atLimit.allowed).toBe(true);
        expect(atLimit.remaining).toBe(0);

        mockEval.mockResolvedValueOnce(1_001);
        const over = await checkApiRateLimit();
        expect(over.allowed).toBe(false);
        expect(over.remaining).toBe(0);
      });
    });

    it("clamps remaining at zero rather than going negative once over", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockEval.mockResolvedValue(50_000);

        const result = await checkApiRateLimit();

        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
      });
    });

    it("honours the API_RATE_LIMIT override on the Valkey path", async () => {
      vi.stubEnv("TIER", "essentials");
      vi.stubEnv("API_RATE_LIMIT", "3");

      await withValkeyMock(async () => {
        mockEval.mockResolvedValueOnce(3);
        const atLimit = await checkApiRateLimit();
        expect(atLimit.limit).toBe(3);
        expect(atLimit.allowed).toBe(true);

        mockEval.mockResolvedValueOnce(4);
        expect((await checkApiRateLimit()).allowed).toBe(false);
      });
    });

    it("returns a resetAt aligned to the next hour boundary", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T10:30:00Z").getTime());

      await withValkeyMock(async () => {
        mockEval.mockResolvedValue(7);

        const result = await checkApiRateLimit();

        expect(result.resetAt).toBe(
          new Date("2024-01-01T11:00:00Z").getTime() / 1000
        );
      });
    });

    it("keeps counting in memory while Valkey stays down", async () => {
      vi.stubEnv("TIER", "essentials");

      await withValkeyMock(async () => {
        mockEval.mockRejectedValue(new Error("Connection refused"));
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        expect((await checkApiRateLimit()).remaining).toBe(999);
        expect((await checkApiRateLimit()).remaining).toBe(998);
        expect((await checkApiRateLimit()).remaining).toBe(997);

        consoleErrorSpy.mockRestore();
      });
    });

    it("bypasses Valkey entirely when rate limiting is disabled", async () => {
      vi.stubEnv("TIER", "essentials");
      vi.stubEnv("DISABLE_API_RATE_LIMIT", "true");

      await withValkeyMock(async () => {
        const result = await checkApiRateLimit();

        expect(result).toMatchObject({
          allowed: true,
          limit: 1_000,
          remaining: 1_000,
        });
        expect(mockEval).not.toHaveBeenCalled();
      });
    });
  });
});
