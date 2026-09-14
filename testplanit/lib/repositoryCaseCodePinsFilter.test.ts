import { describe, expect, it } from "vitest";
import {
  codePinsWhereClause,
  shapeCodePinsFacet,
} from "./repositoryCaseCodePinsFilter";

describe("codePinsWhereClause", () => {
  it("guards on live pins in both directions", () => {
    expect(codePinsWhereClause(true)).toEqual({
      codePins: { some: { isDeleted: false } },
    });
    expect(codePinsWhereClause(false)).toEqual({
      codePins: { none: { isDeleted: false } },
    });
  });
});

describe("shapeCodePinsFacet", () => {
  it("derives the no-pins bucket so both sum to the total", () => {
    expect(shapeCodePinsFacet(10, 3)).toEqual([
      { value: true, count: 3 },
      { value: false, count: 7 },
    ]);
  });

  it("never goes negative", () => {
    expect(shapeCodePinsFacet(2, 5)[1].count).toBe(0);
  });
});
