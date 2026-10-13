import { describe, expect, it } from "vitest";
import { planAiCandidates } from "./aiCandidates";
import type { LayerResult } from "./types";

const cfg = {
  aiFullRepoThreshold: 250,
  maxAiCandidates: 4,
  aiSampleSize: 3,
  affectedThreshold: 50,
};

function layer(entries: Array<[number, number]>): LayerResult {
  return new Map(
    entries.map(([caseId, score]) => [caseId, { caseId, score, reasons: [] }])
  );
}

describe("planAiCandidates", () => {
  it("sends every unsettled case of a small repository", () => {
    const plan = planAiCandidates({
      repositoryTotalCount: 250,
      pinnedCaseIds: [9],
      layers: [layer([[3, 90]]), layer([[5, 20]])],
      cfg,
    });

    expect(plan).toEqual({
      full: true,
      settledIds: [3, 9],
      rankedIds: [],
      neighbourSlots: 0,
      anchorIds: [],
    });
  });

  it("withholds pinned cases and cases another signal already puts at the threshold", () => {
    const plan = planAiCandidates({
      repositoryTotalCount: 1000,
      pinnedCaseIds: [9],
      layers: [
        layer([
          [3, 90],
          [4, 50],
        ]),
        layer([
          [4, 30],
          [5, 20],
        ]),
      ],
      cfg,
    });

    expect(plan.settledIds).toEqual([3, 4, 9]);
    expect(plan.rankedIds).toEqual([5]);
  });

  it("ranks the undecided cases by their best signal, ties by id, and caps them", () => {
    const plan = planAiCandidates({
      repositoryTotalCount: 1000,
      pinnedCaseIds: [],
      layers: [
        layer([
          [7, 20],
          [2, 45],
          [8, 45],
        ]),
        layer([
          [7, 35],
          [6, 10],
          [1, 30],
        ]),
      ],
      cfg,
    });

    expect(plan.full).toBe(false);
    expect(plan.rankedIds).toEqual([2, 8, 7, 1]);
    expect(plan.neighbourSlots).toBe(0);
  });

  it("leaves neighbour slots under the cap, bounded by the sample size", () => {
    const two = planAiCandidates({
      repositoryTotalCount: 1000,
      pinnedCaseIds: [9],
      layers: [
        layer([
          [2, 45],
          [8, 30],
        ]),
      ],
      cfg,
    });
    expect(two.neighbourSlots).toBe(2);
    expect(two.anchorIds).toEqual([9, 2, 8]);

    const none = planAiCandidates({
      repositoryTotalCount: 1000,
      pinnedCaseIds: [],
      layers: [],
      cfg: { ...cfg, maxAiCandidates: 10 },
    });
    expect(none.rankedIds).toEqual([]);
    expect(none.neighbourSlots).toBe(3);
    expect(none.anchorIds).toEqual([]);
  });
});
