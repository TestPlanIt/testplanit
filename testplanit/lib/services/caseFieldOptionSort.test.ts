import { describe, expect, it } from "vitest";
import { sortCaseIdsByFieldOptionOrder } from "./caseFieldOptionSort";

// Options deliberately named so alphabetical order disagrees with the
// admin-defined order: sorting must follow `order`, never the name or id.
const OPTIONS = [
  { id: 30, order: 0, name: "Zebra" },
  { id: 10, order: 1, name: "Apple" },
  { id: 20, order: 2, name: "Mango" },
];

describe("sortCaseIdsByFieldOptionOrder", () => {
  it("orders cases by the option's admin-defined order, not id or name", () => {
    const values = [
      { testCaseId: 1, value: 20 },
      { testCaseId: 2, value: 30 },
      { testCaseId: 3, value: 10 },
    ];
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2, 3], values, OPTIONS, "asc")
    ).toEqual([2, 3, 1]);
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2, 3], values, OPTIONS, "desc")
    ).toEqual([1, 3, 2]);
  });

  it("accepts numeric-string values from older writes and imports", () => {
    const values = [
      { testCaseId: 1, value: "20" },
      { testCaseId: 2, value: "30" },
    ];
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2], values, OPTIONS, "asc")
    ).toEqual([2, 1]);
  });

  it("sorts cases without a selection last in both directions", () => {
    const values = [
      { testCaseId: 2, value: 10 },
      { testCaseId: 3, value: 30 },
    ];
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2, 3], values, OPTIONS, "asc")
    ).toEqual([3, 2, 1]);
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2, 3], values, OPTIONS, "desc")
    ).toEqual([2, 3, 1]);
  });

  it("treats stale option ids and non-scalar values as no selection", () => {
    const values = [
      { testCaseId: 1, value: 999 }, // deleted/unknown option
      { testCaseId: 2, value: [10, 20] }, // Multi-Select shape
      { testCaseId: 3, value: { nested: true } },
      { testCaseId: 4, value: "not-a-number" },
      { testCaseId: 5, value: 10 },
    ];
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2, 3, 4, 5], values, OPTIONS, "asc")
    ).toEqual([5, 1, 2, 3, 4]);
  });

  it("breaks ties within one option by case id for a stable order", () => {
    const values = [
      { testCaseId: 9, value: 10 },
      { testCaseId: 4, value: 10 },
      { testCaseId: 7, value: 30 },
    ];
    expect(
      sortCaseIdsByFieldOptionOrder([9, 4, 7], values, OPTIONS, "asc")
    ).toEqual([7, 4, 9]);
  });

  it("breaks equal option orders by name, direction-aware", () => {
    const options = [
      { id: 1, order: 0, name: "Beta" },
      { id: 2, order: 0, name: "Alpha" },
    ];
    const values = [
      { testCaseId: 1, value: 1 },
      { testCaseId: 2, value: 2 },
    ];
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2], values, options, "asc")
    ).toEqual([2, 1]);
    expect(
      sortCaseIdsByFieldOptionOrder([1, 2], values, options, "desc")
    ).toEqual([1, 2]);
  });

  it("does not mutate the input id list", () => {
    const ids = [3, 1, 2];
    sortCaseIdsByFieldOptionOrder(
      ids,
      [{ testCaseId: 1, value: 10 }],
      OPTIONS,
      "asc"
    );
    expect(ids).toEqual([3, 1, 2]);
  });
});
