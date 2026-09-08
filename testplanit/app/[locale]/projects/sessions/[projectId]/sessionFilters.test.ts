/**
 * Session-list filter semantics.
 *
 * The load-bearing rule is what counts as "mine": created-by OR assigned-to.
 * A regression here doesn't throw — it silently shows the wrong sessions.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_SESSION_FILTERS,
  isAnySessionFilterActive,
  isMySession,
  parseStoredSessionFilters,
  sessionFiltersStorageKey,
} from "./sessionFilters";

describe("isAnySessionFilterActive", () => {
  it("is false with no chips on", () => {
    expect(isAnySessionFilterActive(EMPTY_SESSION_FILTERS)).toBe(false);
  });

  it("is true for the participation chip", () => {
    expect(isAnySessionFilterActive({ mine: true })).toBe(true);
  });
});

describe("isMySession", () => {
  it("matches a session the user created", () => {
    expect(isMySession({ createdById: "u1", assignedToId: null }, "u1")).toBe(
      true
    );
  });

  it("matches a session assigned to the user", () => {
    expect(
      isMySession({ createdById: "someone-else", assignedToId: "u1" }, "u1")
    ).toBe(true);
  });

  it("does not match a session the user has no role on", () => {
    expect(isMySession({ createdById: "u2", assignedToId: "u3" }, "u1")).toBe(
      false
    );
  });

  it("matches nothing when the user is unknown", () => {
    // A signed-out or still-loading session must not silently match rows
    // whose assignee is also absent.
    expect(
      isMySession({ createdById: "u1", assignedToId: null }, undefined)
    ).toBe(false);
    expect(isMySession({ createdById: "u1", assignedToId: null }, null)).toBe(
      false
    );
  });
});

describe("parseStoredSessionFilters", () => {
  it("returns no filters when nothing is stored", () => {
    expect(parseStoredSessionFilters(null)).toEqual(EMPTY_SESSION_FILTERS);
  });

  it("round-trips a stored selection", () => {
    expect(parseStoredSessionFilters(JSON.stringify({ mine: true }))).toEqual({
      mine: true,
    });
  });

  it("falls back to no filters on unparseable JSON", () => {
    expect(parseStoredSessionFilters("{not json")).toEqual(
      EMPTY_SESSION_FILTERS
    );
  });

  it("falls back to no filters on a non-object payload", () => {
    expect(parseStoredSessionFilters("42")).toEqual(EMPTY_SESSION_FILTERS);
    expect(parseStoredSessionFilters("null")).toEqual(EMPTY_SESSION_FILTERS);
  });

  // A stale key from an older build must not reach the predicate as a
  // non-boolean.
  it("coerces missing and non-boolean fields to off", () => {
    expect(parseStoredSessionFilters(JSON.stringify({ mine: 1 }))).toEqual(
      EMPTY_SESSION_FILTERS
    );
    expect(parseStoredSessionFilters(JSON.stringify({}))).toEqual(
      EMPTY_SESSION_FILTERS
    );
  });
});

describe("sessionFiltersStorageKey", () => {
  // Per project: filtering one project must not narrow another.
  it("scopes the key to the project", () => {
    expect(sessionFiltersStorageKey(7)).toBe("tpi.sessions.7.filters");
    expect(sessionFiltersStorageKey(7)).not.toBe(sessionFiltersStorageKey(8));
  });
});
