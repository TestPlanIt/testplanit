/**
 * Milestone card filter semantics.
 *
 * The load-bearing rules: status is one-of-three and "mine" is independent of
 * it (so "my active runs" stays reachable), and a stale or hostile stored
 * value degrades to unfiltered rather than hiding rows for an invisible
 * reason.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_CARD_FILTERS,
  isAnyCardFilterActive,
  matchesCardStatus,
  parseStoredCardFilters,
  runsCardFiltersStorageKey,
  sessionsCardFiltersStorageKey,
  type CardFilters,
} from "./cardFilters";

const filters = (overrides: Partial<CardFilters> = {}): CardFilters => ({
  ...EMPTY_CARD_FILTERS,
  ...overrides,
});

describe("matchesCardStatus", () => {
  it("admits both states when the status filter is all", () => {
    expect(matchesCardStatus(filters(), true)).toBe(true);
    expect(matchesCardStatus(filters(), false)).toBe(true);
  });

  it("admits only incomplete rows for active", () => {
    expect(matchesCardStatus(filters({ status: "active" }), false)).toBe(true);
    expect(matchesCardStatus(filters({ status: "active" }), true)).toBe(false);
  });

  it("admits only completed rows for completed", () => {
    expect(matchesCardStatus(filters({ status: "completed" }), true)).toBe(
      true
    );
    expect(matchesCardStatus(filters({ status: "completed" }), false)).toBe(
      false
    );
  });

  // "mine" is a separate axis — it must never leak into the status decision,
  // which is what keeps "my active runs" expressible.
  it("ignores the participation chip", () => {
    expect(matchesCardStatus(filters({ mine: true }), true)).toBe(true);
    expect(
      matchesCardStatus(filters({ mine: true, status: "active" }), true)
    ).toBe(false);
  });
});

describe("isAnyCardFilterActive", () => {
  it("is false with the default filters", () => {
    expect(isAnyCardFilterActive(EMPTY_CARD_FILTERS)).toBe(false);
  });

  it("is true for a narrowing status", () => {
    expect(isAnyCardFilterActive(filters({ status: "active" }))).toBe(true);
    expect(isAnyCardFilterActive(filters({ status: "completed" }))).toBe(true);
  });

  it("is true for the participation chip alone", () => {
    expect(isAnyCardFilterActive(filters({ mine: true }))).toBe(true);
  });
});

describe("parseStoredCardFilters", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(parseStoredCardFilters(null)).toEqual(EMPTY_CARD_FILTERS);
  });

  it("round-trips a stored selection", () => {
    const stored = JSON.stringify(filters({ status: "completed", mine: true }));
    expect(parseStoredCardFilters(stored)).toEqual({
      status: "completed",
      mine: true,
    });
  });

  it("falls back to the defaults on unparseable JSON", () => {
    expect(parseStoredCardFilters("{not json")).toEqual(EMPTY_CARD_FILTERS);
  });

  it("falls back to the defaults on a non-object payload", () => {
    expect(parseStoredCardFilters("42")).toEqual(EMPTY_CARD_FILTERS);
    expect(parseStoredCardFilters("null")).toEqual(EMPTY_CARD_FILTERS);
  });

  // An unrecognised status would match no row at all, emptying the card with
  // no way for the user to see why.
  it("coerces an unknown status back to all", () => {
    expect(
      parseStoredCardFilters(JSON.stringify({ status: "archived" }))
    ).toEqual(EMPTY_CARD_FILTERS);
    expect(parseStoredCardFilters(JSON.stringify({ status: 3 }))).toEqual(
      EMPTY_CARD_FILTERS
    );
  });

  it("coerces a non-boolean mine to off", () => {
    expect(parseStoredCardFilters(JSON.stringify({ mine: 1 }))).toEqual(
      EMPTY_CARD_FILTERS
    );
  });
});

describe("storage keys", () => {
  // Per milestone, and per card: filtering one must not narrow the other.
  it("scopes each key to the milestone", () => {
    expect(runsCardFiltersStorageKey(7)).toBe(
      "tpi.milestone.7.testRuns.filters"
    );
    expect(sessionsCardFiltersStorageKey(7)).toBe(
      "tpi.milestone.7.sessions.filters"
    );
    expect(runsCardFiltersStorageKey(7)).not.toBe(runsCardFiltersStorageKey(8));
    expect(runsCardFiltersStorageKey(7)).not.toBe(
      sessionsCardFiltersStorageKey(7)
    );
  });
});
