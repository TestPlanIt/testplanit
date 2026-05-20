/**
 * Unit tests for computeWorstOfStatus.
 *
 * Spec (in order):
 *   1. No iterations have a recorded result → first untested status
 *      (lowest `order`, with !isCompleted && !isSuccess && !isFailure).
 *   2. Any failure → most-frequent failure status (tie → lowest `order`).
 *   3. No failures but some success → most-frequent success status (tie → lowest `order`).
 *   4. Some recorded results, no success/failure → most-frequent recorded status (tie → lowest `order`).
 *
 * Status names are admin-defined and irrelevant; only the
 * (isSuccess, isFailure, isCompleted) triplet and `Status.order` matter.
 */

import { describe, expect, it } from "vitest";
import {
  computeWorstOfStatus,
  type RollupIteration,
  type RollupStatus,
} from "./iterationRollup";

// Two status rows per category so we can exercise the tie-breaker (lowest
// `order` wins) and the dominant-frequency rule (more-frequent wins).
const STATUSES = {
  // Untested-shape statuses (incomplete, not success, not failure)
  untestedA: {
    id: 1,
    systemName: "untested",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    order: 3,
  },
  untestedB: {
    id: 2,
    systemName: "draft",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    order: 5,
  },
  // Success
  passed: {
    id: 10,
    systemName: "passed",
    isSuccess: true,
    isFailure: false,
    isCompleted: true,
    order: 1,
  },
  passed2: {
    id: 11,
    systemName: "verified",
    isSuccess: true,
    isFailure: false,
    isCompleted: true,
    order: 4,
  },
  // Failure
  failed: {
    id: 20,
    systemName: "failed",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
    order: 7,
  },
  exception: {
    id: 21,
    systemName: "exception",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
    order: 6,
  },
  // Completed, neither success nor failure
  skipped: {
    id: 30,
    systemName: "skipped",
    isSuccess: false,
    isFailure: false,
    isCompleted: true,
    order: 2,
  },
  blocked: {
    id: 31,
    systemName: "blocked",
    isSuccess: false,
    isFailure: false,
    isCompleted: true,
    order: 8,
  },
} satisfies Record<string, RollupStatus>;

const MAP = new Map<number, RollupStatus>(
  Object.values(STATUSES).map((s) => [s.id, s])
);

const iter = (id: number | null): RollupIteration => ({ statusId: id });

describe("computeWorstOfStatus — Rule 1: no recorded results", () => {
  it("returns the first untested status (lowest order) when iterations is empty", () => {
    expect(computeWorstOfStatus([], MAP)).toBe(STATUSES.untestedA.id);
  });

  it("returns the first untested status when all iteration statusIds are null", () => {
    expect(
      computeWorstOfStatus([iter(null), iter(null), iter(null)], MAP)
    ).toBe(STATUSES.untestedA.id);
  });

  it("picks the lowest-order untested-shape status (untestedA.order=3 vs untestedB.order=5)", () => {
    expect(computeWorstOfStatus([], MAP)).toBe(STATUSES.untestedA.id);
  });

  it("returns null when no untested-shape status exists in the project", () => {
    const noUntestedMap = new Map<number, RollupStatus>([
      [STATUSES.passed.id, STATUSES.passed],
      [STATUSES.failed.id, STATUSES.failed],
    ]);
    expect(computeWorstOfStatus([], noUntestedMap)).toBeNull();
  });
});

describe("computeWorstOfStatus — Rule 2: any failure dominates", () => {
  it("returns the only failure status when one iteration failed", () => {
    expect(computeWorstOfStatus([iter(STATUSES.failed.id)], MAP)).toBe(
      STATUSES.failed.id
    );
  });

  it("any failure beats any number of successes / skipped / untested", () => {
    const iterations = [
      iter(STATUSES.passed.id),
      iter(STATUSES.passed.id),
      iter(STATUSES.skipped.id),
      iter(null),
      iter(STATUSES.failed.id),
    ];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.failed.id);
  });

  it("picks the most-frequent failure status (failed×2 beats exception×1)", () => {
    const iterations = [
      iter(STATUSES.failed.id),
      iter(STATUSES.failed.id),
      iter(STATUSES.exception.id),
    ];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.failed.id);
  });

  it("on a failure tie, lowest order wins (exception.order=6 < failed.order=7)", () => {
    const iterations = [iter(STATUSES.failed.id), iter(STATUSES.exception.id)];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.exception.id);
  });

  it("ignores successes / non-failures even when they outnumber the single failure", () => {
    const iterations = [
      iter(STATUSES.passed.id),
      iter(STATUSES.passed.id),
      iter(STATUSES.passed.id),
      iter(STATUSES.exception.id),
    ];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.exception.id);
  });
});

describe("computeWorstOfStatus — Rule 3: no failures, dominant success wins", () => {
  it("returns the success status when only one iteration passed", () => {
    expect(computeWorstOfStatus([iter(STATUSES.passed.id)], MAP)).toBe(
      STATUSES.passed.id
    );
  });

  it("ignores untested iterations when at least one success exists (3 passed + 1 untested → passed)", () => {
    const iterations = [
      iter(STATUSES.passed.id),
      iter(STATUSES.passed.id),
      iter(STATUSES.passed.id),
      iter(null),
    ];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.passed.id);
  });

  it("picks the most-frequent success status (passed×3 beats passed2×1)", () => {
    const iterations = [
      iter(STATUSES.passed.id),
      iter(STATUSES.passed.id),
      iter(STATUSES.passed.id),
      iter(STATUSES.passed2.id),
    ];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.passed.id);
  });

  it("on a success tie, lowest order wins (passed.order=1 < passed2.order=4)", () => {
    const iterations = [iter(STATUSES.passed.id), iter(STATUSES.passed2.id)];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.passed.id);
  });
});

describe("computeWorstOfStatus — Rule 4: some recorded, no success/failure → dominant", () => {
  it("returns the only recorded status (skipped) ignoring nulls", () => {
    const iterations = [iter(null), iter(null), iter(STATUSES.skipped.id)];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.skipped.id);
  });

  it("picks the most-frequent recorded status (skipped×2 beats blocked×1)", () => {
    const iterations = [
      iter(STATUSES.skipped.id),
      iter(STATUSES.skipped.id),
      iter(STATUSES.blocked.id),
    ];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.skipped.id);
  });

  it("on a tie among recorded non-success/non-failure, lowest order wins (skipped.order=2 < blocked.order=8)", () => {
    const iterations = [iter(STATUSES.skipped.id), iter(STATUSES.blocked.id)];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.skipped.id);
  });
});

describe("computeWorstOfStatus — defensive cases", () => {
  it("ignores iterations whose statusId isn't in the statusMap", () => {
    const iterations = [
      iter(99999), // unknown
      iter(STATUSES.passed.id),
    ];
    expect(computeWorstOfStatus(iterations, MAP)).toBe(STATUSES.passed.id);
  });

  it("returns null when all iterations have unknown statusIds and no untested fallback exists", () => {
    const noUntested = new Map<number, RollupStatus>([
      [STATUSES.passed.id, STATUSES.passed],
    ]);
    expect(
      computeWorstOfStatus([iter(99998), iter(99999)], noUntested)
    ).toBeNull();
  });

  it("returns null when all iterations have unknown statusIds even if untested exists", () => {
    // Iterations with statusId set (but unknown) are NOT 'no result' — they
    // count as recorded but resolve to no known status, so the dominant-by-tier
    // logic finds no candidate and returns null.
    expect(computeWorstOfStatus([iter(99998), iter(99999)], MAP)).toBeNull();
  });
});
