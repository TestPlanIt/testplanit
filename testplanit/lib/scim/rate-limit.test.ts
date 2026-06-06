/**
 * Unit tests for the per-SCIM-token rate-limit module.
 *
 * Coverage surface:
 *
 *   Group A — happy-path result shape
 *   Group B — Valkey-backed path (incr + first-hit expire)
 *   Group C — in-memory fallback path (Map cleanup + boundary rollover)
 *   Group D — fail-open on Valkey error + DISABLE_SCIM_RATE_LIMIT knob
 *   Group E — _resetForTesting hook
 *
 * Mock shape: vi.mock("~/lib/valkey", { default: null }) by default; specific
 * tests opt into a mock Valkey client via withValkeyMock helper (mirrors the
 * existing api-rate-limit.test.ts pattern).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIncr = vi.fn();
const mockExpire = vi.fn();

vi.mock("~/lib/valkey", () => ({
  default: null,
}));

import {
  _resetForTesting,
  checkScimTokenRateLimit,
  type ScimRateLimitResult,
} from "./rate-limit";
import { SCIM_RPS_LIMIT } from "./constants";

async function withValkeyMock(
  fn: () => Promise<void>,
  incrImpl?: (key: string) => number | Promise<number>
) {
  const mod = await import("~/lib/valkey");
  const original = mod.default;
  // @ts-expect-error — replacing the default export for testing
  mod.default = {
    incr: incrImpl ? vi.fn(incrImpl) : mockIncr,
    expire: mockExpire,
  };
  try {
    await fn();
  } finally {
    // @ts-expect-error — restore the default export
    mod.default = original;
  }
}

describe("checkScimTokenRateLimit", () => {
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

  // -------------------------------------------------------------------------
  // Group A — happy-path result shape
  // -------------------------------------------------------------------------

  describe("Group A — happy path", () => {
    it("A1: first call for a tokenId within a window returns allowed with remaining=49", async () => {
      const result = await checkScimTokenRateLimit("tk_a1");
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(SCIM_RPS_LIMIT);
      expect(result.remaining).toBe(SCIM_RPS_LIMIT - 1);
      expect(result.retryAfterSeconds).toBe(1);
    });

    it("A2: 50th call still allowed (remaining=0); 51st blocked", async () => {
      const tokenId = "tk_a2";
      for (let i = 1; i < SCIM_RPS_LIMIT; i++) {
        const r = await checkScimTokenRateLimit(tokenId);
        expect(r.allowed).toBe(true);
      }
      const fiftieth = await checkScimTokenRateLimit(tokenId);
      expect(fiftieth.allowed).toBe(true);
      expect(fiftieth.remaining).toBe(0);

      const fiftyFirst = await checkScimTokenRateLimit(tokenId);
      expect(fiftyFirst.allowed).toBe(false);
      expect(fiftyFirst.remaining).toBe(0);
      expect(fiftyFirst.limit).toBe(SCIM_RPS_LIMIT);
    });

    it("A3: resetAt is the next-second boundary (ceil(now/1) * 1s)", async () => {
      vi.useFakeTimers();
      // Pin to a sub-second boundary so the next boundary is obvious.
      vi.setSystemTime(new Date("2026-06-06T12:34:56.250Z").getTime());

      const result = await checkScimTokenRateLimit("tk_a3");
      const expected =
        Math.floor(new Date("2026-06-06T12:34:56.250Z").getTime() / 1000) + 1;
      expect(result.resetAt).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Group B — Valkey path
  // -------------------------------------------------------------------------

  describe("Group B — Valkey path", () => {
    it("B1: when valkeyConnection is non-null, calls incr once and expire only on first hit", async () => {
      await withValkeyMock(async () => {
        mockIncr.mockResolvedValueOnce(1);
        mockExpire.mockResolvedValue(1);

        const result = await checkScimTokenRateLimit("tk_b1");

        expect(result.allowed).toBe(true);
        expect(mockIncr).toHaveBeenCalledTimes(1);
        expect(mockExpire).toHaveBeenCalledTimes(1);
      });
    });

    it("B1.2: subsequent calls (count > 1) do NOT touch expire", async () => {
      await withValkeyMock(async () => {
        mockIncr.mockResolvedValueOnce(5);
        mockExpire.mockResolvedValue(1);

        await checkScimTokenRateLimit("tk_b1_2");

        expect(mockExpire).not.toHaveBeenCalled();
      });
    });

    it("B2: key shape is ratelimit:scim:token:<tokenId>:<windowIndex>", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-06T00:00:01.000Z").getTime());
      const expectedWindow = Math.floor(
        new Date("2026-06-06T00:00:01.000Z").getTime() / 1000
      );

      await withValkeyMock(async () => {
        mockIncr.mockResolvedValueOnce(1);
        mockExpire.mockResolvedValue(1);

        await checkScimTokenRateLimit("tk_b2");

        expect(mockIncr).toHaveBeenCalledTimes(1);
        const callArg = mockIncr.mock.calls[0][0] as string;
        expect(callArg).toBe(`ratelimit:scim:token:tk_b2:${expectedWindow}`);
      });
    });

    it("B3: Valkey count > limit returns allowed=false", async () => {
      await withValkeyMock(async () => {
        mockIncr.mockResolvedValueOnce(SCIM_RPS_LIMIT + 1);

        const result = await checkScimTokenRateLimit("tk_b3");

        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Group C — in-memory fallback
  // -------------------------------------------------------------------------

  describe("Group C — in-memory fallback", () => {
    it("C1: when valkeyConnection is null, uses internal Map (counter increments per call)", async () => {
      const tokenId = "tk_c1";
      const r1 = await checkScimTokenRateLimit(tokenId);
      const r2 = await checkScimTokenRateLimit(tokenId);
      const r3 = await checkScimTokenRateLimit(tokenId);
      expect(r1.remaining).toBe(SCIM_RPS_LIMIT - 1);
      expect(r2.remaining).toBe(SCIM_RPS_LIMIT - 2);
      expect(r3.remaining).toBe(SCIM_RPS_LIMIT - 3);
    });

    it("C2: stale entries from earlier windows are cleaned on each call", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z").getTime());

      const tokenId = "tk_c2";
      await checkScimTokenRateLimit(tokenId);

      // Advance well past the cleanup boundary (window - 1).
      vi.setSystemTime(new Date("2026-06-06T00:00:05.000Z").getTime());
      const r = await checkScimTokenRateLimit(tokenId);

      // New window — remaining starts fresh.
      expect(r.remaining).toBe(SCIM_RPS_LIMIT - 1);
    });

    it("C3: counts roll over to 0 at window boundary", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-06T00:00:00.500Z").getTime());

      const tokenId = "tk_c3";
      const burst = 10;
      for (let i = 0; i < burst; i++) {
        await checkScimTokenRateLimit(tokenId);
      }

      // Advance to next 1s window
      vi.setSystemTime(new Date("2026-06-06T00:00:01.500Z").getTime());
      const fresh = await checkScimTokenRateLimit(tokenId);
      expect(fresh.remaining).toBe(SCIM_RPS_LIMIT - 1);
      expect(fresh.allowed).toBe(true);
    });

    it("C4: separate tokenIds get separate buckets", async () => {
      await checkScimTokenRateLimit("tk_c4_a");
      await checkScimTokenRateLimit("tk_c4_a");
      const r = await checkScimTokenRateLimit("tk_c4_b");
      // Fresh bucket for b.
      expect(r.remaining).toBe(SCIM_RPS_LIMIT - 1);
    });
  });

  // -------------------------------------------------------------------------
  // Group D — fail-open + disable knob
  // -------------------------------------------------------------------------

  describe("Group D — fail-open + disable knob", () => {
    it("D1: when Valkey incr throws, fails open with allowed=true and tagged stderr", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await withValkeyMock(
        async () => {
          const result = await checkScimTokenRateLimit("tk_d1");
          expect(result.allowed).toBe(true);
          expect(result.limit).toBe(SCIM_RPS_LIMIT);
          expect(result.remaining).toBe(SCIM_RPS_LIMIT);
          expect(result.retryAfterSeconds).toBe(1);

          expect(errorSpy).toHaveBeenCalled();
          const call = errorSpy.mock.calls[0];
          expect(call[0]).toBe("[scim_rate_limit_fail_open]");
        },
        () => {
          throw new Error("Connection refused");
        }
      );

      errorSpy.mockRestore();
    });

    it("D2: DISABLE_SCIM_RATE_LIMIT=true short-circuits without touching Valkey or the fallback Map", async () => {
      vi.stubEnv("DISABLE_SCIM_RATE_LIMIT", "true");

      await withValkeyMock(async () => {
        const result = await checkScimTokenRateLimit("tk_d2");

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(SCIM_RPS_LIMIT);
        expect(result.remaining).toBe(SCIM_RPS_LIMIT);
        expect(mockIncr).not.toHaveBeenCalled();
      });
    });

    it("D3: DISABLE_SCIM_RATE_LIMIT=false (or unset) does NOT short-circuit", async () => {
      vi.stubEnv("DISABLE_SCIM_RATE_LIMIT", "false");
      const result = await checkScimTokenRateLimit("tk_d3");
      // Real behavior — first call decrements remaining.
      expect(result.remaining).toBe(SCIM_RPS_LIMIT - 1);
    });
  });

  // -------------------------------------------------------------------------
  // Group E — _resetForTesting
  // -------------------------------------------------------------------------

  describe("Group E — _resetForTesting", () => {
    it("E1: _resetForTesting clears the in-memory fallback Map", async () => {
      const tokenId = "tk_e1";
      for (let i = 0; i < 10; i++) {
        await checkScimTokenRateLimit(tokenId);
      }
      _resetForTesting();
      const fresh = await checkScimTokenRateLimit(tokenId);
      expect(fresh.remaining).toBe(SCIM_RPS_LIMIT - 1);
    });

    it("E2: result shape is the documented ScimRateLimitResult interface", async () => {
      const result: ScimRateLimitResult = await checkScimTokenRateLimit("tk_e2");
      expect(typeof result.allowed).toBe("boolean");
      expect(typeof result.limit).toBe("number");
      expect(typeof result.remaining).toBe("number");
      expect(typeof result.resetAt).toBe("number");
      expect(typeof result.retryAfterSeconds).toBe("number");
    });
  });
});
