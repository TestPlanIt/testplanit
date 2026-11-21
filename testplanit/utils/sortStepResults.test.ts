import { describe, expect, it } from "vitest";
import { sortStepResults } from "./sortStepResults";

describe("sortStepResults", () => {
  it("orders step results by the order of their steps", () => {
    const rows = [
      { id: 3, step: { order: 4 } },
      { id: 2, step: { order: 1 } },
      { id: 1, step: { order: 0 } },
    ];
    expect(sortStepResults(rows).map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it("orders the items of a shared step group within their step", () => {
    const rows = [
      { id: 1, step: { order: 1 }, sharedStepItem: { order: 2 } },
      { id: 2, step: { order: 0 }, sharedStepItem: null },
      { id: 3, step: { order: 1 }, sharedStepItem: { order: 0 } },
      { id: 4, step: { order: 1 }, sharedStepItem: { order: 1 } },
    ];
    expect(sortStepResults(rows).map((row) => row.id)).toEqual([2, 3, 4, 1]);
  });

  it("leaves the given array untouched", () => {
    const rows = [{ step: { order: 2 } }, { step: { order: 1 } }];
    sortStepResults(rows);
    expect(rows.map((row) => row.step.order)).toEqual([2, 1]);
  });
});
