import { describe, expect, it } from "vitest";

import {
  automatedFlagFilter,
  parseEnumFilter,
  parseIdListFilter,
} from "./reportFilterParams";

const STATUSES = ["healthy", "never_executed", "always_failing"] as const;

describe("parseEnumFilter", () => {
  it("accepts a list, keeping only known values in declared order", () => {
    expect(
      parseEnumFilter(["always_failing", "bogus", "healthy"], STATUSES)
    ).toEqual(["healthy", "always_failing"]);
  });

  it("accepts the single-value form", () => {
    expect(parseEnumFilter("never_executed", STATUSES)).toEqual([
      "never_executed",
    ]);
  });

  it.each([undefined, null, "all", [], ["bogus"], 7])(
    "treats %j as inactive",
    (raw) => {
      expect(parseEnumFilter(raw, STATUSES)).toBeNull();
    }
  );
});

describe("parseIdListFilter", () => {
  it("accepts one id or a list, dropping junk and duplicates", () => {
    expect(parseIdListFilter(4)).toEqual([4]);
    expect(parseIdListFilter("4")).toEqual([4]);
    expect(parseIdListFilter([4, "5", 4, 0, -1, "x", 1.5])).toEqual([4, 5]);
  });

  it.each([undefined, null, "", [], ["x"]])("treats %j as inactive", (raw) => {
    expect(parseIdListFilter(raw)).toBeNull();
  });
});

describe("automatedFlagFilter", () => {
  it("restricts only when exactly one side is selected", () => {
    expect(automatedFlagFilter("automated")).toBe(true);
    expect(automatedFlagFilter(["manual"])).toBe(false);
    expect(automatedFlagFilter(["automated", "manual"])).toBeNull();
    expect(automatedFlagFilter("all")).toBeNull();
    expect(automatedFlagFilter(undefined)).toBeNull();
  });
});
