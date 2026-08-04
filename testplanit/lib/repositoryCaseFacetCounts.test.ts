import { describe, expect, it } from "vitest";

import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  buildFacetScopeWhere,
  buildRunRowFilters,
  caseIdSetFragment,
  createFacetWhereComposer,
  partitionFacetPredicates,
  runRowPasses,
  type DimensionWhereFragment,
} from "./repositoryCaseFacetCounts";

const dynamicFieldsRecord = {
  Severity: { fieldId: 1, type: "Dropdown" },
  Notes: { fieldId: 7, type: "Text Long" },
  Spec: { fieldId: 9, type: "Link" },
  Reproduction: { fieldId: 10, type: "Steps" },
};

const runRegistry = buildFilterDimensions({
  dynamicFields: dynamicFieldsRecord,
  includeRunDimensions: true,
});

const NOW = new Date("2026-08-04T00:00:00.000Z");

function predicate(
  dimension: string,
  operator: string,
  values: Array<string | number> = []
): FilterPredicate {
  return { dimension, operator, values };
}

const SCOPE = buildFacetScopeWhere({ projectId: 42 });

describe("buildFacetScopeWhere", () => {
  it("bare scope carries the legacy baseWhere core and no id filter", () => {
    expect(SCOPE).toEqual({
      isDeleted: false,
      isArchived: false,
      projectId: 42,
      folder: { isDeleted: false },
    });
  });

  it("run membership scopes by id (legacy quirk: empty list does not scope)", () => {
    expect(
      buildFacetScopeWhere({ projectId: 42, runCaseIds: [3, 1] }).id
    ).toEqual({ in: [3, 1] });
    expect(
      buildFacetScopeWhere({ projectId: 42, runCaseIds: [] }).id
    ).toBeUndefined();
  });

  it("searchCaseIds alone scope by id; present-but-empty means zero matches", () => {
    expect(
      buildFacetScopeWhere({ projectId: 42, searchCaseIds: [5, 6] }).id
    ).toEqual({ in: [5, 6] });
    expect(
      buildFacetScopeWhere({ projectId: 42, searchCaseIds: [] }).id
    ).toEqual({ in: [] });
  });

  it("search INTERSECTS the run-mode id filter instead of overwriting it", () => {
    expect(
      buildFacetScopeWhere({
        projectId: 42,
        runCaseIds: [1, 2, 3],
        searchCaseIds: [2, 3, 9],
      }).id
    ).toEqual({ in: [2, 3] });
  });
});

describe("partitionFacetPredicates", () => {
  it("routes WHERE-expressible, id-set, and run predicates to their lanes", () => {
    const partition = partitionFacetPredicates(
      [
        predicate("templates", "in", [1, 2]),
        predicate("field_7", "contains", ["foo"]), // text operator → id-set
        predicate("field_9", "domain", ["example.com"]), // link operator → id-set
        predicate("field_10", "gt", [3]), // steps count op → id-set
        predicate("field_10", "any"), // steps existence → WHERE-expressible
        predicate("status", "in", [5, "untested"]),
        predicate("nonexistent", "in", [1]),
      ],
      runRegistry,
      NOW
    );

    expect(partition.whereFragments).toEqual([
      { dimension: "templates", where: { templateId: { in: [1, 2] } } },
      {
        dimension: "field_10",
        where: { steps: { some: { isDeleted: false } } },
      },
    ]);
    expect(partition.idSetPredicates).toEqual([
      {
        dimension: "field_7",
        fieldId: 7,
        filter: {
          fieldId: 7,
          type: "text",
          operator: "contains",
          value1: "foo",
        },
      },
      {
        dimension: "field_9",
        fieldId: 9,
        filter: {
          fieldId: 9,
          type: "link",
          operator: "domain",
          value1: "example.com",
        },
      },
      {
        dimension: "field_10",
        fieldId: 10,
        filter: { fieldId: 10, type: "steps", operator: "gt", value1: 3 },
      },
    ]);
    expect(partition.runPredicates).toEqual([
      predicate("status", "in", [5, "untested"]),
    ]);
  });

  it("text predicate with an empty value contributes nothing (legacy gate)", () => {
    const partition = partitionFacetPredicates(
      [predicate("field_7", "contains", [""])],
      runRegistry,
      NOW
    );
    expect(partition.whereFragments).toEqual([]);
    expect(partition.idSetPredicates).toEqual([]);
  });
});

describe("caseIdSetFragment", () => {
  it("emits the id-in fragment id-set predicates contribute", () => {
    expect(caseIdSetFragment([4, 8])).toEqual({ id: { in: [4, 8] } });
  });
});

describe("createFacetWhereComposer", () => {
  const fragments: DimensionWhereFragment[] = [
    { dimension: "templates", where: { templateId: { in: [1] } } },
    { dimension: "tags", where: { caseTags: { some: { tagId: 7 } } } },
    { dimension: "tags", where: { caseTags: { none: { tagId: 9 } } } },
    { dimension: "field_7", where: caseIdSetFragment([1, 2, 3]) },
  ];
  const composer = createFacetWhereComposer(SCOPE, fragments);

  it("whereAll = scope AND every fragment, in order", () => {
    expect(composer.whereAll).toEqual({
      AND: [SCOPE, ...fragments.map((f) => f.where)],
    });
  });

  it("tracks active dimensions", () => {
    expect([...composer.activeDimensions].sort()).toEqual([
      "field_7",
      "tags",
      "templates",
    ]);
  });

  it("whereExcept(unchipped) IS whereAll — reference equality, no extra query", () => {
    expect(composer.whereExcept("states")).toBe(composer.whereAll);
    expect(composer.whereExcept("status", "assignedTo")).toBe(
      composer.whereAll
    );
    expect(composer.whereExcept()).toBe(composer.whereAll);
  });

  it("whereExcept(chipped) drops ALL of that dimension's fragments and only those", () => {
    expect(composer.whereExcept("tags")).toEqual({
      AND: [SCOPE, { templateId: { in: [1] } }, caseIdSetFragment([1, 2, 3])],
    });
  });

  it("whereExcept supports excluding multiple dimensions at once", () => {
    expect(composer.whereExcept("tags", "field_7", "states")).toEqual({
      AND: [SCOPE, { templateId: { in: [1] } }],
    });
  });

  it("zero fragments → whereAll is just the scope in an AND array", () => {
    const empty = createFacetWhereComposer(SCOPE, []);
    expect(empty.whereAll).toEqual({ AND: [SCOPE] });
    expect(empty.whereExcept("templates")).toBe(empty.whereAll);
  });
});

describe("buildRunRowFilters / runRowPasses", () => {
  const filters = buildRunRowFilters([
    predicate("status", "in", [3, "untested"]),
    predicate("assignedTo", "in", ["u1", "unassigned"]),
  ]);

  const row = (statusId: number | null, assignedToId: string | null) => ({
    repositoryCaseId: 1,
    statusId,
    assignedToId,
  });

  it("status filter matches listed ids and the untested (null) sentinel", () => {
    const passes = filters.get("status")!;
    expect(passes(row(3, null))).toBe(true);
    expect(passes(row(null, null))).toBe(true);
    expect(passes(row(4, null))).toBe(false);
  });

  it("assignedTo filter matches listed users and the unassigned sentinel", () => {
    const passes = filters.get("assignedTo")!;
    expect(passes(row(null, "u1"))).toBe(true);
    expect(passes(row(null, null))).toBe(true);
    expect(passes(row(null, "u2"))).toBe(false);
  });

  it("runRowPasses ANDs both dimensions and honors self-exclusion", () => {
    expect(runRowPasses(filters, row(3, "u1"))).toBe(true);
    expect(runRowPasses(filters, row(3, "u2"))).toBe(false);
    // Self-excluded dimension is skipped: status facet ignores its own chip.
    expect(runRowPasses(filters, row(4, "u1"), "status")).toBe(true);
    expect(runRowPasses(filters, row(4, "u2"), "assignedTo")).toBe(false);
  });

  it("multiple predicates on one dimension AND together", () => {
    const anded = buildRunRowFilters([
      predicate("status", "in", [3, 4]),
      predicate("status", "in", [4, 5]),
    ]);
    const passes = anded.get("status")!;
    expect(passes(row(4, null))).toBe(true);
    expect(passes(row(3, null))).toBe(false);
  });

  it("skips repo-scope predicates and unusable branches", () => {
    const none = buildRunRowFilters([predicate("templates", "in", [1])]);
    expect(none.size).toBe(0);
    expect(runRowPasses(none, row(9, "zz"))).toBe(true);
  });
});
