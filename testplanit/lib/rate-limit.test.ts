import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkPasswordAttemptLimit,
  recordPasswordAttempt,
  clearPasswordAttempts,
  getAttemptCount,
} from "./rate-limit";

describe("rate-limit", () => {
  const testIdentifier = "test-user-ip";

  beforeEach(() => {
    // Clear all attempts before each test
    clearPasswordAttempts(testIdentifier);
  });

  afterEach(() => {
    // Restore timers
    vi.useRealTimers();
  });

  describe("checkPasswordAttemptLimit", () => {
    describe("initial state", () => {
      it("should allow requests when no previous attempts", () => {
        const result = checkPasswordAttemptLimit(testIdentifier);

        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(4); // maxAttempts (5) - 1
        expect(result.resetAt).toBeNull();
      });

      it("should use default maxAttempts of 5", () => {
        const result = checkPasswordAttemptLimit(testIdentifier);

        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(4);
      });

      it("should use custom maxAttempts when provided", () => {
        const result = checkPasswordAttemptLimit(testIdentifier, 3);

        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(2); // maxAttempts (3) - 1
      });
    });

    describe("tracking attempts", () => {
      it("should decrement remaining attempts after each failed attempt", () => {
        // First attempt
        recordPasswordAttempt(testIdentifier);
        let result = checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(3);

        // Second attempt
        recordPasswordAttempt(testIdentifier);
        result = checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(2);

        // Third attempt
        recordPasswordAttempt(testIdentifier);
        result = checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(1);

        // Fourth attempt
        recordPasswordAttempt(testIdentifier);
        result = checkPasswordAttemptLimit(testIdentifier);
        expect(result.remainingAttempts).toBe(0);
      });

      it("should allow requests until max attempts reached", () => {
        // Attempts 1-4 should be allowed
        for (let i = 0; i < 4; i++) {
          recordPasswordAttempt(testIdentifier);
          const result = checkPasswordAttemptLimit(testIdentifier);
          expect(result.allowed).toBe(true);
        }

        // 5th attempt should still be allowed (total attempts = 4, limit = 5)
        recordPasswordAttempt(testIdentifier);
        const result = checkPasswordAttemptLimit(testIdentifier);
        expect(result.allowed).toBe(false);
        expect(result.remainingAttempts).toBe(0);
      });

      it("should block requests after max attempts reached", () => {
        // Record 5 attempts
        for (let i = 0; i < 5; i++) {
          recordPasswordAttempt(testIdentifier);
        }

        const result = checkPasswordAttemptLimit(testIdentifier);

        expect(result.allowed).toBe(false);
        expect(result.remainingAttempts).toBe(0);
        expect(result.resetAt).toBeInstanceOf(Date);
      });
    });

    describe("time windows", () => {
      it("should use default window of 15 minutes", () => {
        recordPasswordAttempt(testIdentifier);
        const result = checkPasswordAttemptLimit(testIdentifier);

        expect(result.resetAt).toBeInstanceOf(Date);
        const resetTime = result.resetAt!.getTime();
        const now = Date.now();
        const expectedWindow = 15 * 60 * 1000; // 15 minutes in ms
        const timeDiff = resetTime - now;

        // Allow small timing variance (±100ms)
        expect(timeDiff).toBeGreaterThan(expectedWindow - 100);
        expect(timeDiff).toBeLessThan(expectedWindow + 100);
      });

      it("should use custom window when provided", () => {
        const customWindow = 5 * 60 * 1000; // 5 minutes
        recordPasswordAttempt(testIdentifier, customWindow);
        const result = checkPasswordAttemptLimit(testIdentifier, 5, customWindow);

        const resetTime = result.resetAt!.getTime();
        const now = Date.now();
        const timeDiff = resetTime - now;

        // Allow small timing variance (±100ms)
        expect(timeDiff).toBeGreaterThan(customWindow - 100);
        expect(timeDiff).toBeLessThan(customWindow + 100);
      });

      it("should reset attempts after window expires", () => {
        vi.useFakeTimers();
        const now = Date.now();
        vi.setSystemTime(now);

        // Record 5 attempts
        for (let i = 0; i < 5; i++) {
          recordPasswordAttempt(testIdentifier);
        }

        // Should be blocked
        let result = checkPasswordAttemptLimit(testIdentifier);
        expect(result.allowed).toBe(false);

        // Fast-forward past the 15-minute window
        vi.setSystemTime(now + 16 * 60 * 1000);

        // Should be allowed again
        result = checkPasswordAttemptLimit(testIdentifier);
        expect(result.allowed).toBe(true);
        expect(result.remainingAttempts).toBe(4);
        expect(result.resetAt).toBeNull();

        vi.useRealTimers();
      });
    });

    describe("multiple identifiers", () => {
      it("should track different identifiers independently", () => {
        const identifier1 = "user1-ip";
        const identifier2 = "user2-ip";

        // Record 3 attempts for user1
        for (let i = 0; i < 3; i++) {
          recordPasswordAttempt(identifier1);
        }

        // Record 1 attempt for user2
        recordPasswordAttempt(identifier2);

        // Check limits independently
        const result1 = checkPasswordAttemptLimit(identifier1);
        const result2 = checkPasswordAttemptLimit(identifier2);

        expect(result1.remainingAttempts).toBe(1);
        expect(result2.remainingAttempts).toBe(3);

        // Clean up
        clearPasswordAttempts(identifier1);
        clearPasswordAttempts(identifier2);
      });

      it("should not affect other identifiers when one is blocked", () => {
        const identifier1 = "blocked-user";
        const identifier2 = "allowed-user";

        // Block identifier1
        for (let i = 0; i < 5; i++) {
          recordPasswordAttempt(identifier1);
        }

        const result1 = checkPasswordAttemptLimit(identifier1);
        const result2 = checkPasswordAttemptLimit(identifier2);

        expect(result1.allowed).toBe(false);
        expect(result2.allowed).toBe(true);

        // Clean up
        clearPasswordAttempts(identifier1);
        clearPasswordAttempts(identifier2);
      });
    });
  });

  describe("recordPasswordAttempt", () => {
    it("should create new entry on first attempt", () => {
      expect(getAttemptCount(testIdentifier)).toBe(0);

      recordPasswordAttempt(testIdentifier);

      expect(getAttemptCount(testIdentifier)).toBe(1);
    });

    it("should increment attempt count on subsequent attempts", () => {
      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(1);

      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(2);

      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(3);
    });

    it("should set reset time on first attempt", () => {
      recordPasswordAttempt(testIdentifier);

      const result = checkPasswordAttemptLimit(testIdentifier);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it("should maintain same reset time for subsequent attempts", () => {
      recordPasswordAttempt(testIdentifier);
      const result1 = checkPasswordAttemptLimit(testIdentifier);
      const resetTime1 = result1.resetAt?.getTime();

      // Small delay
      const delay = 10;
      const start = Date.now();
      while (Date.now() - start < delay) {
        // Wait
      }

      recordPasswordAttempt(testIdentifier);
      const result2 = checkPasswordAttemptLimit(testIdentifier);
      const resetTime2 = result2.resetAt?.getTime();

      expect(resetTime1).toBe(resetTime2);
    });

    it("should create new window if previous window expired", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      recordPasswordAttempt(testIdentifier);
      const result1 = checkPasswordAttemptLimit(testIdentifier);
      const resetTime1 = result1.resetAt?.getTime();

      // Fast-forward past window
      vi.setSystemTime(now + 16 * 60 * 1000);

      recordPasswordAttempt(testIdentifier);
      const result2 = checkPasswordAttemptLimit(testIdentifier);
      const resetTime2 = result2.resetAt?.getTime();

      expect(resetTime2).toBeGreaterThan(resetTime1!);
      expect(getAttemptCount(testIdentifier)).toBe(1); // Reset to 1

      vi.useRealTimers();
    });
  });

  describe("clearPasswordAttempts", () => {
    it("should remove all attempts for an identifier", () => {
      // Record some attempts
      for (let i = 0; i < 3; i++) {
        recordPasswordAttempt(testIdentifier);
      }

      expect(getAttemptCount(testIdentifier)).toBe(3);

      clearPasswordAttempts(testIdentifier);

      expect(getAttemptCount(testIdentifier)).toBe(0);
      const result = checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(4);
    });

    it("should allow requests immediately after clearing", () => {
      // Block the identifier
      for (let i = 0; i < 5; i++) {
        recordPasswordAttempt(testIdentifier);
      }

      let result = checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(false);

      clearPasswordAttempts(testIdentifier);

      result = checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
    });

    it("should be safe to call on non-existent identifier", () => {
      expect(() => {
        clearPasswordAttempts("non-existent-identifier");
      }).not.toThrow();
    });
  });

  describe("getAttemptCount", () => {
    it("should return 0 for identifier with no attempts", () => {
      expect(getAttemptCount(testIdentifier)).toBe(0);
    });

    it("should return correct attempt count", () => {
      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(1);

      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(2);

      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(3);
    });

    it("should return 0 after window expires", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(1);

      // Fast-forward past window
      vi.setSystemTime(now + 16 * 60 * 1000);

      expect(getAttemptCount(testIdentifier)).toBe(0);

      vi.useRealTimers();
    });

    it("should return 0 after clearing attempts", () => {
      recordPasswordAttempt(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(1);

      clearPasswordAttempts(testIdentifier);
      expect(getAttemptCount(testIdentifier)).toBe(0);
    });
  });

  describe("realistic scenarios", () => {
    it("should handle successful verification flow", () => {
      // User makes 2 failed attempts
      recordPasswordAttempt(testIdentifier);
      recordPasswordAttempt(testIdentifier);

      let result = checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(2);

      // User succeeds, attempts are cleared
      clearPasswordAttempts(testIdentifier);

      // Fresh start
      result = checkPasswordAttemptLimit(testIdentifier);
      expect(result.allowed).toBe(true);
      expect(result.remainingAttempts).toBe(4);
    });

    it("should handle brute force attempt", () => {
      // Attacker makes 10 attempts
      for (let i = 0; i < 10; i++) {
        const result = checkPasswordAttemptLimit(testIdentifier);

        if (result.allowed) {
          recordPasswordAttempt(testIdentifier);
        } else {
          // Should be blocked after 5 attempts
          expect(i).toBeGreaterThanOrEqual(5);
          expect(result.allowed).toBe(false);
          expect(result.remainingAttempts).toBe(0);
          break;
        }
      }

      // Verify final state is blocked
      const finalResult = checkPasswordAttemptLimit(testIdentifier);
      expect(finalResult.allowed).toBe(false);
    });

    it("should handle shareKey:IP combination identifier format", () => {
      const shareKey = "abc123def456";
      const ipAddress = "192.168.1.1";
      const rateLimitId = `${shareKey}:${ipAddress}`;

      recordPasswordAttempt(rateLimitId);
      const result = checkPasswordAttemptLimit(rateLimitId);

      expect(result.allowed).toBe(true);
      expect(getAttemptCount(rateLimitId)).toBe(1);

      clearPasswordAttempts(rateLimitId);
    });
  });
});
