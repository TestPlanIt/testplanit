import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Null by default so this suite exercises the in-memory FALLBACK path. The
// Valkey-backed path — the one that actually ships — is covered in the
// "shared across instances" block at the bottom of this file.
vi.mock("./valkey", () => ({ default: null }));

import {
  _resetForTesting,
  checkPasswordAttemptLimit,
  clearPasswordAttempts,
  getAttemptCount,
  recordPasswordAttempt,
} from "./rate-limit";

describe("rate-limit", () => {
  const testIdentifier = "test-user-ip";

  beforeEach(async () => {
    // Clear all attempts before each test
    _resetForTesting();
    await clearPasswordAttempts(testIdentifier);
  });

  afterEach(async () => {
    // Restore timers
    vi.useRealTimers();
  });

  describe("checkPasswordAttemptLimit", () => {
    describe("initial state", () => {
      it("should allow requests when no previous attempts", async () => {
        const result = await checkPasswordAttemptLimit(testIdentifier);

        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(4); // maxAttempts (5) - 1
        expect(result.resetAt).toBeNull();
      });

      it("should use default maxAttempts of 5", async () => {
        const result = await checkPasswordAttemptLimit(testIdentifier);

        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(4);
      });

      it("should use custom maxAttempts when provided", async () => {
        const result = await checkPasswordAttemptLimit(testIdentifier, 3);

        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(2); // maxAttempts (3) - 1
      });
    });

    describe("tracking attempts", () => {
      it("should decrement remaining attempts after each failed attempt", async () => {
        // First attempt
        await recordPasswordAttempt(testIdentifier);
        let result = await checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(3);

        // Second attempt
        await recordPasswordAttempt(testIdentifier);
        result = await checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(2);

        // Third attempt
        await recordPasswordAttempt(testIdentifier);
        result = await checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(1);

        // Fourth attempt
        await recordPasswordAttempt(testIdentifier);
        result = await checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(0);
      });

      it("should allow requests until max attempts reached", async () => {
        // Attempts 1-4 should be allowed
        for (let i = 0; i < 4; i++) {
          await recordPasswordAttempt(testIdentifier);
          const result = await checkPasswordAttemptLimit(testIdentifier);
          expect(result.allowed).toBe(true);
        }

        // 5th attempt should still be allowed (total attempts = 4, limit = 5)
        await recordPasswordAttempt(testIdentifier);
        const result = await checkPasswordAttemptLimit(testIdentifier);
        expect(result.allowed).toBe(false);
        expect(result.remainingAttempts).toBe(0);
      });

      it("should block requests after max attempts reached", async () => {
        // Record 5 attempts
        for (let i = 0; i < 5; i++) {
          await recordPasswordAttempt(testIdentifier);
        }

        const result = await checkPasswordAttemptLimit(testIdentifier);

        expect(result.allowed).toBe(false);
        expect(result.remainingAttempts).toBe(0);
        expect(result.resetAt).toBeInstanceOf(Date);
      });
    });

    describe("time windows", () => {
      it("should use default window of 15 minutes", async () => {
        await recordPasswordAttempt(testIdentifier);
        const result = await checkPasswordAttemptLimit(testIdentifier);

        expect(result.resetAt).toBeInstanceOf(Date);
        const resetTime = result.resetAt!.getTime();
        const now = Date.now();
        const expectedWindow = 15 * 60 * 1000; // 15 minutes in ms
        const timeDiff = resetTime - now;

        // Allow small timing variance (±100ms)
        expect(timeDiff).toBeGreaterThan(expectedWindow - 100);
        expect(timeDiff).toBeLessThan(expectedWindow + 100);
      });

      it("should use custom window when provided", async () => {
        const customWindow = 5 * 60 * 1000; // 5 minutes
        await recordPasswordAttempt(testIdentifier, customWindow);
        const result = await checkPasswordAttemptLimit(
          testIdentifier,
          5,
          customWindow
        );

        const resetTime = result.resetAt!.getTime();
        const now = Date.now();
        const timeDiff = resetTime - now;

        // Allow small timing variance (±100ms)
        expect(timeDiff).toBeGreaterThan(customWindow - 100);
        expect(timeDiff).toBeLessThan(customWindow + 100);
      });

      it("should reset attempts after window expires", async () => {
        vi.useFakeTimers();
        const now = Date.now();
        vi.setSystemTime(now);

        // Record 5 attempts
        for (let i = 0; i < 5; i++) {
          await recordPasswordAttempt(testIdentifier);
        }

        // Should be blocked
        let result = await checkPasswordAttemptLimit(testIdentifier);
        expect(result.allowed).toBe(false);

        // Fast-forward past the 15-minute window
        vi.setSystemTime(now + 16 * 60 * 1000);

        // Should be allowed again
        result = await checkPasswordAttemptLimit(testIdentifier);
        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(4);
        expect(result.resetAt).toBeNull();

        vi.useRealTimers();
      });
    });

    describe("multiple identifiers", () => {
      it("should track different identifiers independently", async () => {
        const identifier1 = "user1-ip";
        const identifier2 = "user2-ip";

        // Record 3 attempts for user1
        for (let i = 0; i < 3; i++) {
          await recordPasswordAttempt(identifier1);
        }

        // Record 1 attempt for user2
        await recordPasswordAttempt(identifier2);

        // Check limits independently
        const result1 = await checkPasswordAttemptLimit(identifier1);
        const result2 = await checkPasswordAttemptLimit(identifier2);

        expect(result1.remainingAttempts).toBe(1);
        expect(result2.remainingAttempts).toBe(3);

        // Clean up
        await clearPasswordAttempts(identifier1);
        await clearPasswordAttempts(identifier2);
      });

      it("should not affect other identifiers when one is blocked", async () => {
        const identifier1 = "blocked-user";
        const identifier2 = "allowed-user";

        // Block identifier1
        for (let i = 0; i < 5; i++) {
          await recordPasswordAttempt(identifier1);
        }

        const result1 = await checkPasswordAttemptLimit(identifier1);
        const result2 = await checkPasswordAttemptLimit(identifier2);

        expect(result1.allowed).toBe(false);
        expect(result2.allowed).toBe(true);

        // Clean up
        await clearPasswordAttempts(identifier1);
        await clearPasswordAttempts(identifier2);
      });
    });
  });

  describe("recordPasswordAttempt", () => {
    it("should create new entry on first attempt", async () => {
      expect(await getAttemptCount(testIdentifier)).toBe(0);

      await recordPasswordAttempt(testIdentifier);

      expect(await getAttemptCount(testIdentifier)).toBe(1);
    });

    it("should increment attempt count on subsequent attempts", async () => {
      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(1);

      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(2);

      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(3);
    });

    it("should set reset time on first attempt", async () => {
      await recordPasswordAttempt(testIdentifier);

      const result = await checkPasswordAttemptLimit(testIdentifier);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it("should maintain same reset time for subsequent attempts", async () => {
      await recordPasswordAttempt(testIdentifier);
      const result1 = await checkPasswordAttemptLimit(testIdentifier);
      const resetTime1 = result1.resetAt?.getTime();

      // Small delay
      const delay = 10;
      const start = Date.now();
      while (Date.now() - start < delay) {
        // Wait
      }

      await recordPasswordAttempt(testIdentifier);
      const result2 = await checkPasswordAttemptLimit(testIdentifier);
      const resetTime2 = result2.resetAt?.getTime();

      expect(resetTime1).toBe(resetTime2);
    });

    it("should create new window if previous window expired", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await recordPasswordAttempt(testIdentifier);
      const result1 = await checkPasswordAttemptLimit(testIdentifier);
      const resetTime1 = result1.resetAt?.getTime();

      // Fast-forward past window
      vi.setSystemTime(now + 16 * 60 * 1000);

      await recordPasswordAttempt(testIdentifier);
      const result2 = await checkPasswordAttemptLimit(testIdentifier);
      const resetTime2 = result2.resetAt?.getTime();

      expect(resetTime2).toBeGreaterThan(resetTime1!);
      expect(await getAttemptCount(testIdentifier)).toBe(1); // Reset to 1

      vi.useRealTimers();
    });
  });

  describe("clearPasswordAttempts", () => {
    it("should remove all attempts for an identifier", async () => {
      // Record some attempts
      for (let i = 0; i < 3; i++) {
        await recordPasswordAttempt(testIdentifier);
      }

      expect(await getAttemptCount(testIdentifier)).toBe(3);

      await clearPasswordAttempts(testIdentifier);

      expect(await getAttemptCount(testIdentifier)).toBe(0);
      const result = await checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(4);
    });

    it("should allow requests immediately after clearing", async () => {
      // Block the identifier
      for (let i = 0; i < 5; i++) {
        await recordPasswordAttempt(testIdentifier);
      }

      let result = await checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(false);

      await clearPasswordAttempts(testIdentifier);

      result = await checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
    });

    it("should be safe to call on non-existent identifier", async () => {
      await expect(
        clearPasswordAttempts("non-existent-identifier")
      ).resolves.toBeUndefined();
    });
  });

  describe("getAttemptCount", () => {
    it("should return 0 for identifier with no attempts", async () => {
      expect(await getAttemptCount(testIdentifier)).toBe(0);
    });

    it("should return correct attempt count", async () => {
      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(1);

      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(2);

      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(3);
    });

    it("should return 0 after window expires", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(1);

      // Fast-forward past window
      vi.setSystemTime(now + 16 * 60 * 1000);

      expect(await getAttemptCount(testIdentifier)).toBe(0);

      vi.useRealTimers();
    });

    it("should return 0 after clearing attempts", async () => {
      await recordPasswordAttempt(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(1);

      await clearPasswordAttempts(testIdentifier);
      expect(await getAttemptCount(testIdentifier)).toBe(0);
    });
  });

  describe("realistic scenarios", () => {
    it("should handle successful verification flow", async () => {
      // User makes 2 failed attempts
      await recordPasswordAttempt(testIdentifier);
      await recordPasswordAttempt(testIdentifier);

      let result = await checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(2);

      // User succeeds, attempts are cleared
      await clearPasswordAttempts(testIdentifier);

      // Fresh start
      result = await checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(4);
    });

    it("should handle brute force attempt", async () => {
      // Attacker makes 10 attempts
      for (let i = 0; i < 10; i++) {
        const result = await checkPasswordAttemptLimit(testIdentifier);

        if (result.allowed) {
          await recordPasswordAttempt(testIdentifier);
        } else {
          // Should be blocked after 5 attempts
          expect(i).toBeGreaterThanOrEqual(5);
          expect(result.allowed).toBe(false);
          expect(result.remainingAttempts).toBe(0);
          break;
        }
      }

      // Verify final state is blocked
      const finalResult = await checkPasswordAttemptLimit(testIdentifier);
      expect(finalResult.allowed).toBe(false);
    });

    it("should handle shareKey:IP combination identifier format", async () => {
      const shareKey = "abc123def456";
      const ipAddress = "192.168.1.1";
      const rateLimitId = `${shareKey}:${ipAddress}`;

      await recordPasswordAttempt(rateLimitId);
      const result = await checkPasswordAttemptLimit(rateLimitId);

      expect(result.allowed).toBe(true);
      expect(await getAttemptCount(rateLimitId)).toBe(1);

      await clearPasswordAttempts(rateLimitId);
    });
  });
});

/**
 * The reason this module is Valkey-backed at all.
 *
 * The app runs as a load-balanced PAIR, and the in-memory `Map` these functions
 * used to rely on is per-process — so an attacker's failed attempts split
 * between the two instances and the effective allowance roughly doubled. These
 * tests import the module TWICE against ONE shared fake Valkey, which is what
 * two app processes sharing one Valkey actually look like.
 */
describe("rate-limit — shared across instances (Valkey path)", () => {
  function makeFakeValkey() {
    const store = new Map<string, string>();
    const ttls = new Map<string, number>();
    return {
      store,
      ttls,
      redis: {
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        incr: vi.fn(async (k: string) => {
          const next = Number(store.get(k) ?? 0) + 1;
          store.set(k, String(next));
          return next;
        }),
        pexpire: vi.fn(async (k: string, ms: number) => {
          ttls.set(k, ms);
          return 1;
        }),
        // -2 when the key is missing, mirroring real PTTL semantics.
        pttl: vi.fn(async (k: string) =>
          store.has(k) ? (ttls.get(k) ?? -1) : -2
        ),
        del: vi.fn(async (k: string) => {
          ttls.delete(k);
          return store.delete(k) ? 1 : 0;
        }),
      },
    };
  }

  async function twoInstances(redis: unknown) {
    vi.resetModules();
    vi.doMock("./valkey", () => ({ default: redis }));
    const a = await import("./rate-limit");
    vi.resetModules();
    vi.doMock("./valkey", () => ({ default: redis }));
    const b = await import("./rate-limit");
    return { a, b };
  }

  afterEach(() => {
    vi.doUnmock("./valkey");
  });

  it("counts failures from both instances against one limit", async () => {
    const { redis } = makeFakeValkey();
    const { a, b } = await twoInstances(redis);
    const id = "share-abc:203.0.113.7";

    // Three failures land on instance A, two on instance B — five total,
    // against a default max of five.
    await a.recordPasswordAttempt(id);
    await a.recordPasswordAttempt(id);
    await a.recordPasswordAttempt(id);
    await b.recordPasswordAttempt(id);
    await b.recordPasswordAttempt(id);

    // Both instances must now deny. Before the Valkey port each kept its own
    // Map, saw only its own share, and both would still have allowed more.
    expect((await a.checkPasswordAttemptLimit(id)).allowed).toBe(false);
    expect((await b.checkPasswordAttemptLimit(id)).allowed).toBe(false);
    expect(await b.getAttemptCount(id)).toBe(5);
  });

  it("anchors the window to the first failure, not the latest", async () => {
    const { redis, ttls } = makeFakeValkey();
    const { a, b } = await twoInstances(redis);
    const id = "share-def:203.0.113.8";

    await a.recordPasswordAttempt(id, 60_000);
    // A later failure on the OTHER instance must not push the reset out.
    await b.recordPasswordAttempt(id, 999_000);

    expect(redis.pexpire).toHaveBeenCalledTimes(1);
    expect(ttls.get("rl:pwd:" + id)).toBe(60_000);
  });

  it("reports resetAt from the shared TTL", async () => {
    const { redis } = makeFakeValkey();
    const { a, b } = await twoInstances(redis);
    const id = "share-ghi:203.0.113.9";

    await a.recordPasswordAttempt(id, 60_000);
    const result = await b.checkPasswordAttemptLimit(id);

    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(3);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it("a success on one instance clears the counter for the other", async () => {
    const { redis } = makeFakeValkey();
    const { a, b } = await twoInstances(redis);
    const id = "share-jkl:203.0.113.10";

    for (let i = 0; i < 5; i++) await a.recordPasswordAttempt(id);
    expect((await b.checkPasswordAttemptLimit(id)).allowed).toBe(false);

    await a.clearPasswordAttempts(id);

    expect((await b.checkPasswordAttemptLimit(id)).allowed).toBe(true);
    expect(await b.getAttemptCount(id)).toBe(0);
  });

  it("falls back to the in-memory limit when Valkey throws", async () => {
    const boom = {
      get: vi.fn(async () => {
        throw new Error("valkey down");
      }),
      incr: vi.fn(async () => {
        throw new Error("valkey down");
      }),
      pexpire: vi.fn(async () => 1),
      pttl: vi.fn(async () => -2),
      del: vi.fn(async () => 1),
    };
    vi.resetModules();
    vi.doMock("./valkey", () => ({ default: boom }));
    const mod = await import("./rate-limit");
    const id = "share-mno:203.0.113.11";

    // Degrades to the loose per-process limit rather than throwing or
    // locking the caller out entirely.
    for (let i = 0; i < 5; i++) await mod.recordPasswordAttempt(id);
    expect((await mod.checkPasswordAttemptLimit(id)).allowed).toBe(false);
  });
});
