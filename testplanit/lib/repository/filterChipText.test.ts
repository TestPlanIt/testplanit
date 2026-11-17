import { fr } from "date-fns/locale";
import { describe, expect, it } from "vitest";

import { formatFilterChipText } from "./filterChipText";
import { buildFilterDimensions } from "./filterDimensions";

const registry = buildFilterDimensions({
  dynamicFields: [
    { fieldId: 1, type: "Date" },
    { fieldId: 2, type: "Number" },
  ],
});

describe("formatFilterChipText", () => {
  it("replaces ids by their names and reads bare operators alone", () => {
    expect(
      formatFilterChipText({
        dimension: registry.get("tags")!,
        predicate: { dimension: "tags", operator: "any", values: [2, 3] },
        label: "Tag",
        operatorLabel: "Any of",
        options: [{ id: 2, name: "smoke" }],
      })
    ).toBe("Tag: Any of smoke, 3");
    expect(
      formatFilterChipText({
        dimension: registry.get("tags")!,
        predicate: { dimension: "tags", operator: "none", values: [] },
        label: "Tag",
        operatorLabel: "Is empty",
        options: [],
      })
    ).toBe("Tag: Is empty");
  });

  it("formats dates in the given locale and numbers with grouping", () => {
    expect(
      formatFilterChipText({
        dimension: registry.get("field_1")!,
        predicate: {
          dimension: "field_1",
          operator: "on",
          values: ["2026-10-19T12:00:00"],
        },
        label: "Due",
        operatorLabel: "On",
        options: [],
        dateLocale: fr,
      })
    ).toBe("Due: On 19 oct. 2026");
    expect(
      formatFilterChipText({
        dimension: registry.get("field_2")!,
        predicate: { dimension: "field_2", operator: "gte", values: [12345] },
        label: "Runs",
        operatorLabel: "Greater than or equal",
        options: [],
        localeTag: "en-US",
      })
    ).toBe("Runs: Greater than or equal 12,345");
  });
});
