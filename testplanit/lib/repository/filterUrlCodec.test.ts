import { deflateRawSync, inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_FILTER_PREDICATES,
  MAX_VALUES_PER_PREDICATE,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";
import {
  buildFilterDimensions,
  getOperatorArity,
  type FilterDimension,
  type FilterDimensionRegistry,
} from "./filterDimensions";
import {
  applyReadabilityPass,
  canonicalPredicateKey,
  decodeCompressedFilterParam,
  encodeCompressedFilterParam,
  encodeFilterPredicatesForUrl,
  FILTER_URL_PARAM_BUDGET,
  measureCompressedFilterParam,
  measureFilterParams,
  parseFilterParam,
  parseFilterParams,
  parseFilterUrlParams,
  parseFilterUrlParamsWithReport,
  serializeFilterPredicate,
  serializeFilterPredicates,
  setFilterUrlCompressor,
  type SyncFilterCompressor,
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

// --- URL-length mitigation tiers -----------------------------------------

/** Real raw-deflate, standing in for the library the app does not yet ship. */
const nodeZlibCompressor: SyncFilterCompressor = {
  deflateRaw: (input) => new Uint8Array(deflateRawSync(input)),
  inflateRaw: (input) => new Uint8Array(inflateRawSync(input)),
};

function textPredicate(value: string): FilterPredicate {
  return { dimension: "field_7", operator: "contains", values: [value] };
}

/** Text-heavy predicates: the shape that actually blows the budget. */
function bulkyPredicates(count: number): FilterPredicate[] {
  return Array.from({ length: count }, (_, index) => ({
    dimension: "field_7",
    operator: "contains",
    values: [`the quick brown fox jumps over the lazy dog ${index}`],
  }));
}

describe("measureFilterParams", () => {
  it("matches the length the f params actually occupy in the URL", () => {
    const predicates: FilterPredicate[] = [
      { dimension: "templates", operator: "in", values: [1, 2] },
      textPredicate("hello, world: 🎉"),
    ];
    const query = new URLSearchParams();
    for (const token of serializeFilterPredicates(predicates)) {
      query.append("f", token);
    }
    const actual = applyReadabilityPass(query.toString());

    expect(measureFilterParams(predicates)).toBe(actual.length);
    expect(actual.startsWith("f=templates:in:1,2&f=field_7:contains:")).toBe(
      true
    );
  });

  it("is zero for no predicates", () => {
    expect(measureFilterParams([])).toBe(0);
  });
});

describe("encodeCompressedFilterParam / decodeCompressedFilterParam", () => {
  beforeEach(() => {
    setFilterUrlCompressor(null);
  });

  it("round-trips unicode, emoji, commas and colons losslessly", () => {
    const predicates: FilterPredicate[] = [
      textPredicate("a,b:c 🎉 ünïcødé — 日本語"),
      { dimension: "field_9", operator: "domain", values: ["exämple.com"] },
      { dimension: "templates", operator: "in", values: [1, 2, 3] },
      { dimension: "creators", operator: "in", values: ["cku_1", "cku_2"] },
      { dimension: "tags", operator: "any", values: [] },
      {
        dimension: "field_6",
        operator: "on",
        values: ["2026-08-04T10:00:00Z"],
      },
    ];

    const encoded = encodeCompressedFilterParam(predicates)!;
    expect(encoded).toMatch(/^u[A-Za-z0-9_-]+$/);
    expect(decodeCompressedFilterParam(encoded, repoRegistry)).toEqual(
      predicates
    );
  });

  it("round-trips a 100-predicate set", () => {
    const predicates = bulkyPredicates(100);
    const encoded = encodeCompressedFilterParam(predicates)!;
    const decoded = decodeCompressedFilterParam(encoded, repoRegistry)!;

    // The collection cap trims to the first MAX_FILTER_PREDICATES, in order.
    expect(decoded).toHaveLength(MAX_FILTER_PREDICATES);
    expect(decoded).toEqual(predicates.slice(0, MAX_FILTER_PREDICATES));
  });

  it("round-trips through real raw-deflate when a compressor is registered", () => {
    setFilterUrlCompressor(nodeZlibCompressor);
    try {
      const predicates = bulkyPredicates(40);
      const encoded = encodeCompressedFilterParam(predicates)!;
      expect(encoded.startsWith("z")).toBe(true);
      expect(encoded).toMatch(/^z[A-Za-z0-9_-]+$/);
      expect(decodeCompressedFilterParam(encoded, repoRegistry)).toEqual(
        predicates.slice(0, MAX_FILTER_PREDICATES)
      );
      // Real compression beats the identity form on repetitive text.
      setFilterUrlCompressor(null);
      expect(encoded.length).toBeLessThan(
        encodeCompressedFilterParam(predicates)!.length
      );
    } finally {
      setFilterUrlCompressor(null);
    }
  });

  it("uses the base64url alphabet, so URLSearchParams leaves it untouched", () => {
    const encoded = encodeCompressedFilterParam([textPredicate("+/=?&# 🎉")])!;
    const query = new URLSearchParams();
    query.set("fz", encoded);
    expect(query.toString()).toBe(`fz=${encoded}`);
    expect(measureCompressedFilterParam(encoded)).toBe(query.toString().length);
  });

  it("returns null for an empty predicate array", () => {
    expect(encodeCompressedFilterParam([])).toBeNull();
  });

  it("drops corrupt payloads instead of throwing", () => {
    const valid = encodeCompressedFilterParam([
      { dimension: "templates", operator: "in", values: [1] },
    ])!;
    const corrupt = [
      "",
      "u",
      "u!!!!",
      "u" + "A".repeat(5), // 4n+1 base64url group
      `u${valid.slice(1, 6)}`, // truncated JSON
      "x" + valid.slice(1), // unknown algorithm tag
      "z" + valid.slice(1), // deflate tag with no compressor registered
    ];
    for (const raw of corrupt) {
      expect(() =>
        decodeCompressedFilterParam(raw, repoRegistry)
      ).not.toThrow();
      expect(decodeCompressedFilterParam(raw, repoRegistry)).toBeNull();
    }
  });

  it("drops a non-array JSON payload", () => {
    const bytes = new TextEncoder().encode('{"dimension":"templates"}');
    const base64 = Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeCompressedFilterParam(`u${base64}`, repoRegistry)).toBeNull();
  });

  it("drops individual invalid entries leniently, like f params", () => {
    const encoded = encodeCompressedFilterParam([
      { dimension: "templates", operator: "in", values: [1] },
      { dimension: "status", operator: "in", values: [3] },
      { dimension: "templates", operator: "bogus", values: [1] },
    ])!;
    expect(decodeCompressedFilterParam(encoded, repoRegistry)).toEqual([
      { dimension: "templates", operator: "in", values: [1] },
    ]);
    expect(decodeCompressedFilterParam(encoded, runRegistry)).toEqual([
      { dimension: "templates", operator: "in", values: [1] },
      { dimension: "status", operator: "in", values: [3] },
    ]);
  });
});

describe("encodeFilterPredicatesForUrl", () => {
  beforeEach(() => {
    setFilterUrlCompressor(null);
  });

  it("keeps the readable f form under the budget", () => {
    const predicates: FilterPredicate[] = [
      { dimension: "templates", operator: "in", values: [1, 2] },
      { dimension: "tags", operator: "any", values: [5, 6] },
    ];
    const encoding = encodeFilterPredicatesForUrl(predicates);

    expect(encoding.form).toBe("f");
    expect(encoding.compressed).toBeNull();
    expect(encoding.fParams).toEqual(serializeFilterPredicates(predicates));
    expect(encoding.fLength).toBeLessThan(FILTER_URL_PARAM_BUDGET);
  });

  it("switches forms exactly at the budget boundary", () => {
    // Grow a free-text predicate set one predicate at a time (values stay
    // under the 256-char value cap) and check the pair straddling the budget.
    let count = 1;
    while (
      measureFilterParams(bulkyPredicates(count)) <= FILTER_URL_PARAM_BUDGET
    ) {
      count += 1;
    }
    const over = bulkyPredicates(count);
    const under = bulkyPredicates(count - 1);

    expect(measureFilterParams(under)).toBeLessThanOrEqual(
      FILTER_URL_PARAM_BUDGET
    );
    expect(measureFilterParams(over)).toBeGreaterThan(FILTER_URL_PARAM_BUDGET);
    expect(encodeFilterPredicatesForUrl(under).form).toBe("f");

    const overEncoding = encodeFilterPredicatesForUrl(over);
    expect(overEncoding.form).toBe("fz");
    expect(overEncoding.fParams).toEqual([]);
    expect(overEncoding.compressedLength).toBeLessThan(overEncoding.fLength);
    expect(
      parseFilterUrlParams({ f: [], fz: overEncoding.compressed }, repoRegistry)
    ).toEqual(over);
  });

  it("stays on the f form when compressing would produce a LONGER url", () => {
    // Pure-alnum ids barely percent-encode, so base64's 33% overhead loses.
    const predicates: FilterPredicate[] = [
      {
        dimension: "creators",
        operator: "in",
        values: Array.from(
          { length: 80 },
          (_, i) => `cku${String(i).padStart(22, "0")}`
        ),
      },
    ];
    const encoding = encodeFilterPredicatesForUrl(predicates);

    expect(encoding.fLength).toBeGreaterThan(FILTER_URL_PARAM_BUDGET);
    expect(encoding.form).toBe("f");
    expect(encoding.compressedLength).toBeGreaterThanOrEqual(encoding.fLength);
  });

  it("emits no params at all for an empty predicate set", () => {
    const encoding = encodeFilterPredicatesForUrl([]);
    expect(encoding).toMatchObject({
      form: "f",
      fParams: [],
      compressed: null,
      fLength: 0,
      predicates: [],
      truncation: { predicatesDropped: 0, valuesTruncated: [] },
    });
  });

  it("flips an over-budget id-heavy set to fz once a real compressor is registered", () => {
    // The same input the identity encoder loses on: proof that the
    // setFilterUrlCompressor seam is what unlocks the compressed tier, and
    // that the choice is still made by measurement.
    const predicates: FilterPredicate[] = [
      {
        dimension: "creators",
        operator: "in",
        values: Array.from(
          { length: 80 },
          (_, i) => `cku${String(i).padStart(22, "0")}`
        ),
      },
    ];
    expect(encodeFilterPredicatesForUrl(predicates).form).toBe("f");

    setFilterUrlCompressor(nodeZlibCompressor);
    try {
      const encoding = encodeFilterPredicatesForUrl(predicates);
      expect(encoding.form).toBe("fz");
      expect(encoding.compressed!.startsWith("z")).toBe(true);
      expect(encoding.compressedLength).toBeLessThan(encoding.fLength);
      expect(
        parseFilterUrlParams({ f: [], fz: encoding.compressed }, repoRegistry)
      ).toEqual(predicates);
    } finally {
      setFilterUrlCompressor(null);
    }
  });

  it("clamps the predicate count at write time and reports the drop", () => {
    const input = bulkyPredicates(MAX_FILTER_PREDICATES + 9);
    const encoding = encodeFilterPredicatesForUrl(input);

    expect(encoding.predicates).toEqual(input.slice(0, MAX_FILTER_PREDICATES));
    expect(encoding.truncation).toEqual({
      predicatesDropped: 9,
      valuesTruncated: [],
    });
    // Whichever form won, it carries exactly the clamped set — never the
    // over-cap input.
    const emitted =
      encoding.form === "fz"
        ? parseFilterUrlParams({ f: [], fz: encoding.compressed }, repoRegistry)
        : parseFilterUrlParams({ f: encoding.fParams }, repoRegistry);
    expect(emitted).toEqual(encoding.predicates);
  });

  it("clamps values per predicate at write time and reports the dimension", () => {
    const values = Array.from(
      { length: MAX_VALUES_PER_PREDICATE + 17 },
      (_, i) => i + 1
    );
    const encoding = encodeFilterPredicatesForUrl([
      { dimension: "templates", operator: "in", values },
      { dimension: "tags", operator: "any", values: [1, 2] },
    ]);

    expect(encoding.predicates[0]!.values).toEqual(
      values.slice(0, MAX_VALUES_PER_PREDICATE)
    );
    expect(encoding.truncation).toEqual({
      predicatesDropped: 0,
      valuesTruncated: ["templates"],
    });
    // Read and write now agree: re-parsing the emitted URL is a fixed point,
    // instead of silently dropping values on the next read.
    const emitted =
      encoding.form === "fz"
        ? parseFilterUrlParams({ f: [], fz: encoding.compressed }, repoRegistry)
        : parseFilterUrlParams({ f: encoding.fParams }, repoRegistry);
    expect(emitted).toEqual(encoding.predicates);
    expect(
      parseFilterUrlParamsWithReport({ f: encoding.fParams }, repoRegistry)
        .truncation
    ).toEqual({ predicatesDropped: 0, valuesTruncated: [] });
  });

  it("does not mutate the caller's predicates while clamping", () => {
    const values = Array.from(
      { length: MAX_VALUES_PER_PREDICATE + 3 },
      (_, i) => i + 1
    );
    const input: FilterPredicate[] = [
      { dimension: "templates", operator: "in", values },
    ];
    encodeFilterPredicatesForUrl(input);
    expect(input[0]!.values).toHaveLength(MAX_VALUES_PER_PREDICATE + 3);
  });
});

describe("parseFilterUrlParams", () => {
  beforeEach(() => {
    setFilterUrlCompressor(null);
  });

  it("parses f params when fz is absent", () => {
    expect(
      parseFilterUrlParams(
        { f: ["templates:in:1,2", "tags:any"] },
        repoRegistry
      )
    ).toEqual([
      { dimension: "templates", operator: "in", values: [1, 2] },
      { dimension: "tags", operator: "any", values: [] },
    ]);
  });

  it("lets fz win and ignores any f params next to it", () => {
    const fz = encodeCompressedFilterParam([
      { dimension: "tags", operator: "all", values: [9] },
    ])!;
    expect(
      parseFilterUrlParams({ f: ["templates:in:1,2"], fz }, repoRegistry)
    ).toEqual([{ dimension: "tags", operator: "all", values: [9] }]);
  });

  it("drops everything when fz is corrupt — never falls back to f", () => {
    expect(
      parseFilterUrlParams(
        { f: ["templates:in:1,2"], fz: "u!!!" },
        repoRegistry
      )
    ).toEqual([]);
  });

  it("caps the predicate count on the f form too", () => {
    const f = Array.from(
      { length: MAX_FILTER_PREDICATES + 12 },
      (_, i) => `field_7:contains:value${i}`
    );
    const parsed = parseFilterUrlParams({ f }, repoRegistry);
    expect(parsed).toHaveLength(MAX_FILTER_PREDICATES);
    expect(parsed[0]!.values).toEqual(["value0"]);
  });
});

describe("parseFilterUrlParamsWithReport", () => {
  beforeEach(() => {
    setFilterUrlCompressor(null);
  });

  it("reports nothing when the url is within the caps", () => {
    const { predicates, truncation } = parseFilterUrlParamsWithReport(
      { f: ["templates:in:1,2"] },
      repoRegistry
    );
    expect(predicates).toHaveLength(1);
    expect(truncation).toEqual({ predicatesDropped: 0, valuesTruncated: [] });
  });

  it("reports dropped predicates and truncated value lists (f form)", () => {
    const f = [
      ...Array.from(
        { length: MAX_FILTER_PREDICATES + 3 },
        (_, i) => `field_7:contains:value${i}`
      ),
      `templates:in:${Array.from({ length: MAX_VALUES_PER_PREDICATE + 5 }, (_, i) => i + 1).join(",")}`,
    ];
    const { predicates, truncation } = parseFilterUrlParamsWithReport(
      { f },
      repoRegistry
    );

    expect(predicates).toHaveLength(MAX_FILTER_PREDICATES);
    expect(truncation.predicatesDropped).toBe(4);
    expect(truncation.valuesTruncated).toEqual(["templates"]);
  });

  it("reports the same truncation through the compressed form", () => {
    const fz = encodeCompressedFilterParam([
      {
        dimension: "templates",
        operator: "in",
        values: Array.from(
          { length: MAX_VALUES_PER_PREDICATE + 5 },
          (_, i) => i + 1
        ),
      },
      ...bulkyPredicates(MAX_FILTER_PREDICATES + 1),
    ])!;
    const { predicates, truncation } = parseFilterUrlParamsWithReport(
      { f: [], fz },
      repoRegistry
    );

    expect(predicates).toHaveLength(MAX_FILTER_PREDICATES);
    expect(predicates[0]!.values).toHaveLength(MAX_VALUES_PER_PREDICATE);
    expect(truncation.predicatesDropped).toBe(2);
    expect(truncation.valuesTruncated).toEqual(["templates"]);
  });

  it("reports nothing for a corrupt fz", () => {
    expect(
      parseFilterUrlParamsWithReport({ f: [], fz: "u!!!" }, repoRegistry)
    ).toEqual({
      predicates: [],
      truncation: { predicatesDropped: 0, valuesTruncated: [] },
    });
  });
});
