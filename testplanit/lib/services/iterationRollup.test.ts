/**
 * Unit tests for computeWorstOfStatus — the worst-of rollup used by the
 * submit-result route to set TestRunCases.statusId after every iteration
 * result write.
 *
 * Status names are admin-mutable, so the rollup decides by the flag triplet
 * (isSuccess, isFailure, isCompleted) and breaks ties on Status.order. The
 * only reserved systemName is `untested` (used as the null-statusId
 * fallback).
 *
 * Strategy: a table-driven pairwise matrix asserting tier-based ordering,
 * plus single-iteration sanity checks, the null-statusId-as-untested rule,
 * and defensive cases.
 */

import { describe, expect, it } from "vitest";
import {
  computeWorstOfStatus,
  type RollupIteration,
  type RollupStatus,
} from "./iterationRollup";

// Synthetic Status fixtures. `order` mirrors the seeded ranking so the
// pairwise matrix demonstrates that admin-defined ordering produces the
// historical worst-of behavior even though the logic is flag-driven.
const STATUSES: Record<string, RollupStatus> = {
  untested: {
    id: 1,
    systemName: "untested",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    order: 3,
  },
  passed: {
    id: 2,
    systemName: "passed",
    isSuccess: true,
    isFailure: false,
    isCompleted: true,
    order: 1,
  },
  failed: {
    id: 3,
    systemName: "failed",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
    order: 7,
  },
  retest: {
    id: 4,
    systemName: "retest",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    order: 4,
  },
  blocked: {
    id: 5,
    systemName: "blocked",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    order: 5,
  },
  skipped: {
    id: 6,
    systemName: "skipped",
    isSuccess: false,
    isFailure: false,
    isCompleted: true,
    order: 2,
  },
  exception: {
    id: 7,
    systemName: "exception",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
    order: 6,
  },
};

const STATUS_MAP = new Map<number, RollupStatus>(
  Object.values(STATUSES).map((s) => [s.id, s])
);

// Tier per the flag rules in worstOf.ts. Higher tier wins; within a tier
// the higher Status.order wins.
function tierOf(name: keyof typeof STATUSES): number {
  const s = STATUSES[name];
  if (s.isFailure) return 4;
  if (!s.isCompleted) return 3;
  if (s.isCompleted && !s.isSuccess && !s.isFailure) return 2;
  if (s.isSuccess) return 1;
  return 0;
}

function expectedWorst(
  a: keyof typeof STATUSES,
  b: keyof typeof STATUSES
): keyof typeof STATUSES {
  const ta = tierOf(a);
  const tb = tierOf(b);
  if (ta !== tb) return ta > tb ? a : b;
  return STATUSES[a].order >= STATUSES[b].order ? a : b;
}

const NAMES: Array<keyof typeof STATUSES> = [
  "failed",
  "exception",
  "blocked",
  "retest",
  "untested",
  "skipped",
  "passed",
];

describe("computeWorstOfStatus — single iteration", () => {
  for (const name of NAMES) {
    it(`returns the iteration's own status when only one iteration is present (${name})`, () => {
      const iterations: RollupIteration[] = [{ statusId: STATUSES[name].id }];
      expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
        STATUSES[name].id
      );
    });
  }
});

describe("computeWorstOfStatus — pairwise tier matrix (7×7)", () => {
  for (const a of NAMES) {
    for (const b of NAMES) {
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

describe("computeWorstOfStatus — tier rules (flag-driven, not name-driven)", () => {
  it("isFailure beats every non-failure regardless of systemName", () => {
    const customFailure: RollupStatus = {
      id: 100,
      systemName: "regression-fail-custom",
      isSuccess: false,
      isFailure: true,
      isCompleted: true,
      order: 1, // even with the lowest order, isFailure puts it in the top tier
    };
    const map = new Map(STATUS_MAP);
    map.set(customFailure.id, customFailure);
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.blocked.id },
      { statusId: customFailure.id },
      { statusId: STATUSES.passed.id },
    ];
    expect(computeWorstOfStatus(iterations, map)).toBe(customFailure.id);
  });

  it("within the incomplete tier, higher Status.order wins (admin-configurable)", () => {
    // blocked.order=5 vs retest.order=4 — blocked wins despite both being
    // tier 3 (incomplete).
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.retest.id },
      { statusId: STATUSES.blocked.id },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.blocked.id
    );
  });

  it("incomplete tier beats skipped (completed-non-success)", () => {
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.skipped.id },
      { statusId: STATUSES.untested.id },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.untested.id
    );
  });

  it("skipped beats passed", () => {
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.passed.id },
      { statusId: STATUSES.skipped.id },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.skipped.id
    );
  });
});

describe("computeWorstOfStatus — null statusId treated as untested", () => {
  it("treats null statusId as untested when paired with passed", () => {
    const iterations: RollupIteration[] = [
      { statusId: STATUSES.passed.id },
      { statusId: null },
    ];
    expect(computeWorstOfStatus(iterations, STATUS_MAP)).toBe(
      STATUSES.untested.id
    );
  });

  it("treats null statusId as untested when paired with failed (failed wins)", () => {
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
    const iterations: RollupIteration[] = [
      { statusId: 999 },
      { statusId: 888 },
    ];
    expect(computeWorstOfStatus(iterations, new Map())).toBe(999);
  });

  it("ignores unknown statusIds (tier 0) when better-known statuses exist", () => {
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
  it("pass + pass + fail rolls up to fail", () => {
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
