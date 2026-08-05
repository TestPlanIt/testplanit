import { JsonNull } from "@zenstackhq/orm";
import { describe, expect, it } from "vitest";

import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { buildFilterDimensions } from "./filterDimensions";
import {
  compileRepoPredicates,
  compileRunPredicates,
  extractPostFetchFilters,
} from "./filterWhereCompiler";

/** viewOptions.dynamicFields-shaped fixture (one field per filterable type). */
const dynamicFieldsRecord = {
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

const repoRegistry = buildFilterDimensions({
  dynamicFields: dynamicFieldsRecord,
});
const runRegistry = buildFilterDimensions({
  dynamicFields: dynamicFieldsRecord,
  includeRunDimensions: true,
});

function predicate(
  dimension: string,
  operator: string,
  values: Array<string | number> = []
): FilterPredicate {
  return { dimension, operator, values };
}

function compileOne(p: FilterPredicate) {
  return compileRepoPredicates([p], repoRegistry);
}

describe("compileRepoPredicates — scalar dimensions", () => {
  it("templates in → templateId in-clause", () => {
    expect(compileOne(predicate("templates", "in", [1, 2]))).toEqual([
      { templateId: { in: [1, 2] } },
    ]);
  });

  it("states in → stateId in-clause", () => {
    expect(compileOne(predicate("states", "in", [3]))).toEqual([
      { stateId: { in: [3] } },
    ]);
  });

  it("creators in → creatorId in-clause of strings", () => {
    expect(compileOne(predicate("creators", "in", ["u1", "u2"]))).toEqual([
      { creatorId: { in: ["u1", "u2"] } },
    ]);
  });
});

describe("compileRepoPredicates — boolean dimensions", () => {
  it("automated is [1]/[0]", () => {
    expect(compileOne(predicate("automated", "is", [1]))).toEqual([
      { automated: true },
    ]);
    expect(compileOne(predicate("automated", "is", [0]))).toEqual([
      { automated: false },
    ]);
  });

  it("parameterized is [1]/[0] → hasParameters", () => {
    expect(compileOne(predicate("parameterized", "is", [1]))).toEqual([
      { hasParameters: true },
    ]);
    expect(compileOne(predicate("parameterized", "is", [0]))).toEqual([
      { hasParameters: false },
    ]);
  });

  it("attachments is [1]/[0] → attachmentsWhereClause with isDeleted guard", () => {
    expect(compileOne(predicate("attachments", "is", [1]))).toEqual([
      { attachments: { some: { isDeleted: false } } },
    ]);
    expect(compileOne(predicate("attachments", "is", [0]))).toEqual([
      { attachments: { none: { isDeleted: false } } },
    ]);
  });

  it("skips a boolean predicate whose value is not 0/1", () => {
    expect(compileOne(predicate("automated", "is", [2]))).toEqual([]);
  });
});

describe("compileRepoPredicates — tags", () => {
  it("bare any → has any live tag", () => {
    expect(compileOne(predicate("tags", "any"))).toEqual([
      { caseTags: { some: { tag: { isDeleted: false } } } },
    ]);
  });

  it("any of ids", () => {
    expect(compileOne(predicate("tags", "any", [1, 2]))).toEqual([
      {
        caseTags: {
          some: { tagId: { in: [1, 2] }, tag: { isDeleted: false } },
        },
      },
    ]);
  });

  it("all of ids → AND of per-id some", () => {
    expect(compileOne(predicate("tags", "all", [1, 2]))).toEqual([
      {
        AND: [
          { caseTags: { some: { tagId: 1, tag: { isDeleted: false } } } },
          { caseTags: { some: { tagId: 2, tag: { isDeleted: false } } } },
        ],
      },
    ]);
  });

  it("none of ids", () => {
    expect(compileOne(predicate("tags", "none", [5]))).toEqual([
      { caseTags: { none: { tagId: { in: [5] }, tag: { isDeleted: false } } } },
    ]);
  });

  it("bare none → no live tags", () => {
    expect(compileOne(predicate("tags", "none"))).toEqual([
      { caseTags: { none: { tag: { isDeleted: false } } } },
    ]);
  });

  it("two predicates on the same dimension both compile, in order", () => {
    expect(
      compileRepoPredicates(
        [predicate("tags", "all", [1, 2]), predicate("tags", "none", [5])],
        repoRegistry
      )
    ).toEqual([
      {
        AND: [
          { caseTags: { some: { tagId: 1, tag: { isDeleted: false } } } },
          { caseTags: { some: { tagId: 2, tag: { isDeleted: false } } } },
        ],
      },
      { caseTags: { none: { tagId: { in: [5] }, tag: { isDeleted: false } } } },
    ]);
  });
});

describe("compileRepoPredicates — issues", () => {
  it("bare any / valued any / all / valued none / bare none", () => {
    expect(compileOne(predicate("issues", "any"))).toEqual([
      { caseIssues: { some: { issue: { isDeleted: false } } } },
    ]);
    expect(compileOne(predicate("issues", "any", [7, 8]))).toEqual([
      {
        caseIssues: {
          some: { issueId: { in: [7, 8] }, issue: { isDeleted: false } },
        },
      },
    ]);
    expect(compileOne(predicate("issues", "all", [7, 8]))).toEqual([
      {
        AND: [
          { caseIssues: { some: { issueId: 7, issue: { isDeleted: false } } } },
          { caseIssues: { some: { issueId: 8, issue: { isDeleted: false } } } },
        ],
      },
    ]);
    expect(compileOne(predicate("issues", "none", [9]))).toEqual([
      {
        caseIssues: {
          none: { issueId: { in: [9] }, issue: { isDeleted: false } },
        },
      },
    ]);
    expect(compileOne(predicate("issues", "none"))).toEqual([
      { caseIssues: { none: { issue: { isDeleted: false } } } },
    ]);
  });
});

describe("compileRepoPredicates — Dropdown (field_1)", () => {
  const equalsShape = (value: number) => ({
    caseFieldValues: {
      some: {
        fieldId: 1,
        OR: [
          { value: { equals: String(value) } },
          { value: { equals: value } },
        ],
      },
    },
  });

  it("in → per-value OR of dual string/native equals", () => {
    expect(compileOne(predicate("field_1", "in", [7, 8]))).toEqual([
      { OR: [equalsShape(7), equalsShape(8)] },
    ]);
  });

  it("valued any behaves as in", () => {
    expect(compileOne(predicate("field_1", "any", [7]))).toEqual([
      { OR: [equalsShape(7)] },
    ]);
  });

  it("bare any → value not JSON-null", () => {
    expect(compileOne(predicate("field_1", "any"))).toEqual([
      { caseFieldValues: { some: { fieldId: 1, value: { not: JsonNull } } } },
    ]);
  });

  it("bare none → record missing or JSON-null", () => {
    expect(compileOne(predicate("field_1", "none"))).toEqual([
      {
        OR: [
          { caseFieldValues: { none: { fieldId: 1 } } },
          {
            caseFieldValues: {
              some: { fieldId: 1, value: { equals: JsonNull } },
            },
          },
        ],
      },
    ]);
  });

  it("valued none → NOT of the any-of shape", () => {
    expect(compileOne(predicate("field_1", "none", [7]))).toEqual([
      { NOT: { OR: [equalsShape(7)] } },
    ]);
  });
});

describe("compileRepoPredicates — Multi-Select (field_2)", () => {
  const containsShape = (value: number) => ({
    caseFieldValues: {
      some: { fieldId: 2, value: { array_contains: [value] } },
    },
  });

  it("in → per-value OR of array_contains", () => {
    expect(compileOne(predicate("field_2", "in", [7, 8]))).toEqual([
      { OR: [containsShape(7), containsShape(8)] },
    ]);
  });

  it("bare any / bare none / valued none", () => {
    expect(compileOne(predicate("field_2", "any"))).toEqual([
      { caseFieldValues: { some: { fieldId: 2, value: { not: JsonNull } } } },
    ]);
    expect(compileOne(predicate("field_2", "none"))).toEqual([
      {
        OR: [
          { caseFieldValues: { none: { fieldId: 2 } } },
          {
            caseFieldValues: {
              some: { fieldId: 2, value: { equals: JsonNull } },
            },
          },
        ],
      },
    ]);
    expect(compileOne(predicate("field_2", "none", [7]))).toEqual([
      { NOT: { OR: [containsShape(7)] } },
    ]);
  });
});

describe("compileRepoPredicates — Checkbox (field_3)", () => {
  it("is [1] → equals true; is [0] → equals false", () => {
    expect(compileOne(predicate("field_3", "is", [1]))).toEqual([
      { caseFieldValues: { some: { fieldId: 3, value: { equals: true } } } },
    ]);
    expect(compileOne(predicate("field_3", "is", [0]))).toEqual([
      { caseFieldValues: { some: { fieldId: 3, value: { equals: false } } } },
    ]);
  });
});

describe("compileRepoPredicates — Integer/Number (field_4, field_5)", () => {
  it("eq → dual number/string equals", () => {
    expect(compileOne(predicate("field_4", "eq", [5]))).toEqual([
      {
        caseFieldValues: {
          some: {
            fieldId: 4,
            OR: [{ value: { equals: 5 } }, { value: { equals: "5" } }],
          },
        },
      },
    ]);
  });

  it("ne → missing, JSON-null, or dual not-equals", () => {
    expect(compileOne(predicate("field_4", "ne", [5]))).toEqual([
      {
        OR: [
          { caseFieldValues: { none: { fieldId: 4 } } },
          {
            caseFieldValues: {
              some: { fieldId: 4, value: { equals: JsonNull } },
            },
          },
          {
            caseFieldValues: {
              some: {
                fieldId: 4,
                AND: [
                  { value: { not: { equals: 5 } } },
                  { value: { not: { equals: "5" } } },
                ],
              },
            },
          },
        ],
      },
    ]);
  });

  it.each(["lt", "lte", "gt", "gte"] as const)(
    "%s → dual number/string comparison",
    (operator) => {
      expect(compileOne(predicate("field_4", operator, [5]))).toEqual([
        {
          caseFieldValues: {
            some: {
              fieldId: 4,
              OR: [
                { value: { [operator]: 5 } },
                { value: { [operator]: "5" } },
              ],
            },
          },
        },
      ]);
    }
  );

  it("between → dual number-pair/string-pair range", () => {
    expect(compileOne(predicate("field_4", "between", [2, 8]))).toEqual([
      {
        caseFieldValues: {
          some: {
            fieldId: 4,
            OR: [
              { AND: [{ value: { gte: 2 } }, { value: { lte: 8 } }] },
              { AND: [{ value: { gte: "2" } }, { value: { lte: "8" } }] },
            ],
          },
        },
      },
    ]);
  });

  it("any / none", () => {
    expect(compileOne(predicate("field_4", "any"))).toEqual([
      { caseFieldValues: { some: { fieldId: 4, value: { not: JsonNull } } } },
    ]);
    expect(compileOne(predicate("field_4", "none"))).toEqual([
      {
        OR: [
          { caseFieldValues: { none: { fieldId: 4 } } },
          {
            caseFieldValues: {
              some: { fieldId: 4, value: { equals: JsonNull } },
            },
          },
        ],
      },
    ]);
  });

  it("Number fields use the same builders (decimals keep their string form)", () => {
    expect(compileOne(predicate("field_5", "eq", [2.5]))).toEqual([
      {
        caseFieldValues: {
          some: {
            fieldId: 5,
            OR: [{ value: { equals: 2.5 } }, { value: { equals: "2.5" } }],
          },
        },
      },
    ]);
  });
});

describe("compileRepoPredicates — Date (field_6)", () => {
  // Injected reference time keeps relative operators deterministic.
  const now = new Date("2026-06-15T12:00:00.000Z");

  const dualShape = (operator: "equals" | "lt" | "gt" | "gte", date: Date) => ({
    caseFieldValues: {
      some: {
        fieldId: 6,
        OR: [
          { value: { [operator]: date.toISOString().split("T")[0] } },
          { value: { [operator]: date.toISOString() } },
        ],
      },
    },
  });

  it("on → dual date-string/ISO equals", () => {
    expect(compileOne(predicate("field_6", "on", ["2026-01-15"]))).toEqual([
      dualShape("equals", new Date("2026-01-15")),
    ]);
  });

  it("before → lt; after → gt", () => {
    expect(compileOne(predicate("field_6", "before", ["2026-01-15"]))).toEqual([
      dualShape("lt", new Date("2026-01-15")),
    ]);
    expect(compileOne(predicate("field_6", "after", ["2026-01-15"]))).toEqual([
      dualShape("gt", new Date("2026-01-15")),
    ]);
  });

  it("between → dual date-string-pair/ISO-pair range", () => {
    expect(
      compileOne(predicate("field_6", "between", ["2026-01-01", "2026-03-31"]))
    ).toEqual([
      {
        caseFieldValues: {
          some: {
            fieldId: 6,
            OR: [
              {
                AND: [
                  { value: { gte: "2026-01-01" } },
                  { value: { lte: "2026-03-31" } },
                ],
              },
              {
                AND: [
                  { value: { gte: "2026-01-01T00:00:00.000Z" } },
                  { value: { lte: "2026-03-31T00:00:00.000Z" } },
                ],
              },
            ],
          },
        },
      },
    ]);
  });

  it.each([
    ["last7", "2026-06-08T12:00:00.000Z"],
    ["last30", "2026-05-16T12:00:00.000Z"],
    ["last90", "2026-03-17T12:00:00.000Z"],
  ] as const)("%s → gte dual from injected now", (operator, expectedIso) => {
    expect(
      compileRepoPredicates([predicate("field_6", operator)], repoRegistry, {
        now,
      })
    ).toEqual([dualShape("gte", new Date(expectedIso))]);
  });

  it("thisYear → gte dual from local-timezone start of year (legacy quirk)", () => {
    expect(
      compileRepoPredicates([predicate("field_6", "thisYear")], repoRegistry, {
        now,
      })
    ).toEqual([dualShape("gte", new Date(2026, 0, 1))]);
  });

  it("any → legacy four-guard has-value shape", () => {
    expect(compileOne(predicate("field_6", "any"))).toEqual([
      {
        caseFieldValues: {
          some: {
            fieldId: 6,
            AND: [
              { value: { not: JsonNull } },
              { NOT: { value: { equals: JsonNull } } },
              { NOT: { value: { equals: "" } } },
              { NOT: { value: { equals: null } } },
            ],
          },
        },
      },
    ]);
  });

  it("none → record missing or JSON-null", () => {
    expect(compileOne(predicate("field_6", "none"))).toEqual([
      {
        OR: [
          { caseFieldValues: { none: { fieldId: 6 } } },
          {
            caseFieldValues: {
              some: { fieldId: 6, value: { equals: JsonNull } },
            },
          },
        ],
      },
    ]);
  });
});

describe("compileRepoPredicates — Text (field_7, field_8)", () => {
  it("operator predicates compile to the value-not-null SQL pre-filter only", () => {
    for (const operator of [
      "contains",
      "notContains",
      "startsWith",
      "endsWith",
      "eq",
    ]) {
      expect(compileOne(predicate("field_7", operator, ["foo"]))).toEqual([
        { caseFieldValues: { some: { fieldId: 7, value: { not: JsonNull } } } },
      ]);
    }
  });

  it("empty search value compiles to nothing (legacy gate)", () => {
    expect(compileOne(predicate("field_7", "contains", [""]))).toEqual([]);
  });

  it("any → not-null and not-empty; none → missing, JSON-null, or empty", () => {
    expect(compileOne(predicate("field_8", "any"))).toEqual([
      {
        caseFieldValues: {
          some: {
            fieldId: 8,
            AND: [
              { value: { not: JsonNull } },
              { value: { not: { equals: "" } } },
            ],
          },
        },
      },
    ]);
    expect(compileOne(predicate("field_8", "none"))).toEqual([
      {
        OR: [
          { caseFieldValues: { none: { fieldId: 8 } } },
          {
            caseFieldValues: {
              some: {
                fieldId: 8,
                OR: [
                  { value: { equals: JsonNull } },
                  { value: { equals: "" } },
                ],
              },
            },
          },
        ],
      },
    ]);
  });
});

describe("compileRepoPredicates — Link (field_9)", () => {
  it("operator predicates (incl. domain) compile to the value-not-null pre-filter", () => {
    for (const operator of [
      "contains",
      "domain",
      "startsWith",
      "endsWith",
      "eq",
    ]) {
      expect(
        compileOne(predicate("field_9", operator, ["example.com"]))
      ).toEqual([
        { caseFieldValues: { some: { fieldId: 9, value: { not: JsonNull } } } },
      ]);
    }
  });

  it("any / none use the text has-value/no-value shapes", () => {
    expect(compileOne(predicate("field_9", "any"))).toEqual([
      {
        caseFieldValues: {
          some: {
            fieldId: 9,
            AND: [
              { value: { not: JsonNull } },
              { value: { not: { equals: "" } } },
            ],
          },
        },
      },
    ]);
    expect(compileOne(predicate("field_9", "none"))).toEqual([
      {
        OR: [
          { caseFieldValues: { none: { fieldId: 9 } } },
          {
            caseFieldValues: {
              some: {
                fieldId: 9,
                OR: [
                  { value: { equals: JsonNull } },
                  { value: { equals: "" } },
                ],
              },
            },
          },
        ],
      },
    ]);
  });
});

describe("compileRepoPredicates — Steps (field_10)", () => {
  it("any/none → live-steps relation existence", () => {
    expect(compileOne(predicate("field_10", "any"))).toEqual([
      { steps: { some: { isDeleted: false } } },
    ]);
    expect(compileOne(predicate("field_10", "none"))).toEqual([
      { steps: { none: { isDeleted: false } } },
    ]);
  });

  it("count comparisons emit no SQL fragment (post-fetch only, legacy parity)", () => {
    for (const p of [
      predicate("field_10", "eq", [3]),
      predicate("field_10", "gt", [1]),
      predicate("field_10", "between", [2, 5]),
    ]) {
      expect(compileOne(p)).toEqual([]);
    }
  });
});

describe("compileRepoPredicates — skipping and ordering", () => {
  it("returns [] for no predicates", () => {
    expect(compileRepoPredicates([], repoRegistry)).toEqual([]);
  });

  it("skips unknown dimensions instead of throwing", () => {
    expect(
      compileRepoPredicates(
        [predicate("bogus", "in", [1]), predicate("field_999", "any")],
        repoRegistry
      )
    ).toEqual([]);
  });

  it("skips run-scoped predicates even when the registry knows them", () => {
    expect(
      compileRepoPredicates(
        [predicate("status", "in", [1]), predicate("assignedTo", "in", ["u1"])],
        runRegistry
      )
    ).toEqual([]);
  });

  it("skips operators outside the dimension's whitelist", () => {
    expect(
      compileRepoPredicates(
        [predicate("templates", "all", [1]), predicate("tags", "in", [1])],
        repoRegistry
      )
    ).toEqual([]);
  });

  it("keeps predicate order and drops only the invalid ones", () => {
    expect(
      compileRepoPredicates(
        [
          predicate("templates", "in", [1]),
          predicate("bogus", "in", [2]),
          predicate("automated", "is", [1]),
        ],
        repoRegistry
      )
    ).toEqual([{ templateId: { in: [1] } }, { automated: true }]);
  });
});

describe("compileRunPredicates", () => {
  it("status in ids → single-branch OR", () => {
    expect(
      compileRunPredicates([predicate("status", "in", [1, 2])], runRegistry)
    ).toEqual([{ OR: [{ statusId: { in: [1, 2] } }] }]);
  });

  it("status with untested sentinel → adds the null branch", () => {
    expect(
      compileRunPredicates(
        [predicate("status", "in", [1, "untested"])],
        runRegistry
      )
    ).toEqual([{ OR: [{ statusId: { in: [1] } }, { statusId: null }] }]);
  });

  it("status untested only → null branch only", () => {
    expect(
      compileRunPredicates(
        [predicate("status", "in", ["untested"])],
        runRegistry
      )
    ).toEqual([{ OR: [{ statusId: null }] }]);
  });

  it("assignedTo in users → single-branch OR", () => {
    expect(
      compileRunPredicates([predicate("assignedTo", "in", ["u1"])], runRegistry)
    ).toEqual([{ OR: [{ assignedToId: { in: ["u1"] } }] }]);
  });

  it("assignedTo with unassigned sentinel → adds the null branch", () => {
    expect(
      compileRunPredicates(
        [predicate("assignedTo", "in", ["u1", "unassigned"])],
        runRegistry
      )
    ).toEqual([
      { OR: [{ assignedToId: { in: ["u1"] } }, { assignedToId: null }] },
    ]);
  });

  it("assignedTo unassigned only → null branch only", () => {
    expect(
      compileRunPredicates(
        [predicate("assignedTo", "in", ["unassigned"])],
        runRegistry
      )
    ).toEqual([{ OR: [{ assignedToId: null }] }]);
  });

  it("status + assignedTo simultaneously stay separate AND-able fragments", () => {
    const fragments = compileRunPredicates(
      [
        predicate("status", "in", [1, "untested"]),
        predicate("assignedTo", "in", ["u1"]),
      ],
      runRegistry
    );
    expect(fragments).toEqual([
      { OR: [{ statusId: { in: [1] } }, { statusId: null }] },
      { OR: [{ assignedToId: { in: ["u1"] } }] },
    ]);
    // The OR-key collision guard: spreading the fragments as siblings would
    // silently drop the status constraint — the explicit AND array keeps both.
    const spread = { ...fragments[0], ...fragments[1] };
    expect(spread).toEqual({ OR: [{ assignedToId: { in: ["u1"] } }] });
    expect({ AND: fragments }).toEqual({
      AND: [
        { OR: [{ statusId: { in: [1] } }, { statusId: null }] },
        { OR: [{ assignedToId: { in: ["u1"] } }] },
      ],
    });
  });

  it("skips repo-scoped and unknown predicates instead of throwing", () => {
    expect(
      compileRunPredicates(
        [
          predicate("templates", "in", [1]),
          predicate("tags", "any"),
          predicate("bogus", "in", [1]),
        ],
        runRegistry
      )
    ).toEqual([]);
  });

  it("drops run predicates when the registry has no run dimensions", () => {
    expect(
      compileRunPredicates([predicate("status", "in", [1])], repoRegistry)
    ).toEqual([]);
  });
});

describe("extractPostFetchFilters", () => {
  it("maps text operators, translating eq → equals", () => {
    expect(
      extractPostFetchFilters(
        [
          predicate("field_7", "contains", ["foo"]),
          predicate("field_7", "notContains", ["bar"]),
          predicate("field_8", "eq", ["baz"]),
        ],
        repoRegistry
      )
    ).toEqual([
      { fieldId: 7, type: "text", operator: "contains", value1: "foo" },
      { fieldId: 7, type: "text", operator: "notContains", value1: "bar" },
      { fieldId: 8, type: "text", operator: "equals", value1: "baz" },
    ]);
  });

  it("maps link operators, translating eq → equals", () => {
    expect(
      extractPostFetchFilters(
        [
          predicate("field_9", "domain", ["example.com"]),
          predicate("field_9", "eq", ["https://example.com"]),
        ],
        repoRegistry
      )
    ).toEqual([
      { fieldId: 9, type: "link", operator: "domain", value1: "example.com" },
      {
        fieldId: 9,
        type: "link",
        operator: "equals",
        value1: "https://example.com",
      },
    ]);
  });

  it("maps steps count comparisons with numeric value1/value2", () => {
    expect(
      extractPostFetchFilters(
        [
          predicate("field_10", "eq", [3]),
          predicate("field_10", "between", [2, 5]),
        ],
        repoRegistry
      )
    ).toEqual([
      { fieldId: 10, type: "steps", operator: "eq", value1: 3 },
      { fieldId: 10, type: "steps", operator: "between", value1: 2, value2: 5 },
    ]);
  });

  it("ignores SQL-expressible and non-field predicates", () => {
    expect(
      extractPostFetchFilters(
        [
          predicate("templates", "in", [1]),
          predicate("tags", "any"),
          predicate("field_7", "any"),
          predicate("field_9", "none"),
          predicate("field_10", "none"),
          predicate("field_1", "in", [7]),
        ],
        repoRegistry
      )
    ).toEqual([]);
  });

  it("drops empty text values, malformed steps values, and unknown dimensions", () => {
    expect(
      extractPostFetchFilters(
        [
          predicate("field_7", "contains", [""]),
          predicate("field_10", "between", [2]),
          predicate("bogus", "contains", ["x"]),
        ],
        repoRegistry
      )
    ).toEqual([]);
  });
});
