import { Sparkles } from "lucide-react";
import { describe, expect, it } from "vitest";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  BOOLEAN_VALUE_LABEL_KEYS,
  DIMENSION_LABEL_KEYS,
} from "~/lib/repository/filterDimensionLabels";
import { getDimensionIcon } from "./dimensionPresentation";
import { getDimensionValueOptions } from "./valueOptions";

const t = (key: string) => key;
const dimension = buildFilterDimensions().get("suggestions")!;

describe("the suggestions filter dimension in the filter bar", () => {
  it("is a yes/no dimension every repository has", () => {
    expect(dimension).toMatchObject({
      key: "suggestions",
      scope: "repo",
      valueType: "boolean",
    });
  });

  it("has its own label, icon and value names", () => {
    expect(DIMENSION_LABEL_KEYS.suggestions).toBe(
      "repository.views.bySuggestion"
    );
    expect(getDimensionIcon(dimension)).toBe(Sparkles);
    expect(BOOLEAN_VALUE_LABEL_KEYS.suggestions).toEqual({
      true: "common.fields.hasSuggestion",
      false: "common.fields.noSuggestion",
    });
  });

  it("offers both values with their counts once they have loaded", () => {
    expect(
      getDimensionValueOptions(
        dimension,
        {
          suggestions: [
            { value: true, count: 3 },
            { value: false, count: 9 },
          ],
        },
        t
      )
    ).toEqual([
      { id: 1, name: "common.fields.hasSuggestion", count: 3 },
      { id: 0, name: "common.fields.noSuggestion", count: 9 },
    ]);
  });

  it("offers both values without counts before they load", () => {
    expect(getDimensionValueOptions(dimension, undefined, t)).toEqual([
      { id: 1, name: "common.fields.hasSuggestion", count: undefined },
      { id: 0, name: "common.fields.noSuggestion", count: undefined },
    ]);
  });
});
