import { describe, expect, it } from "vitest";

import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  buildFilterPredicateSchema,
  buildFilterPredicatesSchema,
  coerceFilterPredicate,
  filterPredicateInputSchema,
  parseFilterPredicates,
  type FilterPredicateInput,
} from "./repositoryFilterPredicates";

const runRegistry = buildFilterDimensions({
  includeRunDimensions: true,
  dynamicFields: {
    Severity: { fieldId: 1, type: "Dropdown" },
    Estimate: { fieldId: 4, type: "Integer" },
    Due: { fieldId: 6, type: "Date" },
    Notes: { fieldId: 7, type: "Text Long" },
    Spec: { fieldId: 9, type: "Link" },
    Reproduction: { fieldId: 10, type: "Steps" },
    Regression: { fieldId: 3, type: "Checkbox" },
  },
});
const repoRegistry = buildFilterDimensions({
  dynamicFields: { Notes: { fieldId: 7, type: "Text Long" } },
});

function predicate(
  dimension: string,
  operator: string,
  values: Array<string | number> = []
): FilterPredicateInput {
  return { dimension, operator, values };
}

describe("filterPredicateInputSchema (structural)", () => {
  it("rejects non-letter-first dimensions", () => {
    expect(
      filterPredicateInputSchema.safeParse(predicate("9lives", "in", [1]))
        .success
    ).toBe(false);
    expect(
      filterPredicateInputSchema.safeParse(predicate("a-b", "in", [1])).success
    ).toBe(false);
    expect(
      filterPredicateInputSchema.safeParse(predicate("", "in", [1])).success
    ).toBe(false);
  });

  it("rejects empty operators and non-array values", () => {
    expect(
      filterPredicateInputSchema.safeParse(predicate("tags", "", [])).success
    ).toBe(false);
    expect(
      filterPredicateInputSchema.safeParse({
        dimension: "tags",
        operator: "any",
        values: "1",
      }).success
    ).toBe(false);
  });
});

describe("coerceFilterPredicate — dimension/operator validation", () => {
  it("drops unknown dimensions", () => {
    expect(
      coerceFilterPredicate(predicate("banana", "in", [1]), runRegistry)
    ).toBeNull();
  });

  it("drops operators outside the dimension whitelist", () => {
    expect(
      coerceFilterPredicate(predicate("templates", "any", []), runRegistry)
    ).toBeNull();
    expect(
      coerceFilterPredicate(predicate("tags", "in", [1]), runRegistry)
    ).toBeNull();
    // Steps has no "ne".
    expect(
      coerceFilterPredicate(predicate("field_10", "ne", [1]), runRegistry)
    ).toBeNull();
  });

  it("drops run dimensions when the registry excludes them (repo/selection mode)", () => {
    expect(
      coerceFilterPredicate(predicate("status", "in", [1]), repoRegistry)
    ).toBeNull();
    expect(
      coerceFilterPredicate(
        predicate("assignedTo", "in", ["cku1"]),
        repoRegistry
      )
    ).toBeNull();
    // Same predicates are valid against the run registry.
    expect(
      coerceFilterPredicate(predicate("status", "in", [1]), runRegistry)
    ).toEqual({ dimension: "status", operator: "in", values: [1] });
  });
});

describe("coerceFilterPredicate — arity", () => {
  it("enforces exact arities", () => {
    expect(
      coerceFilterPredicate(predicate("automated", "is", [1, 0]), runRegistry)
    ).toBeNull();
    expect(
      coerceFilterPredicate(predicate("automated", "is", []), runRegistry)
    ).toBeNull();
    expect(
      coerceFilterPredicate(predicate("field_4", "eq", [1, 2]), runRegistry)
    ).toBeNull();
  });

  it("requires at least one value for in and all", () => {
    expect(
      coerceFilterPredicate(predicate("templates", "in", []), runRegistry)
    ).toBeNull();
    expect(
      coerceFilterPredicate(predicate("tags", "all", []), runRegistry)
    ).toBeNull();
  });

  it("requires exactly two values for between", () => {
    expect(
      coerceFilterPredicate(predicate("field_4", "between", [5]), runRegistry)
    ).toBeNull();
    expect(
      coerceFilterPredicate(
        predicate("field_4", "between", [1, 2, 3]),
        runRegistry
      )
    ).toBeNull();
  });

  it("requires zero values for relative date operators", () => {
    expect(
      coerceFilterPredicate(
        predicate("field_6", "last7", ["2026-01-01"]),
        runRegistry
      )
    ).toBeNull();
    expect(
      coerceFilterPredicate(predicate("field_6", "last7", []), runRegistry)
    ).toEqual({ dimension: "field_6", operator: "last7", values: [] });
  });

  it("allows any/none bare or with values", () => {
    expect(
      coerceFilterPredicate(predicate("tags", "any", []), runRegistry)
    ).toEqual({ dimension: "tags", operator: "any", values: [] });
    expect(
      coerceFilterPredicate(predicate("tags", "any", ["1", "2"]), runRegistry)
    ).toEqual({ dimension: "tags", operator: "any", values: [1, 2] });
    expect(
      coerceFilterPredicate(predicate("field_7", "none", []), runRegistry)
    ).toEqual({ dimension: "field_7", operator: "none", values: [] });
  });
});

describe("coerceFilterPredicate — value coercion", () => {
  it("coerces idList strings to integers", () => {
    expect(
      coerceFilterPredicate(
        predicate("templates", "in", ["1", "2"]),
        runRegistry
      )
    ).toEqual({ dimension: "templates", operator: "in", values: [1, 2] });
  });

  it("keeps per-dimension sentinels as strings, drops other non-numeric idList values", () => {
    expect(
      coerceFilterPredicate(
        predicate("status", "in", ["untested", "5"]),
        runRegistry
      )
    ).toEqual({ dimension: "status", operator: "in", values: ["untested", 5] });
    expect(
      coerceFilterPredicate(predicate("status", "in", ["banana"]), runRegistry)
    ).toBeNull();
    // "untested" is a status sentinel, not a tags sentinel.
    expect(
      coerceFilterPredicate(predicate("tags", "any", ["untested"]), runRegistry)
    ).toBeNull();
  });

  it("keeps userList strings, including the unassigned sentinel", () => {
    expect(
      coerceFilterPredicate(
        predicate("assignedTo", "in", ["cku123", "unassigned"]),
        runRegistry
      )
    ).toEqual({
      dimension: "assignedTo",
      operator: "in",
      values: ["cku123", "unassigned"],
    });
    // Numbers become strings for userList dims (route bodies may send them).
    expect(
      coerceFilterPredicate(predicate("creators", "in", [42]), runRegistry)
    ).toEqual({ dimension: "creators", operator: "in", values: ["42"] });
  });

  it("coerces boolean dims to exactly 0 | 1", () => {
    expect(
      coerceFilterPredicate(predicate("automated", "is", ["1"]), runRegistry)
    ).toEqual({ dimension: "automated", operator: "is", values: [1] });
    expect(
      coerceFilterPredicate(predicate("automated", "is", ["0"]), runRegistry)
    ).toEqual({ dimension: "automated", operator: "is", values: [0] });
    expect(
      coerceFilterPredicate(predicate("field_3", "is", [0]), runRegistry)
    ).toEqual({ dimension: "field_3", operator: "is", values: [0] });
    for (const bad of ["2", "true", "", 2]) {
      expect(
        coerceFilterPredicate(predicate("automated", "is", [bad]), runRegistry),
        String(bad)
      ).toBeNull();
    }
  });

  it("coerces numeric strings for number/steps dims, drops garbage", () => {
    expect(
      coerceFilterPredicate(predicate("field_4", "gte", ["3.5"]), runRegistry)
    ).toEqual({ dimension: "field_4", operator: "gte", values: [3.5] });
    expect(
      coerceFilterPredicate(predicate("field_10", "lt", ["7"]), runRegistry)
    ).toEqual({ dimension: "field_10", operator: "lt", values: [7] });
    for (const bad of ["abc", "", " ", "Infinity"]) {
      expect(
        coerceFilterPredicate(predicate("field_4", "eq", [bad]), runRegistry),
        JSON.stringify(bad)
      ).toBeNull();
    }
  });

  it("keeps parseable date strings as strings, drops unparseable ones", () => {
    expect(
      coerceFilterPredicate(
        predicate("field_6", "on", ["2026-08-04T10:30:00.000Z"]),
        runRegistry
      )
    ).toEqual({
      dimension: "field_6",
      operator: "on",
      values: ["2026-08-04T10:30:00.000Z"],
    });
    expect(
      coerceFilterPredicate(
        predicate("field_6", "on", ["not-a-date"]),
        runRegistry
      )
    ).toBeNull();
    // A raw number is not a date wire value.
    expect(
      coerceFilterPredicate(predicate("field_6", "on", [1234567]), runRegistry)
    ).toBeNull();
  });

  it("caps free-text values at 256 chars", () => {
    const max = "x".repeat(256);
    const over = "x".repeat(257);
    expect(
      coerceFilterPredicate(
        predicate("field_7", "contains", [max]),
        runRegistry
      )
    ).toEqual({ dimension: "field_7", operator: "contains", values: [max] });
    expect(
      coerceFilterPredicate(
        predicate("field_7", "contains", [over]),
        runRegistry
      )
    ).toBeNull();
  });

  it("stringifies numeric values on text/link dims", () => {
    expect(
      coerceFilterPredicate(predicate("field_7", "eq", [5]), runRegistry)
    ).toEqual({ dimension: "field_7", operator: "eq", values: ["5"] });
    expect(
      coerceFilterPredicate(
        predicate("field_9", "domain", ["example.com"]),
        runRegistry
      )
    ).toEqual({
      dimension: "field_9",
      operator: "domain",
      values: ["example.com"],
    });
  });
});

describe("coerceFilterPredicate — between normalization", () => {
  it("normalizes numeric between values ascending", () => {
    expect(
      coerceFilterPredicate(
        predicate("field_4", "between", ["5", "2"]),
        runRegistry
      )
    ).toEqual({ dimension: "field_4", operator: "between", values: [2, 5] });
  });

  it("normalizes date between values ascending by date, not by string", () => {
    expect(
      coerceFilterPredicate(
        predicate("field_6", "between", [
          "2026-06-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
        ]),
        runRegistry
      )
    ).toEqual({
      dimension: "field_6",
      operator: "between",
      values: ["2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"],
    });
  });

  it("keeps already-ascending between values unchanged", () => {
    expect(
      coerceFilterPredicate(
        predicate("field_10", "between", [2, 5]),
        runRegistry
      )
    ).toEqual({ dimension: "field_10", operator: "between", values: [2, 5] });
  });
});

describe("buildFilterPredicateSchema", () => {
  it("fails safeParse for predicates the registry would drop", () => {
    const schema = buildFilterPredicateSchema(runRegistry);
    expect(schema.safeParse(predicate("banana", "in", [1])).success).toBe(
      false
    );
    expect(schema.safeParse(predicate("templates", "in", [])).success).toBe(
      false
    );
    expect(
      schema.safeParse(predicate("status", "in", ["banana"])).success
    ).toBe(false);
  });

  it("returns the coerced predicate on success", () => {
    const schema = buildFilterPredicateSchema(runRegistry);
    const result = schema.safeParse(predicate("templates", "in", ["3"]));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        dimension: "templates",
        operator: "in",
        values: [3],
      });
    }
  });
});

describe("buildFilterPredicatesSchema / parseFilterPredicates (lenient)", () => {
  it("parses non-array input to an empty array without throwing", () => {
    expect(parseFilterPredicates(undefined, runRegistry)).toEqual([]);
    expect(parseFilterPredicates(null, runRegistry)).toEqual([]);
    expect(parseFilterPredicates("garbage", runRegistry)).toEqual([]);
    expect(parseFilterPredicates({ dimension: "tags" }, runRegistry)).toEqual(
      []
    );
    expect(parseFilterPredicates(42, runRegistry)).toEqual([]);
  });

  it("drops invalid entries and keeps valid ones, order preserved", () => {
    const result = parseFilterPredicates(
      [
        predicate("tags", "all", ["1", "2"]),
        "junk",
        { dimension: "templates" },
        predicate("status", "in", ["banana"]),
        predicate("tags", "none", ["5"]),
        null,
      ],
      runRegistry
    );
    expect(result).toEqual([
      { dimension: "tags", operator: "all", values: [1, 2] },
      { dimension: "tags", operator: "none", values: [5] },
    ]);
  });

  it("permits multiple predicates on the same dimension", () => {
    const schema = buildFilterPredicatesSchema(runRegistry);
    const result = schema.parse([
      predicate("tags", "all", [1, 2]),
      predicate("tags", "none", [5]),
    ]);
    expect(result).toHaveLength(2);
  });

  it("drops run-dim predicates under a repo-only registry", () => {
    const result = parseFilterPredicates(
      [
        predicate("status", "in", [1]),
        predicate("assignedTo", "in", ["cku1"]),
        predicate("templates", "in", [1]),
      ],
      repoRegistry
    );
    expect(result).toEqual([
      { dimension: "templates", operator: "in", values: [1] },
    ]);
  });
});
