import { describe, expect, it } from "vitest";

import { matchesSubscription } from "./subscription-matching";

/**
 * outbound subscription filter.
 *
 * Empty array (or null/undefined) = subscribe-all. Non-empty array filters
 * by exact string match. NO wildcards.
 */
describe("matchesSubscription", () => {
  it.each([
    {
      eventName: "test_run.completed",
      subs: [],
      expected: true,
      label: "empty array = subscribe-all",
    },
    {
      eventName: "test_run.completed",
      subs: ["test_run.completed"],
      expected: true,
      label: "exact single match",
    },
    {
      eventName: "test_run.completed",
      subs: ["issue.created", "test_run.completed"],
      expected: true,
      label: "exact match within multi-event subscription",
    },
    {
      eventName: "test_run.completed",
      subs: ["issue.created"],
      expected: false,
      label: "no match returns false",
    },
    {
      eventName: "test_run.completed",
      subs: ["test_run.*"],
      expected: false,
      label: "wildcard pattern test_run.* NOT supported",
    },
    {
      eventName: "test_run.completed",
      subs: null as unknown as string[] | null,
      expected: true,
      label: "null subscribedEvents = subscribe-all (defensive)",
    },
    {
      eventName: "test_run.completed",
      subs: undefined as unknown as string[] | undefined,
      expected: true,
      label: "undefined subscribedEvents = subscribe-all (defensive)",
    },
    {
      eventName: "",
      subs: [],
      expected: true,
      label: "empty event name + empty subs returns true (defensive)",
    },
  ])(
    "$label",
    ({
      eventName,
      subs,
      expected,
    }: {
      eventName: string;
      subs: readonly string[] | null | undefined;
      expected: boolean;
    }) => {
      expect(matchesSubscription(eventName, subs)).toBe(expected);
    }
  );
});
