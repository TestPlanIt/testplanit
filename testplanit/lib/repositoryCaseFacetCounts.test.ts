import { describe, expect, it } from "vitest";

import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  buildFacetScopeWhere,
  buildRunRowFilters,
  caseIdSetFragment,
  computeRepositoryCaseFacetCounts,
  createFacetWhereComposer,
  partitionFacetPredicates,
  runRowPasses,
  type DimensionWhereFragment,
  type FacetCountsDb,
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

// --- Engine-level counting (fake DB) ---------------------------------------

/**
 * A tiny in-memory stand-in for the ORM client. It evaluates the engine's real
 * `where` objects against fixture cases (throwing on any clause shape it does
 * not model, so a silent mis-evaluation cannot pass a test) and records the
 * id-select queries — the property "unchipped dimensions add no queries" is
 * asserted directly against that call log.
 */
interface FakeCase {
  id: number;
  templateId: number;
  stateId: number;
  creatorId: string;
  automated: boolean;
  hasParameters: boolean;
  stepCount: number;
  /** fieldId -> stored JSON value (absent = no row for that field). */
  fields: Record<number, unknown>;
  /**
   * Extra CaseFieldValues rows for fields already in `fields`. Nothing in the
   * schema enforces one row per (testCaseId, fieldId), so the counts have to
   * survive duplicates.
   */
  duplicateFieldRows?: Array<{ fieldId: number; value: unknown }>;
}

interface FakeField {
  id: number;
  displayName: string;
  type: string;
  options?: Array<{ id: number; name: string; order: number }>;
}

const PROJECT_ID = 7;

function matchesScalar(actual: unknown, condition: any): boolean {
  if (condition !== null && typeof condition === "object") {
    if ("in" in condition) return (condition.in as unknown[]).includes(actual);
    if ("not" in condition) return actual !== condition.not;
    throw new Error(
      `fake db: unsupported scalar condition ${JSON.stringify(condition)}`
    );
  }
  return actual === condition;
}

function matchesValueCondition(actual: unknown, condition: any): boolean {
  if (condition === null || typeof condition !== "object") {
    return String(actual) === String(condition);
  }
  if ("equals" in condition) {
    return String(actual) === String(condition.equals);
  }
  if ("not" in condition) {
    return actual !== null && actual !== undefined;
  }
  if ("array_contains" in condition) {
    const wanted = condition.array_contains as unknown[];
    return (
      Array.isArray(actual) &&
      wanted.every((value) => actual.map(String).includes(String(value)))
    );
  }
  throw new Error(
    `fake db: unsupported value condition ${JSON.stringify(condition)}`
  );
}

function matchesFieldRow(
  row: { fieldId: number; value: unknown },
  condition: any
): boolean {
  return Object.entries(condition).every(([key, value]) => {
    if (key === "fieldId") return row.fieldId === value;
    if (key === "value") return matchesValueCondition(row.value, value);
    if (key === "OR")
      return (value as any[]).some((c) => matchesFieldRow(row, c));
    if (key === "AND")
      return (value as any[]).every((c) => matchesFieldRow(row, c));
    if (key === "NOT") return !matchesFieldRow(row, value);
    throw new Error(`fake db: unsupported field-value key ${key}`);
  });
}

function fieldRows(item: FakeCase) {
  return [
    ...Object.entries(item.fields).map(([fieldId, value]) => ({
      fieldId: Number(fieldId),
      value,
    })),
    ...(item.duplicateFieldRows ?? []),
  ];
}

function matchesRelation<T>(
  rows: T[],
  condition: any,
  match: (row: T, inner: any) => boolean
): boolean {
  return Object.entries(condition).every(([key, inner]) => {
    if (key === "some") return rows.some((row) => match(row, inner));
    if (key === "none") return !rows.some((row) => match(row, inner));
    throw new Error(`fake db: unsupported relation key ${key}`);
  });
}

function matchesWhere(item: FakeCase, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case "AND":
        return (value as any[]).every((inner) => matchesWhere(item, inner));
      case "OR":
        return (value as any[]).some((inner) => matchesWhere(item, inner));
      case "NOT":
        return !matchesWhere(item, value);
      case "isDeleted":
      case "isArchived":
        return value === false;
      case "projectId":
        return value === PROJECT_ID;
      case "folder":
        return true;
      case "id":
        return matchesScalar(item.id, value);
      case "templateId":
        return matchesScalar(item.templateId, value);
      case "stateId":
        return matchesScalar(item.stateId, value);
      case "creatorId":
        return matchesScalar(item.creatorId, value);
      case "automated":
        return matchesScalar(item.automated, value);
      case "hasParameters":
        return matchesScalar(item.hasParameters, value);
      case "caseFieldValues":
        return matchesRelation(fieldRows(item), value, matchesFieldRow);
      case "steps":
        return matchesRelation(
          Array.from({ length: item.stepCount }, () => ({})),
          value,
          () => true
        );
      case "caseTags":
      case "caseIssues":
      case "attachments":
        return matchesRelation([], value, () => true);
      default:
        throw new Error(`fake db: unsupported where key ${key}`);
    }
  });
}

interface FakeReview {
  /** Both flags at once: the AppConfig kill switch AND the project toggle. */
  enabled: boolean;
  /** Case ids carrying a PENDING ReviewRequest. */
  pendingCaseIds?: number[];
}

function createFakeDb(
  cases: FakeCase[],
  fields: FakeField[],
  review?: FakeReview
) {
  const idSelectWheres: unknown[] = [];
  const matching = (where: unknown) =>
    cases.filter((item) => matchesWhere(item, where));

  const db = {
    templates: {
      findMany: async (args: any) => {
        if (args?.select?.caseFields) {
          return [
            {
              id: 1,
              templateName: "Default",
              caseFields: fields.map((field) => ({
                caseField: {
                  id: field.id,
                  displayName: field.displayName,
                  type: { type: field.type },
                  fieldOptions: (field.options ?? []).map((option) => ({
                    fieldOption: {
                      id: option.id,
                      name: option.name,
                      order: option.order,
                      icon: null,
                      iconColor: null,
                    },
                  })),
                },
              })),
            },
          ];
        }
        return [{ id: 1, templateName: "Default" }];
      },
    },
    repositoryCases: {
      findMany: async (args: any) => {
        const selectKeys = Object.keys(args?.select ?? { id: true });
        if (selectKeys.length === 1 && selectKeys[0] === "id") {
          idSelectWheres.push(args.where);
        }
        return matching(args?.where).map((item) =>
          Object.fromEntries(selectKeys.map((key) => [key, (item as any)[key]]))
        );
      },
      groupBy: async (args: any) => {
        const field = args.by[0] as keyof FakeCase;
        const counts = new Map<unknown, number>();
        for (const item of matching(args.where)) {
          counts.set(item[field], (counts.get(item[field]) ?? 0) + 1);
        }
        return [...counts].map(([value, count]) => ({
          [field]: value,
          _count: count,
        }));
      },
      count: async (args: any) => matching(args?.where).length,
    },
    caseFieldValues: {
      // Row-wise, duplicates included — the engine is responsible for
      // collapsing them to cases.
      findMany: async (args: any) => {
        const { fieldId, testCaseId } = args.where;
        return cases
          .filter((item) => testCaseId.in.includes(item.id))
          .flatMap((item) =>
            fieldRows(item)
              .filter((row) => row.fieldId === fieldId && row.value != null)
              .map((row) => ({ testCaseId: item.id, value: row.value }))
          );
      },
      count: async (args: any) => {
        const { fieldId, testCaseId, value } = args.where;
        return cases
          .filter((item) => testCaseId.in.includes(item.id))
          .flatMap((item) =>
            fieldRows(item).filter(
              (row) =>
                row.fieldId === fieldId &&
                row.value != null &&
                (value?.equals === undefined || row.value === value.equals)
            )
          ).length;
      },
    },
    workflows: { findMany: async () => [] },
    user: { findMany: async () => [] },
    tags: { findMany: async () => [] },
    issue: { findMany: async () => [] },
    testRunCases: { findMany: async () => [] },
    appConfig: {
      findUnique: async () => (review?.enabled ? { value: true } : null),
    },
    projects: {
      findUnique: async () => ({
        reviewWorkflowEnabled: review?.enabled === true,
      }),
    },
    reviewRequest: {
      findMany: async () =>
        (review?.pendingCaseIds ?? []).map((entityId) => ({ entityId })),
    },
    $queryRaw: async () => [],
  };

  return { db: db as unknown as FacetCountsDb, idSelectWheres };
}

const SEVERITY: FakeField = {
  id: 2,
  displayName: "Severity",
  type: "Dropdown",
  options: [
    { id: 147, name: "High", order: 1 },
    { id: 148, name: "Low", order: 2 },
  ],
};

const PLATFORMS: FakeField = {
  id: 3,
  displayName: "Platforms",
  type: "Multi-Select",
  options: [
    { id: 200, name: "iOS", order: 1 },
    { id: 201, name: "Android", order: 2 },
  ],
};

/** 5 cases: 147 on c1/c2, 148 on c3, no Severity on c4/c5. */
const FIXTURE_CASES: FakeCase[] = [
  {
    id: 1,
    templateId: 10,
    stateId: 20,
    creatorId: "u1",
    automated: false,
    hasParameters: false,
    stepCount: 0,
    fields: { 2: 147, 3: [200, 201] },
  },
  {
    id: 2,
    templateId: 10,
    stateId: 20,
    creatorId: "u1",
    automated: true,
    hasParameters: false,
    stepCount: 0,
    fields: { 2: 147 },
  },
  {
    id: 3,
    templateId: 11,
    stateId: 21,
    creatorId: "u2",
    automated: false,
    hasParameters: false,
    stepCount: 0,
    fields: { 2: 148 },
  },
  {
    id: 4,
    templateId: 11,
    stateId: 21,
    creatorId: "u2",
    automated: false,
    hasParameters: false,
    stepCount: 0,
    fields: {},
  },
  {
    id: 5,
    templateId: 11,
    stateId: 21,
    creatorId: "u2",
    automated: false,
    hasParameters: false,
    stepCount: 0,
    fields: {},
  },
];

describe("computeRepositoryCaseFacetCounts — option fields and dimensionTotals", () => {
  it("emits hasValue/noValue for option fields from the same self-excluded base", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY]);

    // The live repro: group by a Dropdown field, filter to one of its options.
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "field_2", operator: "in", values: [147] }],
    });

    // totalCount is under ALL predicates: only the two 147 cases.
    expect(result.totalCount).toBe(2);

    const severity = result.dynamicFields.Severity;
    // The field self-excludes, so its base is all 5 cases: 3 valued, 2 not.
    expect(severity.counts).toEqual({ hasValue: 3, noValue: 2 });
    expect(severity.options).toEqual([
      expect.objectContaining({ id: 147, count: 2 }),
      expect.objectContaining({ id: 148, count: 1 }),
    ]);

    // The invariant the client renders: All >= every option row, none negative.
    expect(result.dimensionTotals.field_2).toBe(5);
    for (const option of severity.options ?? []) {
      expect(option.count).toBeGreaterThanOrEqual(0);
      expect(result.dimensionTotals.field_2).toBeGreaterThanOrEqual(
        option.count
      );
    }
    expect(severity.counts!.noValue).toBeGreaterThanOrEqual(0);
  });

  it("counts hasValue per CASE, not per selected option, for Multi-Select", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [PLATFORMS]);

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [],
    });

    // c1 alone carries Platforms, with TWO options selected.
    expect(result.dynamicFields.Platforms.counts).toEqual({
      hasValue: 1,
      noValue: 4,
    });
    expect(result.dynamicFields.Platforms.options).toEqual([
      expect.objectContaining({ id: 200, count: 1 }),
      expect.objectContaining({ id: 201, count: 1 }),
    ]);
  });

  it("collapses duplicate CaseFieldValues rows to one case per option", async () => {
    // The live repro: (testCaseId, fieldId) carries no unique constraint, so
    // 56 cases had a second Priority row. A row-wise hasValue then equalled
    // the case total and drove "None" to 0 — while the `none` filter, a
    // case-level `caseFieldValues: { none: ... }` where, still returned the 56
    // cases that genuinely had no row.
    const withDuplicates = FIXTURE_CASES.map((item) =>
      item.id === 1 || item.id === 2
        ? { ...item, duplicateFieldRows: [{ fieldId: 2, value: 147 }] }
        : item
    );
    const { db } = createFakeDb(withDuplicates, [SEVERITY]);

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [],
    });

    const severity = result.dynamicFields.Severity;
    expect(severity.counts).toEqual({ hasValue: 3, noValue: 2 });
    expect(severity.options).toEqual([
      expect.objectContaining({ id: 147, count: 2 }),
      expect.objectContaining({ id: 148, count: 1 }),
    ]);

    // The invariant the whole bug reduces to: the "None" row is what the
    // `none` filter returns.
    const filtered = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "field_2", operator: "none", values: [] }],
    });
    expect(filtered.totalCount).toBe(severity.counts!.noValue);
  });

  it("reports every dimension's self-excluded total", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY]);

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "field_2", operator: "in", values: [147] }],
    });

    expect(result.dimensionTotals).toEqual({
      // Self-excluded: clearing the Severity chip would show all 5 cases.
      field_2: 5,
      // Every other dimension is unchipped, so its base IS whereAll.
      templates: 2,
      states: 2,
      creators: 2,
      automated: 2,
      parameterized: 2,
      attachments: 2,
      tags: 2,
      issues: 2,
    });
  });

  it("self-excludes a chipped scalar dimension too", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY]);

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "templates", operator: "in", values: [10] }],
    });

    expect(result.totalCount).toBe(2);
    // Clearing the templates chip would show all 5; everything else is scoped
    // by it.
    expect(result.dimensionTotals.templates).toBe(5);
    expect(result.dimensionTotals.states).toBe(2);
    expect(result.dimensionTotals.field_2).toBe(2);
    // "All templates" >= each template row (2 + 3 = 5).
    for (const template of result.templates) {
      expect(result.dimensionTotals.templates).toBeGreaterThanOrEqual(
        template.count
      );
    }
  });

  it("adds no id-select query for dimensions without an active predicate", async () => {
    const unfiltered = createFakeDb(FIXTURE_CASES, [SEVERITY, PLATFORMS]);
    await computeRepositoryCaseFacetCounts(unfiltered.db, {
      projectId: PROJECT_ID,
      predicates: [],
    });
    // Every dimension (both dynamic fields included) shares the whereAll base.
    expect(unfiltered.idSelectWheres).toHaveLength(1);

    const chipped = createFakeDb(FIXTURE_CASES, [SEVERITY, PLATFORMS]);
    await computeRepositoryCaseFacetCounts(chipped.db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "field_2", operator: "in", values: [147] }],
    });
    // Only the chipped dimension costs a second base.
    expect(chipped.idSelectWheres).toHaveLength(2);
  });
});

describe("computeRepositoryCaseFacetCounts — inReview", () => {
  it("omits the facet entirely when the review workflow is off", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY]);

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [],
    });

    // Absent, not all-zero: an empty facet would put a dead "In Review" axis
    // in the ViewSelector of every project that does not run reviews.
    expect(result.inReview).toBeUndefined();
    expect(result.dimensionTotals.inReview).toBeUndefined();
  });

  it("splits the base into in-review / not-in-review when it is on", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY], {
      enabled: true,
      pendingCaseIds: [1, 3],
    });

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [],
    });

    expect(result.inReview).toEqual([
      { value: true, count: 2 },
      { value: false, count: 3 },
    ]);
    expect(result.dimensionTotals.inReview).toBe(5);
  });

  it("drops an inReview predicate while the review workflow is off", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY]);

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "inReview", operator: "is", values: [1] }],
    });

    // The dimension is not in the server registry, so the predicate never
    // parses — the counts stay unfiltered rather than collapsing to zero.
    expect(result.totalCount).toBe(5);
  });

  it("filters by the predicate and still self-excludes its own facet", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY], {
      enabled: true,
      pendingCaseIds: [1, 3],
    });

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "inReview", operator: "is", values: [1] }],
    });

    expect(result.totalCount).toBe(2);
    // Other dimensions are scoped by the chip...
    expect(result.dimensionTotals.templates).toBe(2);
    // ...but inReview's own base is what clearing it would show.
    expect(result.dimensionTotals.inReview).toBe(5);
    expect(result.inReview).toEqual([
      { value: true, count: 2 },
      { value: false, count: 3 },
    ]);
  });

  it("counts the complement for is [0]", async () => {
    const { db } = createFakeDb(FIXTURE_CASES, [SEVERITY], {
      enabled: true,
      pendingCaseIds: [1, 3],
    });

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: PROJECT_ID,
      predicates: [{ dimension: "inReview", operator: "is", values: [0] }],
    });

    expect(result.totalCount).toBe(3);
  });
});
