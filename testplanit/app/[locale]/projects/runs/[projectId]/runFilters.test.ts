/**
 * Run-list filter semantics.
 *
 * The load-bearing rule is that Manual and Automated are independent toggles:
 * "both on" and "both off" must collapse to the same unfiltered query. A
 * regression here doesn't throw — it silently shows the wrong runs.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_RUN_FILTERS,
  isAnyRunFilterActive,
  parseStoredRunFilters,
  runFiltersStorageKey,
  runTypeFilterFor,
  type RunFilters,
} from "./runFilters";

const filters = (overrides: Partial<RunFilters> = {}): RunFilters => ({
  ...EMPTY_RUN_FILTERS,
  ...overrides,
});

describe("runTypeFilterFor", () => {
  it("returns both when neither type chip is on", () => {
    expect(runTypeFilterFor(filters())).toBe("both");
  });

  it("returns both when both type chips are on", () => {
    expect(runTypeFilterFor(filters({ manual: true, automated: true }))).toBe(
      "both"
    );
  });

  it("returns manual when only Manual is on", () => {
    expect(runTypeFilterFor(filters({ manual: true }))).toBe("manual");
  });

  it("returns automated when only Automated is on", () => {
    expect(runTypeFilterFor(filters({ automated: true }))).toBe("automated");
  });

  it("ignores the participation chip", () => {
    expect(runTypeFilterFor(filters({ mine: true }))).toBe("both");
    expect(runTypeFilterFor(filters({ mine: true, automated: true }))).toBe(
      "automated"
    );
  });
});

describe("isAnyRunFilterActive", () => {
  it("is false with no chips on", () => {
    expect(isAnyRunFilterActive(filters())).toBe(false);
  });

  // Both-on filters nothing out, so the list is complete and the empty state
  // must not claim a filter hid anything.
  it("is false when both type chips are on, since that filters nothing", () => {
    expect(
      isAnyRunFilterActive(filters({ manual: true, automated: true }))
    ).toBe(false);
  });

  it("is true for a single type chip", () => {
    expect(isAnyRunFilterActive(filters({ manual: true }))).toBe(true);
    expect(isAnyRunFilterActive(filters({ automated: true }))).toBe(true);
  });

  it("is true for the participation chip alone", () => {
    expect(isAnyRunFilterActive(filters({ mine: true }))).toBe(true);
  });

  it("is true when participation is on and both type chips are on", () => {
    expect(
      isAnyRunFilterActive(
        filters({ manual: true, automated: true, mine: true })
      )
    ).toBe(true);
  });
});

describe("parseStoredRunFilters", () => {
  it("returns no filters when nothing is stored", () => {
    expect(parseStoredRunFilters(null)).toEqual(EMPTY_RUN_FILTERS);
  });

  it("round-trips a stored selection", () => {
    const stored = JSON.stringify(filters({ automated: true, mine: true }));
    expect(parseStoredRunFilters(stored)).toEqual({
      manual: false,
      automated: true,
      mine: true,
    });
  });

  it("falls back to no filters on unparseable JSON", () => {
    expect(parseStoredRunFilters("{not json")).toEqual(EMPTY_RUN_FILTERS);
  });

  it("falls back to no filters on a non-object payload", () => {
    expect(parseStoredRunFilters("42")).toEqual(EMPTY_RUN_FILTERS);
    expect(parseStoredRunFilters("null")).toEqual(EMPTY_RUN_FILTERS);
  });

  // A stale key from an older build must not reach the query as a partial or
  // non-boolean shape.
  it("coerces missing and non-boolean fields to off", () => {
    expect(
      parseStoredRunFilters(JSON.stringify({ manual: "yes", mine: 1 }))
    ).toEqual(EMPTY_RUN_FILTERS);
  });
});

describe("runFiltersStorageKey", () => {
  // Per project: filtering one project must not narrow another.
  it("scopes the key to the project", () => {
    expect(runFiltersStorageKey(7)).toBe("tpi.runs.7.filters");
    expect(runFiltersStorageKey(7)).not.toBe(runFiltersStorageKey(8));
  });
});
