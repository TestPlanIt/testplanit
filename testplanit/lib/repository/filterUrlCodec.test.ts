import { describe, expect, it } from "vitest";

import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import {
  buildFilterDimensions,
  getOperatorArity,
  type FilterDimension,
  type FilterDimensionRegistry,
} from "./filterDimensions";
import {
  applyReadabilityPass,
  canonicalPredicateKey,
  parseFilterParam,
  parseFilterParams,
  serializeFilterPredicate,
  serializeFilterPredicates,
} from "./filterUrlCodec";

const dynamicFields = {
  Severity: { fieldId: 1, type: "Dropdown" },
  Labels: { fieldId: 2, type: "Multi-Select" },
  Regression: { fieldId: 3, type: "Checkbox" },
  Estimate: { fieldId: 4, type: "Integer" },
  Weight: { fieldId: 5, type: "Number" },
  Due: { fieldId: 6, type: "Date" },
  Notes: { fieldId: 7, type: "Text Long" },
  Ref: { fieldId: 8, type: "Text String" },
  Spec: { fieldId: 9, type: "Link" },
  Reproduction: { fieldId: 10, type: "Steps" },
};

const runRegistry = buildFilterDimensions({
  includeRunDimensions: true,
  dynamicFields,
});
const repoRegistry = buildFilterDimensions({ dynamicFields });

/**
 * Full wire simulation: serialize → URLSearchParams.toString() (form-encode)
 * → readability pass → re-read via URLSearchParams (form-decode) → parse.
 * This is exactly the write/read path the URL-state hook will use.
 */
function roundTrip(
  predicates: FilterPredicate[],
  registry: FilterDimensionRegistry = runRegistry,
  baseSearch = ""
): { predicates: FilterPredicate[]; queryString: string } {
  const sp = new URLSearchParams(baseSearch);
  sp.delete("f");
  for (const token of serializeFilterPredicates(predicates)) {
    sp.append("f", token);
  }
  const queryString = applyReadabilityPass(sp.toString());
  const back = new URLSearchParams(queryString);
  return {
    predicates: parseFilterParams(back.getAll("f"), registry),
    queryString,
  };
}

/** Representative valid values for a dimension × operator pair. */
function sampleValues(
  dimension: FilterDimension,
  operator: string
): Array<string | number> {
  const arity = getOperatorArity(operator);
  if (!arity || arity.max === 0) return [];
  if (operator === "any" || operator === "none") return [];
  const count = operator === "between" ? 2 : arity.max === null ? 2 : arity.min;
  switch (dimension.valueType) {
    case "idList":
    case "options":
      return [1, 2].slice(0, count);
    case "userList":
      return ["cku123abc", "ckv456def"].slice(0, count);
    case "boolean":
      return [1];
    case "number":
    case "steps":
      return count === 2 ? [2, 5] : [7];
    case "date":
      return count === 2
        ? ["2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"]
        : ["2026-08-04T10:30:00.000Z"];
    case "text":
      return ['smoke, "test":case|100% done 🔥'];
    case "link":
      return ["https://example.com/a?b=1&c=2"];
  }
}

describe("round-trip identity", () => {
  it("round-trips every dimension × operator in the full registry", () => {
    for (const dimension of runRegistry.values()) {
      for (const operator of dimension.operators) {
        const predicate: FilterPredicate = {
          dimension: dimension.key,
          operator,
          values: sampleValues(dimension, operator),
        };
        const { predicates } = roundTrip([predicate]);
        expect(predicates, `${dimension.key}:${operator}`).toEqual([predicate]);
      }
    }
  });

  it("round-trips free text containing commas, colons, pipes, percents, and unicode", () => {
    const nasty = [
      "foo,bar",
      "a:b:c",
      "pipe|pipe",
      "100%",
      "%2C already encoded",
      "%3A also encoded",
      "café 🔥 überstraße",
      "a&b=c",
      " leading and trailing ",
      "+plus+signs+",
      "question?mark#hash",
    ];
    for (const value of nasty) {
      const predicate: FilterPredicate = {
        dimension: "field_7",
        operator: "contains",
        values: [value],
      };
      const { predicates } = roundTrip([predicate]);
      expect(predicates, JSON.stringify(value)).toEqual([predicate]);
    }
  });

  it("round-trips multiple values that each contain the join delimiters", () => {
    const predicate: FilterPredicate = {
      dimension: "creators",
      operator: "in",
      values: ["we,ird", "co:lon", "pi|pe"],
    };
    const { predicates } = roundTrip([predicate]);
    expect(predicates).toEqual([predicate]);
  });

  it("round-trips several predicates preserving order, including duplicates per dimension", () => {
    const input: FilterPredicate[] = [
      { dimension: "tags", operator: "all", values: [1, 2] },
      { dimension: "templates", operator: "in", values: [3] },
      { dimension: "tags", operator: "none", values: [5] },
      {
        dimension: "assignedTo",
        operator: "in",
        values: ["cku1", "unassigned"],
      },
    ];
    const { predicates } = roundTrip(input);
    expect(predicates).toEqual(input);
  });

  it("preserves unrelated params through the readability pass", () => {
    const { queryString } = roundTrip(
      [{ dimension: "templates", operator: "in", values: [1] }],
      runRegistry,
      "node=42&view=folders&case=7"
    );
    const back = new URLSearchParams(queryString);
    expect(back.get("node")).toBe("42");
    expect(back.get("view")).toBe("folders");
    expect(back.get("case")).toBe("7");
  });
});

describe("serializeFilterPredicate", () => {
  it("omits the values segment for bare operators", () => {
    expect(
      serializeFilterPredicate({
        dimension: "tags",
        operator: "any",
        values: [],
      })
    ).toBe("tags:any");
  });

  it("component-encodes each value BEFORE joining with commas", () => {
    expect(
      serializeFilterPredicate({
        dimension: "field_7",
        operator: "contains",
        values: ["foo,bar"],
      })
    ).toBe("field_7:contains:foo%2Cbar");
    expect(
      serializeFilterPredicate({
        dimension: "templates",
        operator: "in",
        values: [1, 2],
      })
    ).toBe("templates:in:1,2");
  });
});

describe("readability pass", () => {
  it("restores structural colons and commas in the final query string", () => {
    const { queryString } = roundTrip([
      { dimension: "templates", operator: "in", values: [1, 2] },
      { dimension: "tags", operator: "any", values: [] },
    ]);
    expect(queryString).toBe("f=templates:in:1,2&f=tags:any");
  });

  it("does not touch double-encoded delimiters inside values (lossless)", () => {
    const predicate: FilterPredicate = {
      dimension: "field_7",
      operator: "eq",
      values: ["a:b,c"],
    };
    const { predicates, queryString } = roundTrip([predicate]);
    // Literal ":" and "," were component-encoded (%3A/%2C) then form-encoded
    // (%253A/%252C); the pass must leave them alone.
    expect(queryString).toBe("f=field_7:eq:a%253Ab%252Cc");
    expect(predicates).toEqual([predicate]);
  });

  it("is lossless for values that literally contain %3A / %2C text", () => {
    const predicate: FilterPredicate = {
      dimension: "field_7",
      operator: "contains",
      values: ["50%3A50 and 100%2C00"],
    };
    const { predicates } = roundTrip([predicate]);
    expect(predicates).toEqual([predicate]);
  });

  it("applies the exact spec replacements", () => {
    expect(applyReadabilityPass("f=templates%3Ain%3A1%2C2")).toBe(
      "f=templates:in:1,2"
    );
  });
});

describe("parseFilterParam / parseFilterParams", () => {
  it("parses hand-typed unencoded ISO dates with colons (indexOf splitting)", () => {
    expect(
      parseFilterParam("field_6:on:2026-08-04T10:30:00.000Z", runRegistry)
    ).toEqual({
      dimension: "field_6",
      operator: "on",
      values: ["2026-08-04T10:30:00.000Z"],
    });
    expect(
      parseFilterParam(
        "field_6:between:2026-01-01T00:00:00Z,2026-06-01T00:00:00Z",
        runRegistry
      )
    ).toEqual({
      dimension: "field_6",
      operator: "between",
      values: ["2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"],
    });
  });

  it("treats a trailing colon with no values as the bare form", () => {
    expect(parseFilterParam("tags:any:", runRegistry)).toEqual({
      dimension: "tags",
      operator: "any",
      values: [],
    });
  });

  it("drops malformed % escapes without throwing", () => {
    expect(
      parseFilterParam("field_7:contains:%E0%A4%A", runRegistry)
    ).toBeNull();
    expect(parseFilterParam("creators:in:%ZZ", runRegistry)).toBeNull();
    expect(() =>
      parseFilterParams(["field_7:contains:%"], runRegistry)
    ).not.toThrow();
  });

  it("drops structurally broken params", () => {
    expect(parseFilterParam("noColonAtAll", runRegistry)).toBeNull();
    expect(parseFilterParam(":in:1", runRegistry)).toBeNull();
    expect(parseFilterParam("tags:", runRegistry)).toBeNull();
    expect(parseFilterParam("", runRegistry)).toBeNull();
  });

  it("drops wrong-arity params", () => {
    expect(parseFilterParam("automated:is:1,0", runRegistry)).toBeNull();
    expect(parseFilterParam("templates:in", runRegistry)).toBeNull();
    expect(parseFilterParam("field_4:between:5", runRegistry)).toBeNull();
    expect(
      parseFilterParam("field_6:last7:2026-01-01", runRegistry)
    ).toBeNull();
  });

  it("normalizes between values ascending at parse", () => {
    expect(parseFilterParam("field_4:between:5,2", runRegistry)).toEqual({
      dimension: "field_4",
      operator: "between",
      values: [2, 5],
    });
  });

  it("keeps sentinels and drops non-sentinel garbage ids", () => {
    expect(parseFilterParam("status:in:untested,5", runRegistry)).toEqual({
      dimension: "status",
      operator: "in",
      values: ["untested", 5],
    });
    expect(parseFilterParam("status:in:banana", runRegistry)).toBeNull();
    expect(parseFilterParam("assignedTo:in:unassigned", runRegistry)).toEqual({
      dimension: "assignedTo",
      operator: "in",
      values: ["unassigned"],
    });
  });

  it("drops run-dim params when the registry excludes run dims", () => {
    const raw = ["status:in:1", "assignedTo:in:cku1", "templates:in:1"];
    expect(parseFilterParams(raw, repoRegistry)).toEqual([
      { dimension: "templates", operator: "in", values: [1] },
    ]);
    expect(parseFilterParams(raw, runRegistry)).toHaveLength(3);
  });

  it("drops values over the 256-char cap arriving via URL", () => {
    const over = encodeURIComponent("x".repeat(257));
    expect(
      parseFilterParam(`field_7:contains:${over}`, runRegistry)
    ).toBeNull();
    const max = encodeURIComponent("x".repeat(256));
    expect(
      parseFilterParam(`field_7:contains:${max}`, runRegistry)
    ).not.toBeNull();
  });

  it("keeps lenient batch semantics: invalid dropped, valid kept in order", () => {
    const result = parseFilterParams(
      ["templates:in:1", "garbage", "tags:any", "status:in:banana"],
      runRegistry
    );
    expect(result).toEqual([
      { dimension: "templates", operator: "in", values: [1] },
      { dimension: "tags", operator: "any", values: [] },
    ]);
  });
});

describe("canonicalPredicateKey", () => {
  it("is stable under predicate reordering", () => {
    const a: FilterPredicate[] = [
      { dimension: "templates", operator: "in", values: [1, 2] },
      { dimension: "tags", operator: "any", values: [] },
      { dimension: "tags", operator: "none", values: [5] },
    ];
    const b = [a[2], a[0], a[1]];
    expect(canonicalPredicateKey(a)).toBe(canonicalPredicateKey(b));
  });

  it("is stable under value reordering within a predicate", () => {
    expect(
      canonicalPredicateKey([
        { dimension: "templates", operator: "in", values: [2, 1] },
      ])
    ).toBe(
      canonicalPredicateKey([
        { dimension: "templates", operator: "in", values: [1, 2] },
      ])
    );
  });

  it("differs when values differ", () => {
    expect(
      canonicalPredicateKey([
        { dimension: "templates", operator: "in", values: [1] },
      ])
    ).not.toBe(
      canonicalPredicateKey([
        { dimension: "templates", operator: "in", values: [2] },
      ])
    );
  });

  it("sorts by dimension then operator then values", () => {
    expect(
      canonicalPredicateKey([
        { dimension: "templates", operator: "in", values: [2, 1] },
        { dimension: "tags", operator: "none", values: [5] },
        { dimension: "tags", operator: "all", values: [3] },
      ])
    ).toBe("tags:all:3&tags:none:5&templates:in:1,2");
  });

  it("does not mutate the input predicates", () => {
    const values = [5, 2];
    const input: FilterPredicate[] = [
      { dimension: "templates", operator: "in", values },
    ];
    canonicalPredicateKey(input);
    expect(values).toEqual([5, 2]);
  });

  it("returns an empty string for no predicates", () => {
    expect(canonicalPredicateKey([])).toBe("");
  });
});
