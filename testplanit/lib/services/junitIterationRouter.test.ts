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
    expect(extractIterationIndex({ iteration: "abc" }, ["iteration"])).toBeNull();
    expect(extractIterationIndex({ iteration: "-1" }, ["iteration"])).toBeNull();
    expect(extractIterationIndex({ iteration: "0" }, ["iteration"])).toBeNull();
    expect(extractIterationIndex({ iteration: "" }, ["iteration"])).toBeNull();
    expect(extractIterationIndex({ iteration: "NaN" }, ["iteration"])).toBeNull();
  });

  it("returns null when no configured property is present", () => {
    expect(extractIterationIndex({}, ["iteration"])).toBeNull();
    expect(extractIterationIndex(undefined, ["iteration"])).toBeNull();
    expect(
      extractIterationIndex({ otherKey: "5" }, ["iteration"])
    ).toBeNull();
  });

  it("returns the first matching property when multiple names are configured", () => {
    const result = extractIterationIndex(
      { dataRow: "7", iteration: "3" },
      ["iteration", "dataRow"]
    );
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
    // only care that no cap error is thrown. Make findFirst return null
    // (no existing row), upsert return a row, findMany return one entry,
    // update succeed.
    const tx = {
      testRunCaseIteration: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 42 }),
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
