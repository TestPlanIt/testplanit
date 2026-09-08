/**
 * Unit tests for the NextAuth session callback's mid-session deactivation guard.
 *
 * Coverage surface:
 *
 *   A. Fresh-read fires for every authMethod (INTERNAL / SSO / BOTH / SCIM / null)
 *   B. isActive=false short-circuits to {} as Session; updateAuditContext NOT called
 *   C. Placement: AFTER the password-change short-circuit, BEFORE updateAuditContext
 *   D. Source-shape grep: exactly two `db.user.findUnique` calls in session block
 *   E. Latency regression budget: p95 < 5ms across 100 sequential calls
 *
 * The static `authOptions` export is invoked directly with a synthetic
 * `{ session, token }` payload; `~/server/db`, `~/lib/session-cache`,
 * and `~/lib/auditContext` are module-mocked.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const getCachedSessionUserMock = vi.fn();
const touchLastActiveMock = vi.fn();
const updateAuditContextMock = vi.fn();

vi.mock("~/server/db", () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    ssoProvider: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("~/lib/session-cache", () => ({
  getCachedSessionUser: (...args: unknown[]) =>
    getCachedSessionUserMock(...args),
  touchLastActive: (...args: unknown[]) => touchLastActiveMock(...args),
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: (...args: unknown[]) => updateAuditContextMock(...args),
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/utils/email-domain-validation", () => ({
  isEmailDomainAllowed: vi.fn().mockResolvedValue(true),
}));

import { authOptions } from "./auth";

type SessionCallback = NonNullable<
  NonNullable<typeof authOptions.callbacks>["session"]
>;

const sessionCallback = authOptions.callbacks!.session as SessionCallback;

const baseSession = {
  user: { id: "user-1", email: "user@example.com", name: "User One" },
  expires: "2099-01-01T00:00:00.000Z",
};

const baseToken = {
  sub: "user-1",
  name: "User One",
  passwordChangedAt: null,
};

async function invoke(opts?: {
  cachedUser?: Record<string, unknown> | null;
  freshRow?: { isActive: boolean } | null;
  freshUserPasswordChangedAt?: Date | null;
  tokenPasswordChangedAt?: string | null;
}) {
  const cached =
    opts?.cachedUser === undefined
      ? {
          name: "User One",
          access: "USER",
          image: null,
          emailVerified: null,
          authMethod: "SCIM",
          preferences: null,
        }
      : opts.cachedUser;
  getCachedSessionUserMock.mockResolvedValueOnce(cached);

  // findUnique is called ONCE in the session block, selecting passwordChangedAt
  // and isActive together for both mid-session guards.
  //
  // This mock HONOURS the requested select rather than branching on whichever
  // single column was asked for. The previous shape returned only the first
  // matching column, so a select asking for both got `isActive: undefined` and
  // the deactivation guard silently stopped firing — a mock artifact that looked
  // exactly like a real security regression. Building the row from the select is
  // also closer to what Prisma actually does.
  findUniqueMock.mockReset();
  findUniqueMock.mockImplementation(
    async (args: { select?: Record<string, unknown> }) => {
      // `freshRow: null` models a deleted user — no row at all.
      if (opts?.freshRow === null) return null;

      const select = args?.select ?? {};
      const row: Record<string, unknown> = {};
      if ("passwordChangedAt" in select) {
        row.passwordChangedAt = opts?.freshUserPasswordChangedAt ?? null;
      }
      if ("isActive" in select) {
        row.isActive =
          opts?.freshRow === undefined ? true : opts.freshRow.isActive;
      }
      return Object.keys(row).length > 0 ? row : null;
    }
  );

  return sessionCallback({
    session: structuredClone(baseSession),
    token: {
      ...baseToken,
      passwordChangedAt: opts?.tokenPasswordChangedAt ?? null,
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session callback - isActive fresh-read scope", () => {
  it("A1: fires fresh-read when cached user authMethod is SCIM", async () => {
    await invoke({
      cachedUser: {
        name: "U",
        access: "USER",
        image: null,
        emailVerified: null,
        authMethod: "SCIM",
        preferences: null,
      },
    });

    const isActiveCall = findUniqueMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        "select" in (call[0] as Record<string, unknown>) &&
        "isActive" in
          ((call[0] as { select: Record<string, unknown> }).select ?? {})
    );
    expect(isActiveCall).toBeTruthy();
  });

  it("A2: fires fresh-read when cached user authMethod is SSO", async () => {
    await invoke({
      cachedUser: {
        name: "U",
        access: "USER",
        image: null,
        emailVerified: null,
        authMethod: "SSO",
        preferences: null,
      },
    });

    const isActiveCalls = findUniqueMock.mock.calls.filter(
      (call: unknown[]) =>
        "isActive" in
        ((call[0] as { select?: Record<string, unknown> })?.select ?? {})
    );
    expect(isActiveCalls.length).toBe(1);
  });

  it("A3: fires fresh-read when cached user authMethod is INTERNAL (independent of password-change branch)", async () => {
    await invoke({
      cachedUser: {
        name: "U",
        access: "USER",
        image: null,
        emailVerified: null,
        authMethod: "INTERNAL",
        preferences: null,
      },
      freshUserPasswordChangedAt: null,
      tokenPasswordChangedAt: null,
    });

    const isActiveCalls = findUniqueMock.mock.calls.filter(
      (call: unknown[]) =>
        "isActive" in
        ((call[0] as { select?: Record<string, unknown> })?.select ?? {})
    );
    expect(isActiveCalls.length).toBe(1);
  });

  it("A4: fires fresh-read when cached user authMethod is null", async () => {
    await invoke({
      cachedUser: {
        name: "U",
        access: "USER",
        image: null,
        emailVerified: null,
        authMethod: null,
        preferences: null,
      },
    });

    const isActiveCalls = findUniqueMock.mock.calls.filter(
      (call: unknown[]) =>
        "isActive" in
        ((call[0] as { select?: Record<string, unknown> })?.select ?? {})
    );
    expect(isActiveCalls.length).toBe(1);
  });
});

describe("session callback - deactivation forces re-auth", () => {
  it("B1: isActive=false returns empty session and skips updateAuditContext", async () => {
    const result = await invoke({
      freshRow: { isActive: false },
    });

    expect(result).toEqual({});
    expect(updateAuditContextMock).not.toHaveBeenCalled();
  });

  it("B2: isActive=true allows the session to proceed and calls updateAuditContext", async () => {
    const result = await invoke({
      freshRow: { isActive: true },
    });

    expect(result).not.toEqual({});
    expect(result).toHaveProperty("user");
    expect(updateAuditContextMock).toHaveBeenCalledTimes(1);
  });

  it("B3: fresh-read returns null (user deleted) does NOT short-circuit", async () => {
    const result = await invoke({
      freshRow: null,
    });

    expect(result).not.toEqual({});
    expect(updateAuditContextMock).toHaveBeenCalledTimes(1);
  });
});

describe("session callback - placement invariants", () => {
  it("C1: SECURITY-03 password-change short-circuit prevents the isActive fresh-read from firing", async () => {
    // Token's passwordChangedAt is older than the DB value -> SECURITY-03 fires
    // and returns {} before reaching the isActive block. Gated on INTERNAL/BOTH.
    const result = await invoke({
      cachedUser: {
        name: "U",
        access: "USER",
        image: null,
        emailVerified: null,
        authMethod: "INTERNAL",
        preferences: null,
      },
      freshUserPasswordChangedAt: new Date("2026-06-01T00:00:00Z"),
      tokenPasswordChangedAt: "2026-01-01T00:00:00Z",
    });

    expect(result).toEqual({});

    // The SECURITY-03 short-circuit still fires BEFORE any audit enrichment, so
    // a session that is about to be thrown away is never enriched.
    expect(updateAuditContextMock).not.toHaveBeenCalled();

    // Both guards are now served by a SINGLE findUnique selecting both columns.
    // This previously asserted zero isActive reads, on the basis that the
    // password short-circuit returned before the second query could fire. That
    // invariant is obsolete — and its intent (do not spend a second round trip)
    // is better served now, because there is only ever one.
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(findUniqueMock.mock.calls[0][0]).toMatchObject({
      select: { passwordChangedAt: true, isActive: true },
    });
  });

  it("C2: both mid-session guards cost exactly one query, not two", async () => {
    // The regression this locks down: 14.0M calls apiece at 8/s, together 16% of
    // all database queries on the instance, because these were two findUnique
    // calls against the same row. INTERNAL exercises both guards.
    await invoke({
      cachedUser: {
        name: "U",
        access: "USER",
        image: null,
        emailVerified: null,
        authMethod: "INTERNAL",
        preferences: null,
      },
    });

    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });
});

describe("session callback - source-shape sanity", () => {
  const source = readFileSync(join(__dirname, "auth.ts"), "utf-8");

  it("D1: session callbacks select passwordChangedAt and isActive in ONE read", () => {
    // Was /select:\s*{\s*isActive:\s*true\s*}/ — a standalone isActive select,
    // which is exactly the second round trip that got merged away. Both session
    // callbacks in this file (the `authOptions` const used by ~176
    // getServerSession call sites, and the `getAuthOptions()` builder used by the
    // NextAuth route handler) must carry the merged shape, or one path silently
    // keeps double-querying.
    const merged = source.match(
      /select:\s*{\s*passwordChangedAt:\s*true,\s*isActive:\s*true\s*}/g
    );
    expect(merged).not.toBeNull();
    expect(merged!.length).toBe(2);
  });

  it("D2: file does NOT call invalidateSessionUserCache (Path A — no cache coordination)", () => {
    expect(source).not.toMatch(/invalidateSessionUserCache/);
  });

  it("D3: file does NOT contain D-XX / Phase 7 / Plan 0N references in source comments", () => {
    const codeOnly = source
      .split("\n")
      .filter((line) => !/^\s*\*|^\s*\/\//.test(line))
      .join("\n");
    expect(codeOnly).not.toMatch(/D-[0-9]+|Phase 7|Plan 0[0-9]/);
  });
});

describe("session callback - latency regression guard", () => {
  it("E1: p95 wall-clock delta < 5ms across 100 sequential calls with mocked DB", async () => {
    // Mocked DB resolves synchronously. The test captures wall-clock deltas
    // around the callback and asserts the 95th percentile is below the
    // documented regression budget. Real PG indexed PK lookups land ~1ms;
    // the mocked path is the synthetic lower bound that flags non-trivial
    // sync work added to the callback hot path by a future change.
    const durations: number[] = [];

    for (let i = 0; i < 100; i++) {
      getCachedSessionUserMock.mockResolvedValueOnce({
        name: "U",
        access: "USER",
        image: null,
        emailVerified: null,
        authMethod: "SCIM",
        preferences: null,
      });
      findUniqueMock.mockResolvedValueOnce({ isActive: true });

      const start = performance.now();
      await sessionCallback({
        session: structuredClone(baseSession),
        token: { ...baseToken },
      } as never);
      durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)];
    expect(p95).toBeLessThan(5);
  });
});
