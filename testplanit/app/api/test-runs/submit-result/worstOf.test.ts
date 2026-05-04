/**
 * Unit tests for computeWorstOfStatus — the worst-of priority rollup used
 * by the submit-result route to set TestRunCases.statusId after every
 * iteration result write.
 *
 * Strategy: a table-driven 7×7 matrix asserting that for every pair of
 * (statusA, statusB), the rollup picks the priority winner per the locked
 * priority order:
 *
 *   Failed > Exception > Blocked > Retest > Untested > Skipped > Passed
 *
 * Plus single-iteration sanity checks, the null-statusId-treated-as-Untested
 * rule, and the empty-list defensive return.
 */

import { describe, expect, it } from "vitest";
import {
  computeWorstOfStatus,
  type RollupIteration,
  type RollupStatus,
} from "./worstOf";

// Synthetic Status fixtures matching the project's prisma seed.ts shape.
// IDs are arbitrary — only systemName participates in the rollup decision.
const STATUSES: Record<string, RollupStatus> = {
  untested: {
    id: 1,
    systemName: "untested",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
  },
  passed: {
    id: 2,
    systemName: "passed",
    isSuccess: true,
    isFailure: false,
    isCompleted: true,
  },
  failed: {
    id: 3,
    systemName: "failed",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
  },
  retest: {
    id: 4,
    systemName: "retest",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
  },
  blocked: {
    id: 5,
    systemName: "blocked",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
  },
  skipped: {
    id: 6,
    systemName: "skipped",
    isSuccess: false,
    isFailure: false,
    isCompleted: true,
  },
  exception: {
    id: 7,
    systemName: "exception",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
  },
};

const STATUS_MAP = new Map<number, RollupStatus>(
  Object.values(STATUSES).map((s) => [s.id, s])
);

// Locked priority order (worst → best). Used to derive expected outcomes
// for the pairwise matrix: pick whichever appears earliest in this list.
const PRIORITY_ORDER: Array<keyof typeof STATUSES> = [
  "failed",
  "exception",
  "blocked",
  "retest",
  "untested",
  "skipped",
  "passed",
];

function expectedWorst(
  a: keyof typeof STATUSES,
  b: keyof typeof STATUSES
): keyof typeof STATUSES {
  const ai = PRIORITY_ORDER.indexOf(a);
  const bi = PRIORITY_ORDER.indexOf(b);
  return ai <= bi ? a : b;
}

describe("computeWorstOfStatus — single iteration", () => {
  // Seven cases — each known status alone returns itself.
  for (const name of PRIORITY_ORDER) {
    it(`returns the iteration's own status when only one iteration is present (${name})`, () => {
      const iterations: RollupIteration[] = [{ statusId: STATUSES[name].id }];
      expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
        STATUSES[name].id
      );
    });
  }
});

describe("computeWorstOfStatus — pairwise priority matrix (7×7)", () => {
  // 49 pairwise assertions covering every combination.
  for (const a of PRIORITY_ORDER) {
    for (const b of PRIORITY_ORDER) {
      const expected = expectedWorst(a, b);
      it(`picks ${expected} from {${a}, ${b}}`, () => {
        const iterations: RollupIteration[] = [
          { statusId: STATUSES[a].id },
          { statusId: STATUSES[b].id },
        ];
        expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
          STATUSES[expected].id
        );
      });
    }
  }
});

describe("computeWorstOfStatus — null statusId treated as untested", () => {
  it("treats null statusId as untested when paired with passed", () => {
    // Untested is worse than passed — null should win the rollup.
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.passed.id },
      { statusId: null },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.untested.id
    );
  });

  it("treats null statusId as untested when paired with failed (failed wins)", () => {
    // Failed is worse than untested — failed still wins.
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.failed.id },
      { statusId: null },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.failed.id
    );
  });

  it("treats all-null iterations as all-untested", () => {
    const iterations: RollupIteration[] = [
      { statusId: null },
      { statusId: null },
      { statusId: null },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.untested.id
    );
  });
});

describe("computeWorstOfStatus — defensive cases", () => {
  it("returns null for an empty iteration list", () => {
    expect(computeWorstOfStatus([], STATUS_MAP)).toBeNull();
  });

  it("falls back to the first iteration's statusId when the statusMap is empty", () => {
    // No rows in the map → ranks all resolve to 0; helper returns the first
    // iteration's statusId so the route doesn't write null over a previously
    // valid rollup.
    const iterations: RollupIteration[] = [
      { statusId: 999 },
      { statusId: 888 },
    ];
    expect(computeWorstOfStatus(iterations, new Map())).toBe(999);
  });

  it("ignores unknown statusIds (treats them as rank 0) when better-known statuses exist", () => {
    // Known "failed" wins over an unknown id (which has no priority match).
    const iterations: RollupIteration[] = [
      { statusId: 12345 },
      { statusId: STATUSES.failed.id },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.failed.id
    );
  });
});

describe("computeWorstOfStatus — three-iteration mixed scenarios", () => {
  it("pass + pass + fail rolls up to fail (the worst-of rule)", () => {
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.passed.id },
      { statusId: STATUSES.passed.id },
      { statusId: STATUSES.failed.id },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.failed.id
    );
  });

  it("pass + skipped + blocked rolls up to blocked", () => {
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.passed.id },
      { statusId: STATUSES.skipped.id },
      { statusId: STATUSES.blocked.id },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.blocked.id
    );
  });

  it("all-passed rolls up to passed", () => {
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.passed.id },
      { statusId: STATUSES.passed.id },
      { statusId: STATUSES.passed.id },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.passed.id
    );
  });
});
