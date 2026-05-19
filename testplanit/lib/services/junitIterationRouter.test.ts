/**
 * Unit tests for the JUnit iteration router (INT-02).
 *
 * Two contracts under test:
 *   1. `extractIterationIndex(metadata, configuredNames)` — pure helper that
 *      pulls a 1-indexed iteration value out of the parsed JUnit `metadata`
 *      object, matching any of the configured property names
 *      case-insensitively. Empty `configuredNames` falls back to
 *      `["iteration"]` so callers can pass the project's column directly.
 *   2. `routeToIteration(tx, args)` — wraps the per-iteration write. The
 *      ONLY behavior asserted at the unit layer is the 5000-iteration hard
 *      cap (T-06-01-03): the cap check MUST fire before any DB I/O, so a
 *      mock `tx` is sufficient. The happy-path upsert + rollup behavior is
 *      covered by the live-DB integration tests in
 *      `app/api/test-results/import/route.integration.test.ts` (Task 2).
 *
 * The cap is exported as `ITERATION_INDEX_CAP` so tests, the route handler,
 * and the helper itself all reference the same constant.
 */

import { describe, expect, it, vi } from "vitest";

import {
  extractIterationIndex,
  IterationCapExceededError,
  ITERATION_INDEX_CAP,
  routeToIteration,
  validateIterationCaps,
} from "./junitIterationRouter";

describe("extractIterationIndex", () => {
  it("returns the parsed integer for the configured property (happy path)", () => {
    expect(extractIterationIndex({ iteration: "2" }, ["iteration"])).toBe(2);
  });

  it("matches case-insensitively against the configured names", () => {
    expect(extractIterationIndex({ Iteration: "3" }, ["iteration"])).toBe(3);
    expect(
      extractIterationIndex({ ITERATIONINDEX: "5" }, ["iterationIndex"])
    ).toBe(5);
    // metadata key in lowercase but configured name in PascalCase — same.
    expect(extractIterationIndex({ iteration: "4" }, ["Iteration"])).toBe(4);
  });

  it("falls back to ['iteration'] when configuredNames is empty", () => {
    expect(extractIterationIndex({ iteration: "1" }, [])).toBe(1);
  });

  it("returns null when the value is not a finite positive integer", () => {
    expect(
      extractIterationIndex({ iteration: "abc" }, ["iteration"])
    ).toBeNull();
    expect(
      extractIterationIndex({ iteration: "-1" }, ["iteration"])
    ).toBeNull();
    expect(extractIterationIndex({ iteration: "0" }, ["iteration"])).toBeNull();
    expect(extractIterationIndex({ iteration: "" }, ["iteration"])).toBeNull();
    expect(
      extractIterationIndex({ iteration: "NaN" }, ["iteration"])
    ).toBeNull();
  });

  it("WR-09: rejects non-strict integer forms (3.7, 3.0, 3foo) instead of silently truncating", () => {
    // Previously parseInt accepted these and bucketed them into 3.
    // The strict regex form forces CI emitters to send canonical
    // unsigned integers — anything else surfaces as "no iteration."
    expect(
      extractIterationIndex({ iteration: "3.7" }, ["iteration"])
    ).toBeNull();
    expect(
      extractIterationIndex({ iteration: "3.0" }, ["iteration"])
    ).toBeNull();
    expect(
      extractIterationIndex({ iteration: "3foo" }, ["iteration"])
    ).toBeNull();
    expect(extractIterationIndex({ iteration: " 3" }, ["iteration"])).toBe(3);
    expect(extractIterationIndex({ iteration: "3 " }, ["iteration"])).toBe(3);
  });

  it("returns null when no configured property is present", () => {
    expect(extractIterationIndex({}, ["iteration"])).toBeNull();
    expect(extractIterationIndex(undefined, ["iteration"])).toBeNull();
    expect(extractIterationIndex({ otherKey: "5" }, ["iteration"])).toBeNull();
  });

  it("returns the first matching property when multiple names are configured", () => {
    const result = extractIterationIndex({ dataRow: "7", iteration: "3" }, [
      "iteration",
      "dataRow",
    ]);
    // First match by metadata key iteration order; either is acceptable
    // per the spec ("first parseable iteration value found by iterating
    // Object.entries"), so just assert it picked one of the two.
    expect([3, 7]).toContain(result);
  });

  it("uses Object.entries (not for...in) — does not reach prototype keys", () => {
    // Defense-in-depth against T-06-01-05 (prototype-pollution lookup).
    // Inheriting `toString` from Object.prototype must NOT be matched even
    // if an admin sets `toString` as a configured name.
    const result = extractIterationIndex({ iteration: "2" }, ["toString"]);
    expect(result).toBeNull();
  });
});

describe("routeToIteration — cap enforcement (T-06-01-03)", () => {
  function makeMockTx() {
    return {
      testRunCaseIteration: {
        findFirst: vi.fn(),
        upsert: vi.fn(),
        findMany: vi.fn(),
      },
      testRunCases: {
        update: vi.fn(),
      },
    };
  }

  it("exports ITERATION_INDEX_CAP === 5000", () => {
    expect(ITERATION_INDEX_CAP).toBe(5000);
  });

  it("throws IterationCapExceededError before any DB I/O when iterationIndex > 5000", async () => {
    const tx = makeMockTx();
    await expect(
      routeToIteration(tx as any, {
        testRunCaseId: 1,
        iterationIndex: 5001,
        statusId: 10,
        statusMap: new Map(),
      })
    ).rejects.toBeInstanceOf(IterationCapExceededError);

    // The cap check MUST fire before any DB call so no rows are partially
    // mutated when CI uploads an out-of-range value.
    expect(tx.testRunCaseIteration.findFirst).not.toHaveBeenCalled();
    expect(tx.testRunCaseIteration.upsert).not.toHaveBeenCalled();
    expect(tx.testRunCaseIteration.findMany).not.toHaveBeenCalled();
    expect(tx.testRunCases.update).not.toHaveBeenCalled();
  });

  it("error carries iterationIndex and cap as readonly properties", async () => {
    const tx = makeMockTx();
    try {
      await routeToIteration(tx as any, {
        testRunCaseId: 1,
        iterationIndex: 5001,
        statusId: 10,
        statusMap: new Map(),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IterationCapExceededError);
      const capErr = err as IterationCapExceededError;
      expect(capErr.iterationIndex).toBe(5001);
      expect(capErr.cap).toBe(5000);
      expect(capErr.name).toBe("IterationCapExceededError");
      expect(capErr.message).toContain("5001");
      expect(capErr.message).toContain("5000");
    }
  });

  it("accepts iterationIndex === 5000 (boundary — only strictly greater is rejected)", async () => {
    // Set up tx to short-circuit cleanly once the cap check passes — we
    // only care that no cap error is thrown. Make upsert return a row
    // (with ciExtended for the WR-01 autoCreated derivation), findMany
    // return one entry, update succeed.
    const tx = {
      testRunCaseIteration: {
        upsert: vi.fn().mockResolvedValue({ id: 42, ciExtended: true }),
        findMany: vi.fn().mockResolvedValue([{ statusId: 10 }]),
      },
      testRunCases: {
        update: vi.fn().mockResolvedValue({}),
      },
    };
    // Single "passed" status so rollup resolves cleanly.
    const statusMap = new Map([
      [
        10,
        {
          id: 10,
          systemName: "passed",
          isSuccess: true,
          isFailure: false,
          isCompleted: true,
          order: 1,
        },
      ],
    ]);

    await expect(
      routeToIteration(tx as any, {
        testRunCaseId: 1,
        iterationIndex: 5000,
        statusId: 10,
        statusMap,
      })
    ).resolves.toMatchObject({ iterationId: 42 });

    expect(tx.testRunCaseIteration.upsert).toHaveBeenCalled();
  });
});

describe("routeToIteration — rollup respects soft-delete (CR-04)", () => {
  it("rollup re-read filters `isDeleted: false` on iterations", async () => {
    // Soft-deleted iterations must not contribute to the case-level
    // worst-of rollup or to the passed/failed/skipped counters. Mirrors
    // the submit-result filter at submit-result/route.ts:507.
    const tx = {
      testRunCaseIteration: {
        upsert: vi.fn().mockResolvedValue({ id: 99, ciExtended: true }),
        findMany: vi.fn().mockResolvedValue([{ statusId: 10 }]),
      },
      testRunCases: {
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const statusMap = new Map([
      [
        10,
        {
          id: 10,
          systemName: "passed",
          isSuccess: true,
          isFailure: false,
          isCompleted: true,
          order: 1,
        },
      ],
    ]);

    await routeToIteration(tx as any, {
      testRunCaseId: 1,
      iterationIndex: 1,
      statusId: 10,
      statusMap,
    });

    // The findMany used to recompute the rollup must include the
    // `isDeleted: false` filter. Without it, soft-deleted rows would
    // pollute the worst-of computation and the denormalized counters.
    expect(tx.testRunCaseIteration.findMany).toHaveBeenCalledWith({
      where: { testRunCaseId: 1, isDeleted: false },
      select: { statusId: true },
    });
  });
});

describe("validateIterationCaps — pre-flight refusal (WR-07)", () => {
  const propertyNames = ["iteration"];

  it("returns an empty array when no suites are given", () => {
    expect(validateIterationCaps(undefined, propertyNames)).toEqual([]);
    expect(validateIterationCaps([], propertyNames)).toEqual([]);
  });

  it("returns an empty array when every case is below the cap", () => {
    const suites = [
      {
        name: "suite",
        cases: [
          { name: "a", metadata: { iteration: "1" } },
          { name: "b", metadata: { iteration: "4999" } },
          { name: "c", metadata: { iteration: "5000" } },
        ],
      },
    ];
    expect(validateIterationCaps(suites, propertyNames)).toEqual([]);
  });

  it("ignores cases with no iteration metadata (legacy path)", () => {
    const suites = [
      {
        name: "suite",
        cases: [
          { name: "legacy", metadata: { otherKey: "value" } },
          { name: "no-metadata" },
        ],
      },
    ];
    expect(validateIterationCaps(suites, propertyNames)).toEqual([]);
  });

  it("returns ALL violators in one pass, not just the first", () => {
    const suites = [
      {
        name: "Alpha",
        cases: [
          {
            name: "case A",
            classname: "Cls.A",
            metadata: { iteration: "9999" },
          },
          { name: "case B", metadata: { iteration: "3" } },
        ],
      },
      {
        name: "Beta",
        cases: [
          {
            name: "case C",
            metadata: { iteration: "12345" },
          },
        ],
      },
    ];
    const violators = validateIterationCaps(suites, propertyNames);
    expect(violators).toHaveLength(2);
    expect(violators[0]).toEqual({
      suiteName: "Alpha",
      caseName: "case A",
      className: "Cls.A",
      requestedIndex: 9999,
      cap: ITERATION_INDEX_CAP,
    });
    expect(violators[1]).toMatchObject({
      suiteName: "Beta",
      caseName: "case C",
      requestedIndex: 12345,
      cap: ITERATION_INDEX_CAP,
    });
  });

  it("honors configured property names (case-insensitive)", () => {
    const suites = [
      {
        name: "suite",
        cases: [
          { name: "a", metadata: { ITER: "9999" } as Record<string, string> },
          { name: "b", metadata: { iteration: "3" } as Record<string, string> },
        ],
      },
    ];
    const violators = validateIterationCaps(suites, ["iter"]);
    expect(violators).toHaveLength(1);
    expect(violators[0]?.caseName).toBe("a");
  });

  it("falls back to ['iteration'] when configuredNames is empty", () => {
    const suites = [
      {
        cases: [{ name: "a", metadata: { iteration: "9999" } }],
      },
    ];
    expect(validateIterationCaps(suites, [])).toHaveLength(1);
  });

  it("substitutes sentinel labels when suite or case name is missing", () => {
    const suites = [
      {
        cases: [{ metadata: { iteration: "9999" } }],
      },
    ];
    const [violator] = validateIterationCaps(suites, propertyNames);
    expect(violator?.suiteName).toBe("(unnamed suite)");
    expect(violator?.caseName).toBe("(unnamed case)");
  });
});
