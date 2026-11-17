import { describe, expect, it } from "vitest";
import {
  FAILED_DELIVERY_WHERE,
  SUCCEEDED_DELIVERY_WHERE,
  isIgnoredDeliveryNote,
} from "./deliveryNotes";

describe("delivery notes", () => {
  it("tells an ignored note from a failure", () => {
    expect(isIgnoredDeliveryNote("ignored:not_imported")).toBe(true);
    expect(isIgnoredDeliveryNote("ignored:no_cases")).toBe(true);
    expect(isIgnoredDeliveryNote("run:no_workflow")).toBe(false);
    expect(isIgnoredDeliveryNote("execute:target_disabled")).toBe(false);
    expect(isIgnoredDeliveryNote(null)).toBe(false);
    expect(isIgnoredDeliveryNote(undefined)).toBe(false);
  });

  it("filters failures without ignored notes, and successes with them", () => {
    expect(FAILED_DELIVERY_WHERE).toEqual({
      error: { not: null },
      NOT: { error: { startsWith: "ignored:" } },
    });
    expect(SUCCEEDED_DELIVERY_WHERE).toEqual({
      OR: [{ error: null }, { error: { startsWith: "ignored:" } }],
    });
  });
});
