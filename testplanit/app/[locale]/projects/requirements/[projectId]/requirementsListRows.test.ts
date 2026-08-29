import { describe, expect, it } from "vitest";

import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import type { Issue } from "~/zenstack/models";

import {
  buildDescendantIdMap,
  buildRequirementMaps,
  collectCoverageStatusOptions,
  collectRequirementStatusOptions,
  computeVisibleRequirementIds,
  countDescendants,
  flattenRequirementRows,
  matchesRequirementCoverageFilter,
  matchesRequirementSourceFilter,
  matchesRequirementStatusFilter,
  requirementCoverageSortValue,
  requirementSourceSortValue,
  type RequirementListFilters,
  type RequirementListSortConfig,
} from "./requirementsListRows";

// `[]` on every axis -- the baseline every test below starts from and spreads
// over to activate exactly the one or two axes it's proving.
const noFilters: RequirementListFilters = {
  coverage: [],
  status: [],
  source: [],
};

// Local fixture factory -- deliberately not a full ZenStack model object,
// only the fields this module's functions actually read.
function makeRequirement(args: {
  id: number;
  name: string;
  title?: string | null;
  parentId?: number | null;
  integrationId?: number | null;
  requirementDetachedAt?: Date | string | null;
  isRequirement?: boolean;
  externalStatus?: string | null;
  status?: string | null;
  createdAt?: Date | string | null;
  priority?: string | null;
}): Issue {
  return {
    id: args.id,
    name: args.name,
    title: args.title ?? args.name,
    parentId: args.parentId ?? null,
    integrationId: args.integrationId ?? null,
    requirementDetachedAt: args.requirementDetachedAt ?? null,
    // Every row this domain's functions ever see is scoped to
    // REQUIREMENT_SCOPE_WHERE (isRequirement: true) -- defaulting it here
    // (rather than leaving it undefined) is what makes isRequirementLocked
    // (resolveRequirementDisplayStatus's own gate) evaluate correctly for a
    // fixture that sets integrationId, matching every real row this module
    // ever operates on.
    isRequirement: args.isRequirement ?? true,
    externalStatus: args.externalStatus ?? null,
    status: args.status ?? null,
    createdAt: args.createdAt ?? null,
    priority: args.priority ?? null,
  } as Issue;
}

// Established fixture shape for RequirementCoverageBreakdown, shared with
// RequirementsListColumns.test.tsx's identical factory.
function makeBreakdown(
  overrides: Partial<RequirementCoverageBreakdown> = {}
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount: 0,
    crossProjectCaseCount: 0,
    directCaseCount: 0,
    directCrossProjectCaseCount: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    statuses: [],
    untested: 0,
    uncovered: true,
    status: "UNCOVERED",
    ...overrides,
  };
}

// Real RequirementCoverageResponse shape ({ coverage: { "1": {...} } }) so
// the tests exercise coverageFor's real String(id) indexing.
function makeCoverageResponse(
  entries: Record<number, RequirementCoverageBreakdown>
): RequirementCoverageResponse {
  const coverage: Record<string, RequirementCoverageBreakdown> = {};
  Object.entries(entries).forEach(([id, breakdown]) => {
    coverage[id] = breakdown;
  });
  return { projectId: 1, coverage };
}

const nameAsc: RequirementListSortConfig = { column: "name", direction: "asc" };

describe("buildRequirementMaps", () => {
  it("groups roots under the null key and children under their numeric parent id, and marks hasChildrenMap only for ids that are somebody's parentId", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root A", parentId: null }),
      makeRequirement({ id: 2, name: "Child A1", parentId: 1 }),
      makeRequirement({ id: 3, name: "Root B", parentId: null }),
    ];

    const { requirementMap, hasChildrenMap, childrenMap } =
      buildRequirementMaps(requirements);

    expect(
      (childrenMap.get(null) ?? []).map((r) => r.id).sort((a, b) => a - b)
    ).toEqual([1, 3]);
    expect((childrenMap.get(1) ?? []).map((r) => r.id)).toEqual([2]);

    expect(hasChildrenMap.get(1)).toBe(true);
    expect(hasChildrenMap.get(2)).toBe(false);
    expect(hasChildrenMap.get(3)).toBe(false);

    expect(requirementMap.get(1)?.id).toBe(1);
    expect(requirementMap.get(2)?.name).toBe("Child A1");
  });
});

describe("countDescendants", () => {
  it("counts every descendant beneath a node, excluding the node itself", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
      makeRequirement({ id: 2, name: "Child 1", parentId: 1 }),
      makeRequirement({ id: 3, name: "Child 2", parentId: 1 }),
      makeRequirement({ id: 4, name: "Grandchild", parentId: 2 }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    expect(countDescendants(childrenMap, 1)).toBe(3);
    expect(countDescendants(childrenMap, 4)).toBe(0);
  });
});

describe("buildDescendantIdMap", () => {
  it("maps a leaf to just itself", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
      makeRequirement({ id: 2, name: "Leaf", parentId: 1 }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const map = buildDescendantIdMap(childrenMap);

    expect(map.get(2)).toEqual([2]);
  });

  it("maps a parent to itself plus every descendant at every depth, with no duplicates", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
      makeRequirement({ id: 2, name: "Child 1", parentId: 1 }),
      makeRequirement({ id: 3, name: "Child 2", parentId: 1 }),
      makeRequirement({ id: 4, name: "Grandchild", parentId: 2 }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const map = buildDescendantIdMap(childrenMap);

    const rootIds = map.get(1)!;
    expect(rootIds[0]).toBe(1);
    expect(new Set(rootIds)).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(rootIds).size).toBe(rootIds.length);
  });

  it("a parent's array and its child's array overlap exactly on the child's own subtree", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
      makeRequirement({ id: 2, name: "Child", parentId: 1 }),
      makeRequirement({ id: 3, name: "Grandchild", parentId: 2 }),
      makeRequirement({ id: 4, name: "Sibling", parentId: 1 }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const map = buildDescendantIdMap(childrenMap);

    const childIds = new Set(map.get(2)!);
    const rootIds = new Set(map.get(1)!);
    // Every id in the child's own subtree is present in the root's subtree
    // too, and nothing outside the child's subtree (the sibling) leaks in
    // when comparing the two sets on the child's own membership.
    childIds.forEach((id) => expect(rootIds.has(id)).toBe(true));
    expect(childIds.has(4)).toBe(false);
  });

  it("a cycle (parent pointing at its own descendant) terminates and does not blow the stack", () => {
    const nodeA = makeRequirement({ id: 1, name: "A", parentId: null });
    const nodeB = makeRequirement({ id: 2, name: "B", parentId: 1 });

    // Hand-built cyclic fixture, mirroring flattenRequirementRows's own
    // cycle test: node 1's only child is node 2, and node 2's only child is
    // node 1 again.
    const cyclicChildrenMap = new Map<number | null, Issue[]>();
    cyclicChildrenMap.set(null, [nodeA]);
    cyclicChildrenMap.set(1, [nodeB]);
    cyclicChildrenMap.set(2, [nodeA]);

    const start = Date.now();
    const map = buildDescendantIdMap(cyclicChildrenMap);
    expect(Date.now() - start).toBeLessThan(1000);

    expect(map.get(1)![0]).toBe(1);
    expect(map.get(2)![0]).toBe(2);
  });
});

describe("compareRequirements linkedCases/coveringCases sort", () => {
  it("linkedCases sorts by directCaseCount and falls back to the name tie-break when equal", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "B Requirement", parentId: null }),
      makeRequirement({ id: 2, name: "A Requirement", parentId: null }),
      makeRequirement({ id: 3, name: "C Requirement", parentId: null }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ directCaseCount: 5 }),
      2: makeBreakdown({ directCaseCount: 5 }),
      3: makeBreakdown({ directCaseCount: 1 }),
    });

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "linkedCases", direction: "asc" },
      coverage,
    });

    // 3 (count 1) first, then 1/2 tied at count 5 broken by name ("A" < "B").
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("coveringCases sorts by linkedCaseCount", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root 1", parentId: null }),
      makeRequirement({ id: 2, name: "Root 2", parentId: null }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);
    const coverage = makeCoverageResponse({
      1: makeBreakdown({ linkedCaseCount: 2 }),
      2: makeBreakdown({ linkedCaseCount: 9 }),
    });

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "coveringCases", direction: "desc" },
      coverage,
    });

    expect(rows.map((r) => r.id)).toEqual([2, 1]);
  });
});

// Gap closure 26.2-17: only `createdAt` -- `Issue` has no `updatedAt` column,
// and adding one is the schema change this gap-closure plan explicitly ruled
// out (see 26.2-17-SUMMARY.md).
describe("compareRequirements createdAt sort", () => {
  it("sorts a sibling group by createdAt asc without interleaving children across parents", () => {
    const requirements = [
      makeRequirement({
        id: 1,
        name: "Apple Root",
        parentId: null,
        createdAt: new Date("2026-01-01"),
      }),
      makeRequirement({
        id: 2,
        name: "Apple Child Newer",
        parentId: 1,
        createdAt: new Date("2026-03-01"),
      }),
      makeRequirement({
        id: 3,
        name: "Apple Child Older",
        parentId: 1,
        createdAt: new Date("2026-02-01"),
      }),
      makeRequirement({
        id: 4,
        name: "Zebra Root",
        parentId: null,
        createdAt: new Date("2026-01-15"),
      }),
      makeRequirement({
        id: 5,
        name: "Zebra Child",
        parentId: 4,
        createdAt: new Date("2026-01-20"),
      }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: { 1: true, 4: true },
      sortConfig: { column: "createdAt", direction: "asc" },
      coverage: undefined,
    });

    // Root order by createdAt asc: 1 (Jan 1) before 4 (Jan 15); within 1's own
    // sibling group, 3 (Feb 1) before 2 (Mar 1) -- and neither ever
    // interleaves with 4/5, proving the sort stays per-sibling-group.
    expect(rows.map((r) => r.id)).toEqual([1, 3, 2, 4, 5]);
  });

  it("a null createdAt sorts last in asc and first in desc (one rule, both directions)", () => {
    const requirements = [
      makeRequirement({
        id: 1,
        name: "Has Date",
        parentId: null,
        createdAt: new Date("2026-01-01"),
      }),
      makeRequirement({
        id: 2,
        name: "No Date",
        parentId: null,
        createdAt: null,
      }),
      makeRequirement({
        id: 3,
        name: "Has Later Date",
        parentId: null,
        createdAt: new Date("2026-02-01"),
      }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const asc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "createdAt", direction: "asc" },
      coverage: undefined,
    });
    expect(asc.map((r) => r.id)).toEqual([1, 3, 2]);

    const desc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "createdAt", direction: "desc" },
      coverage: undefined,
    });
    expect(desc.map((r) => r.id)).toEqual([2, 3, 1]);
  });
});

// D-17: promoted carry-over from 26.2-17. `Issue.priority` is a free-form
// `String?` -- no rank table, so these tests freeze the actual
// `localeCompare` ordering the implementation produces rather than assuming
// a specific "critical/high/medium/low" order.
describe("compareRequirements priority sort", () => {
  it("sorts siblings by priority using localeCompare ascending, and reverses under desc", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "A Requirement", priority: "high" }),
      makeRequirement({ id: 2, name: "B Requirement", priority: "low" }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const asc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "priority", direction: "asc" },
      coverage: undefined,
    });
    // "high".localeCompare("low") < 0, so high sorts before low ascending.
    expect(asc.map((r) => r.id)).toEqual([1, 2]);

    const desc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "priority", direction: "desc" },
      coverage: undefined,
    });
    expect(desc.map((r) => r.id)).toEqual([2, 1]);
  });

  it("a null priority sorts against '' -- freezing the actual localeCompare ordering, not a sentinel", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Has Priority", priority: "high" }),
      makeRequirement({ id: 2, name: "No Priority", priority: null }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    // "".localeCompare("high") < 0, so the null-priority row sorts BEFORE
    // "high" ascending -- not a sentinel-driven "nulls last" rule.
    const asc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "priority", direction: "asc" },
      coverage: undefined,
    });
    expect(asc.map((r) => r.id)).toEqual([2, 1]);

    const desc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "priority", direction: "desc" },
      coverage: undefined,
    });
    expect(desc.map((r) => r.id)).toEqual([1, 2]);
  });

  it("sorts a sibling group by priority without interleaving children across parents", () => {
    const requirements = [
      makeRequirement({
        id: 1,
        name: "Apple Root",
        parentId: null,
        priority: "medium",
      }),
      makeRequirement({
        id: 2,
        name: "Apple Child Low",
        parentId: 1,
        priority: "low",
      }),
      makeRequirement({
        id: 3,
        name: "Apple Child High",
        parentId: 1,
        priority: "high",
      }),
      makeRequirement({
        id: 4,
        name: "Zebra Root",
        parentId: null,
        priority: "low",
      }),
      makeRequirement({
        id: 5,
        name: "Zebra Child",
        parentId: 4,
        priority: "medium",
      }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: { 1: true, 4: true },
      sortConfig: { column: "priority", direction: "asc" },
      coverage: undefined,
    });

    // Root order by priority asc: "low" (4) before "medium" (1); within 1's
    // own sibling group, "high" (3) before "low" (2) -- and neither ever
    // interleaves with 4/5, proving the sort stays per-sibling-group.
    expect(rows.map((r) => r.id)).toEqual([4, 5, 1, 3, 2]);
  });

  it("equal priorities fall through to the name-then-id tie-break, ascending even when direction is desc", () => {
    const requirements = [
      makeRequirement({ id: 2, name: "B Requirement", priority: "medium" }),
      makeRequirement({ id: 1, name: "A Requirement", priority: "medium" }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const desc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "priority", direction: "desc" },
      coverage: undefined,
    });

    // Tied priorities never get reversed by `direction: "desc"` -- name
    // tie-break stays ascending ("A" before "B").
    expect(desc.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("compareRequirements status sort", () => {
  it("orders a detached row by its own status against a locked row by its tracker status", () => {
    const requirements = [
      // Locked: resolves to externalStatus ("In Review").
      makeRequirement({
        id: 1,
        name: "Locked Requirement",
        integrationId: 9,
        requirementDetachedAt: null,
        status: "Blocked",
        externalStatus: "In Review",
      }),
      // Detached: resolves to its own edited status ("Done"), NOT the
      // stale "In Review" still stored in externalStatus.
      makeRequirement({
        id: 2,
        name: "Detached Requirement",
        integrationId: 9,
        requirementDetachedAt: new Date(),
        status: "Done",
        externalStatus: "In Review",
      }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    // "Done".localeCompare("In Review") < 0, so the detached row sorts
    // first ascending -- this only holds if the comparator resolved each
    // row's OWN displayed value rather than reading both through the same
    // raw fallback (which would tie both rows at "In Review").
    const asc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "status", direction: "asc" },
      coverage: undefined,
    });
    expect(asc.map((r) => r.id)).toEqual([2, 1]);

    const desc = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: { column: "status", direction: "desc" },
      coverage: undefined,
    });
    expect(desc.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("computeVisibleRequirementIds", () => {
  it("returns null when the filter box is empty and no filter axis is active", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
    ];
    const { requirementMap, childrenMap } = buildRequirementMaps(requirements);

    const result = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "",
      filters: noFilters,
      coverage: undefined,
      coverageError: false,
    });

    expect(result).toBeNull();
  });

  it("the coverage=UNCOVERED filter keeps every ancestor of 8 uncovered leaves visible, but excludes a covered sibling", () => {
    const requirements: Issue[] = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeRequirement({
          id: 2 + i,
          name: `Uncovered Leaf ${i}`,
          parentId: 1,
        })
      ),
      makeRequirement({ id: 10, name: "Covered Sibling", parentId: 1 }),
    ];
    const { requirementMap, childrenMap } = buildRequirementMaps(requirements);

    const coverageEntries: Record<number, RequirementCoverageBreakdown> = {
      1: makeBreakdown({
        status: "PASSED",
        uncovered: false,
        passed: 20,
        linkedCaseCount: 20,
      }),
      10: makeBreakdown({
        status: "PASSED",
        uncovered: false,
        passed: 3,
        linkedCaseCount: 3,
      }),
    };
    for (let i = 0; i < 8; i++) {
      coverageEntries[2 + i] = makeBreakdown({
        status: "UNCOVERED",
        uncovered: true,
      });
    }

    const visible = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "",
      filters: { ...noFilters, coverage: ["UNCOVERED"] },
      coverage: makeCoverageResponse(coverageEntries),
      coverageError: false,
    });

    expect(visible).not.toBeNull();
    for (let i = 0; i < 8; i++) {
      expect(visible!.has(2 + i)).toBe(true);
    }
    expect(visible!.has(1)).toBe(true);
    expect(visible!.has(10)).toBe(false);
  });

  it("the coverage=UNCOVERED filter keeps ancestors visible transitively, 4 levels deep", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Level 1", parentId: null }),
      makeRequirement({ id: 2, name: "Level 2", parentId: 1 }),
      makeRequirement({ id: 3, name: "Level 3", parentId: 2 }),
      makeRequirement({ id: 4, name: "Level 4 Leaf", parentId: 3 }),
    ];
    const { requirementMap, childrenMap } = buildRequirementMaps(requirements);

    const coverage = makeCoverageResponse({
      4: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
    });

    const visible = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "",
      filters: { ...noFilters, coverage: ["UNCOVERED"] },
      coverage,
      coverageError: false,
    });

    expect(visible).toEqual(new Set([1, 2, 3, 4]));
  });

  it("intersects the text filter and the coverage=UNCOVERED filter rather than unioning them", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
      makeRequirement({ id: 2, name: "Login Covered", parentId: 1 }),
      makeRequirement({ id: 3, name: "Login Uncovered", parentId: 1 }),
    ];
    const { requirementMap, childrenMap } = buildRequirementMaps(requirements);

    const coverage = makeCoverageResponse({
      2: makeBreakdown({
        status: "PASSED",
        uncovered: false,
        passed: 4,
        linkedCaseCount: 4,
      }),
      3: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
    });

    const visible = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "login",
      filters: { ...noFilters, coverage: ["UNCOVERED"] },
      coverage,
      coverageError: false,
    });

    expect(visible!.has(3)).toBe(true);
    expect(visible!.has(2)).toBe(false);
  });

  it("expands a text match's descendants when no other filter axis is active, but not when the coverage axis is on", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Login Root", parentId: null }),
      makeRequirement({ id: 2, name: "Covered Child", parentId: 1 }),
    ];
    const { requirementMap, childrenMap } = buildRequirementMaps(requirements);

    const coverage = makeCoverageResponse({
      1: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
      2: makeBreakdown({
        status: "PASSED",
        uncovered: false,
        passed: 1,
        linkedCaseCount: 1,
      }),
    });

    const withoutCoverageAxis = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "login",
      filters: noFilters,
      coverage,
      coverageError: false,
    });
    expect(withoutCoverageAxis!.has(2)).toBe(true);

    const withCoverageAxis = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "login",
      filters: { ...noFilters, coverage: ["UNCOVERED"] },
      coverage,
      coverageError: false,
    });
    expect(withCoverageAxis!.has(2)).toBe(false);
  });

  describe("ancestor retention per axis (SC-4 generalized -- gap closure 26.2-12)", () => {
    it("text filter alone keeps ancestors of a match visible", () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", parentId: null }),
        makeRequirement({ id: 2, name: "Mid", parentId: 1 }),
        makeRequirement({ id: 3, name: "Login Leaf", parentId: 2 }),
        makeRequirement({ id: 4, name: "Unrelated Leaf", parentId: 2 }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "login",
        filters: noFilters,
        coverage: undefined,
        coverageError: false,
      });

      expect(visible).toEqual(new Set([1, 2, 3]));
    });

    it("coverage filter alone keeps ancestors of a match visible", () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", parentId: null }),
        makeRequirement({ id: 2, name: "Mid", parentId: 1 }),
        makeRequirement({ id: 3, name: "Uncovered Leaf", parentId: 2 }),
        makeRequirement({ id: 4, name: "Covered Sibling", parentId: 2 }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);
      // Ancestors 1 and 2 are given EXPLICIT covered breakdowns -- an absent
      // breakdown matches "UNCOVERED" directly under this predicate's own
      // comparator-mirroring rule, which would make this test pass even
      // without the ancestor walk. Marking them covered forces them to be
      // visible ONLY via ancestor retention, an isolated proof.
      const coverage = makeCoverageResponse({
        1: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 5,
          linkedCaseCount: 5,
        }),
        2: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 5,
          linkedCaseCount: 5,
        }),
        3: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
        4: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 2,
          linkedCaseCount: 2,
        }),
      });

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { ...noFilters, coverage: ["UNCOVERED"] },
        coverage,
        coverageError: false,
      });

      expect(visible).toEqual(new Set([1, 2, 3]));
    });

    it("status filter alone keeps ancestors of a match visible", () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", parentId: null }),
        makeRequirement({ id: 2, name: "Mid", parentId: 1 }),
        makeRequirement({
          id: 3,
          name: "Open Leaf",
          parentId: 2,
          externalStatus: "Open",
        }),
        makeRequirement({
          id: 4,
          name: "Closed Sibling",
          parentId: 2,
          externalStatus: "Closed",
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { ...noFilters, status: ["Open"] },
        coverage: undefined,
        coverageError: false,
      });

      expect(visible).toEqual(new Set([1, 2, 3]));
    });

    it("source filter alone keeps ancestors of a match visible", () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", parentId: null }),
        makeRequirement({ id: 2, name: "Mid", parentId: 1 }),
        makeRequirement({
          id: 3,
          name: "Detached Leaf",
          parentId: 2,
          integrationId: 5,
          requirementDetachedAt: new Date(),
        }),
        makeRequirement({
          id: 4,
          name: "Synced Sibling",
          parentId: 2,
          integrationId: 5,
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { ...noFilters, source: ["DETACHED"] },
        coverage: undefined,
        coverageError: false,
      });

      expect(visible).toEqual(new Set([1, 2, 3]));
    });
  });

  describe("two active filters intersect, never union", () => {
    it("a requirement matching only one of two active filters is absent, and its ancestor is present only because another descendant matches both", () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", parentId: null }),
        makeRequirement({
          id: 2,
          name: "Uncovered Manual",
          parentId: 1,
          integrationId: null,
        }),
        makeRequirement({
          id: 3,
          name: "Uncovered Synced",
          parentId: 1,
          integrationId: 5,
        }),
        makeRequirement({
          id: 4,
          name: "Covered Manual",
          parentId: 1,
          integrationId: null,
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);
      const coverage = makeCoverageResponse({
        2: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
        3: makeBreakdown({ status: "UNCOVERED", uncovered: true }),
        4: makeBreakdown({
          status: "PASSED",
          uncovered: false,
          passed: 1,
          linkedCaseCount: 1,
        }),
      });

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { coverage: ["UNCOVERED"], status: [], source: ["MANUAL"] },
        coverage,
        coverageError: false,
      });

      // Only id 2 matches BOTH coverage=UNCOVERED and source=MANUAL.
      expect(visible!.has(2)).toBe(true);
      // id 3 matches coverage only (it's synced, not manual).
      expect(visible!.has(3)).toBe(false);
      // id 4 matches source only (it's covered, not uncovered).
      expect(visible!.has(4)).toBe(false);
      // Root is retained as id 2's ancestor.
      expect(visible!.has(1)).toBe(true);
    });
  });

  describe("descendant BFS runs only when no non-text axis is active", () => {
    it("does not run when the status filter is active, even though the same match would expand under text search alone", () => {
      const requirements = [
        makeRequirement({
          id: 1,
          name: "Root",
          parentId: null,
          externalStatus: "Open",
        }),
        makeRequirement({
          id: 2,
          name: "Child",
          parentId: 1,
          externalStatus: "Closed",
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { coverage: [], status: ["Open"], source: [] },
        coverage: undefined,
        coverageError: false,
      });

      expect(visible!.has(1)).toBe(true);
      expect(visible!.has(2)).toBe(false);
    });

    it("does not run when the source filter is active", () => {
      const requirements = [
        makeRequirement({
          id: 1,
          name: "Root",
          parentId: null,
          integrationId: null,
        }),
        makeRequirement({
          id: 2,
          name: "Child",
          parentId: 1,
          integrationId: 5,
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { coverage: [], status: [], source: ["MANUAL"] },
        coverage: undefined,
        coverageError: false,
      });

      expect(visible!.has(1)).toBe(true);
      expect(visible!.has(2)).toBe(false);
    });
  });

  // Every axis is multi-select. The rule these two prove is the asymmetry
  // the whole filter bar rests on: values WITHIN one axis union, axes
  // INTERSECT with each other. Getting either half backwards is silent --
  // a union across axes looks like "the filter widened", an intersection
  // within one axis matches nothing at all.
  describe("multi-select axes: union within, intersection across", () => {
    it("two selected statuses admit rows matching EITHER, not only rows matching both (which no row could)", () => {
      const requirements = [
        makeRequirement({ id: 1, name: "Root", externalStatus: "Open" }),
        makeRequirement({
          id: 2,
          name: "Blocked One",
          parentId: 1,
          externalStatus: "Blocked",
        }),
        makeRequirement({
          id: 3,
          name: "Closed One",
          parentId: 1,
          externalStatus: "Closed",
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { coverage: [], status: ["Open", "Blocked"], source: [] },
        coverage: undefined,
        coverageError: false,
      });

      expect(visible!.has(1)).toBe(true);
      expect(visible!.has(2)).toBe(true);
      expect(visible!.has(3)).toBe(false);
    });

    it("a multi-valued status axis still INTERSECTS with a multi-valued source axis", () => {
      const requirements = [
        // Open + native: matches both axes.
        makeRequirement({
          id: 1,
          name: "Open Native",
          externalStatus: "Open",
          integrationId: null,
        }),
        // Blocked + synced: matches status, fails source.
        makeRequirement({
          id: 2,
          name: "Blocked Synced",
          externalStatus: "Blocked",
          integrationId: 5,
        }),
        // Closed + detached: matches source, fails status.
        makeRequirement({
          id: 3,
          name: "Closed Detached",
          externalStatus: "Closed",
          integrationId: 5,
          requirementDetachedAt: new Date(),
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: {
          coverage: [],
          status: ["Open", "Blocked"],
          source: ["MANUAL", "DETACHED"],
        },
        coverage: undefined,
        coverageError: false,
      });

      expect(visible!.has(1)).toBe(true);
      expect(visible!.has(2)).toBe(false);
      expect(visible!.has(3)).toBe(false);
    });
  });

  describe("coverage axis degrades gracefully when data is unavailable", () => {
    it("a missing coverage response makes the coverage filter inert while the status axis keeps working", () => {
      const requirements = [
        makeRequirement({
          id: 1,
          name: "Root",
          parentId: null,
          externalStatus: "Open",
        }),
        makeRequirement({
          id: 2,
          name: "Child Open",
          parentId: 1,
          externalStatus: "Open",
        }),
        makeRequirement({
          id: 3,
          name: "Child Closed",
          parentId: 1,
          externalStatus: "Closed",
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { coverage: ["UNCOVERED"], status: ["Open"], source: [] },
        coverage: undefined,
        coverageError: false,
      });

      // Coverage axis contributes nothing (inert); status alone determines
      // matches -- both "Open" rows show, not just a subset.
      expect(visible).toEqual(new Set([1, 2]));
    });

    it("a coverage error also makes the coverage filter inert", () => {
      const requirements = [
        makeRequirement({
          id: 1,
          name: "Root",
          parentId: null,
          externalStatus: "Open",
        }),
      ];
      const { requirementMap, childrenMap } =
        buildRequirementMaps(requirements);
      const coverage = makeCoverageResponse({
        1: makeBreakdown({ status: "PASSED", uncovered: false }),
      });

      const visible = computeVisibleRequirementIds({
        requirements,
        requirementMap,
        childrenMap,
        normalizedFilter: "",
        filters: { coverage: ["UNCOVERED"], status: ["Open"], source: [] },
        coverage,
        coverageError: true,
      });

      expect(visible).toEqual(new Set([1]));
    });
  });
});

describe("matchesRequirementCoverageFilter", () => {
  it("the empty filter matches everything, including an absent breakdown", () => {
    expect(matchesRequirementCoverageFilter("", undefined)).toBe(true);
    expect(matchesRequirementCoverageFilter("", makeBreakdown())).toBe(true);
  });

  it("an absent breakdown matches only UNCOVERED, mirroring the comparator", () => {
    expect(matchesRequirementCoverageFilter("UNCOVERED", undefined)).toBe(true);
    expect(matchesRequirementCoverageFilter("UNTESTED", undefined)).toBe(false);
    expect(matchesRequirementCoverageFilter("status:1", undefined)).toBe(false);
  });

  it("UNTESTED matches only when untested > 0", () => {
    expect(
      matchesRequirementCoverageFilter(
        "UNTESTED",
        makeBreakdown({ untested: 0 })
      )
    ).toBe(false);
    expect(
      matchesRequirementCoverageFilter(
        "UNTESTED",
        makeBreakdown({ untested: 2 })
      )
    ).toBe(true);
  });

  it("status:<id> matches only a non-zero count for that status id", () => {
    const breakdown = makeBreakdown({
      statuses: [{ statusId: 5, name: "Passed", color: null, count: 3 }],
    });
    expect(matchesRequirementCoverageFilter("status:5", breakdown)).toBe(true);
    expect(matchesRequirementCoverageFilter("status:6", breakdown)).toBe(false);
  });
});

describe("matchesRequirementSourceFilter", () => {
  it("matches MANUAL, DETACHED, and SYNCED against requirementSourceSortValue's own ranking", () => {
    const manual = makeRequirement({ id: 1, name: "M", integrationId: null });
    const detached = makeRequirement({
      id: 2,
      name: "D",
      integrationId: 5,
      requirementDetachedAt: new Date(),
    });
    const synced = makeRequirement({ id: 3, name: "S", integrationId: 5 });

    expect(matchesRequirementSourceFilter("MANUAL", manual)).toBe(true);
    expect(matchesRequirementSourceFilter("MANUAL", detached)).toBe(false);
    expect(matchesRequirementSourceFilter("DETACHED", detached)).toBe(true);
    expect(matchesRequirementSourceFilter("SYNCED", synced)).toBe(true);
    expect(matchesRequirementSourceFilter("SYNCED", manual)).toBe(false);
  });
});

describe("matchesRequirementStatusFilter", () => {
  it("matches a detached row on its own locally edited status, not its stale tracker status", () => {
    const detached = makeRequirement({
      id: 1,
      name: "D",
      integrationId: 9,
      requirementDetachedAt: new Date(),
      status: "Done",
      externalStatus: "In Review",
    });

    expect(matchesRequirementStatusFilter("Done", detached)).toBe(true);
    expect(matchesRequirementStatusFilter("In Review", detached)).toBe(false);
  });

  it("matches a locked row on its tracker status", () => {
    const locked = makeRequirement({
      id: 2,
      name: "L",
      integrationId: 9,
      requirementDetachedAt: null,
      status: "Done",
      externalStatus: "In Review",
    });

    expect(matchesRequirementStatusFilter("In Review", locked)).toBe(true);
    expect(matchesRequirementStatusFilter("Done", locked)).toBe(false);
  });
});

describe("collectCoverageStatusOptions", () => {
  it("unions statuses across requirements, summing counts per statusId, ordered by count descending", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "A" }),
      makeRequirement({ id: 2, name: "B" }),
    ];
    const coverage = makeCoverageResponse({
      1: makeBreakdown({
        statuses: [
          { statusId: 10, name: "Passed", color: "#0f0", count: 2 },
          { statusId: 20, name: "Failed", color: "#f00", count: 1 },
        ],
      }),
      2: makeBreakdown({
        statuses: [{ statusId: 10, name: "Passed", color: "#0f0", count: 5 }],
      }),
    });

    const options = collectCoverageStatusOptions(requirements, coverage);

    expect(options).toEqual([
      { statusId: 10, name: "Passed", color: "#0f0", count: 7 },
      { statusId: 20, name: "Failed", color: "#f00", count: 1 },
    ]);
  });

  it("never includes a status entry with a zero count", () => {
    const requirements = [makeRequirement({ id: 1, name: "A" })];
    const coverage = makeCoverageResponse({
      1: makeBreakdown({
        statuses: [{ statusId: 10, name: "Passed", color: "#0f0", count: 0 }],
      }),
    });

    expect(collectCoverageStatusOptions(requirements, coverage)).toEqual([]);
  });

  it("returns an empty array when coverage hasn't loaded", () => {
    const requirements = [makeRequirement({ id: 1, name: "A" })];
    expect(collectCoverageStatusOptions(requirements, undefined)).toEqual([]);
  });
});

describe("collectRequirementStatusOptions", () => {
  it("de-duplicates case-insensitively, preserves first-seen casing, and sorts case-insensitively", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "A", externalStatus: "open" }),
      makeRequirement({ id: 2, name: "B", externalStatus: "Open" }),
      makeRequirement({ id: 3, name: "C", externalStatus: "Closed" }),
      makeRequirement({ id: 4, name: "D", status: "In Progress" }),
      makeRequirement({ id: 5, name: "E", externalStatus: "" }),
      makeRequirement({ id: 6, name: "F" }),
    ];

    expect(collectRequirementStatusOptions(requirements)).toEqual([
      "Closed",
      "In Progress",
      "open",
    ]);
  });

  it("offers the locally edited status for a detached row and the tracker status for a locked one", () => {
    const detached = makeRequirement({
      id: 1,
      name: "D",
      integrationId: 9,
      requirementDetachedAt: new Date(),
      status: "Done",
      externalStatus: "In Review",
    });
    const locked = makeRequirement({
      id: 2,
      name: "L",
      integrationId: 5,
      requirementDetachedAt: null,
      status: "Blocked",
      externalStatus: "In Review",
    });

    const options = collectRequirementStatusOptions([detached, locked]);

    expect(options.filter((o) => o === "Done")).toHaveLength(1);
    expect(options.filter((o) => o === "In Review")).toHaveLength(1);
    expect(options).not.toContain("Blocked");
  });
});

describe("requirementCoverageSortValue", () => {
  it("ranks undefined as -1, below every real status", () => {
    expect(requirementCoverageSortValue(undefined)).toBe(-1);
  });

  it("ranks UNCOVERED < FAILED < NOT_RUN < PASSED", () => {
    const uncovered = requirementCoverageSortValue(
      makeBreakdown({ status: "UNCOVERED", uncovered: true })
    );
    const failed = requirementCoverageSortValue(
      makeBreakdown({ status: "FAILED", uncovered: false })
    );
    const notRun = requirementCoverageSortValue(
      makeBreakdown({ status: "NOT_RUN", uncovered: false })
    );
    const passed = requirementCoverageSortValue(
      makeBreakdown({ status: "PASSED", uncovered: false })
    );

    expect(uncovered).toBeLessThan(failed);
    expect(failed).toBeLessThan(notRun);
    expect(notRun).toBeLessThan(passed);
  });

  it("ranks two PASSED breakdowns by their passed count", () => {
    const fewer = requirementCoverageSortValue(
      makeBreakdown({ status: "PASSED", uncovered: false, passed: 2 })
    );
    const more = requirementCoverageSortValue(
      makeBreakdown({ status: "PASSED", uncovered: false, passed: 9 })
    );

    expect(fewer).toBeLessThan(more);
  });
});

describe("requirementSourceSortValue", () => {
  it("ranks Native 0, Detached 1, Synced 2", () => {
    const native = makeRequirement({
      id: 1,
      name: "Native",
      integrationId: null,
    });
    const detached = makeRequirement({
      id: 2,
      name: "Detached",
      integrationId: 5,
      requirementDetachedAt: new Date(),
    });
    const synced = makeRequirement({
      id: 3,
      name: "Synced",
      integrationId: 5,
      requirementDetachedAt: null,
    });

    expect(requirementSourceSortValue(native)).toBe(0);
    expect(requirementSourceSortValue(detached)).toBe(1);
    expect(requirementSourceSortValue(synced)).toBe(2);
  });
});

describe("flattenRequirementRows", () => {
  it("a collapsed parent hides its whole subtree from the flattened hierarchy, and expanding restores it at depth+1", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Parent", parentId: null }),
      makeRequirement({ id: 2, name: "B Child", parentId: 1 }),
      makeRequirement({ id: 3, name: "A Child", parentId: 1 }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const collapsed = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: {},
      sortConfig: nameAsc,
      coverage: undefined,
    });
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe(1);
    expect(collapsed[0].hasChildren).toBe(true);

    const expanded = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: { 1: true },
      sortConfig: nameAsc,
      coverage: undefined,
    });
    expect(expanded.map((r) => r.id)).toEqual([1, 3, 2]);
    expect(expanded[0].depth).toBe(0);
    expect(expanded[1].depth).toBe(1);
    expect(expanded[2].depth).toBe(1);
  });

  it("sorting a root level desc still keeps each subtree's hierarchy adjacent, no interleaving between subtrees", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Apple Root", parentId: null }),
      makeRequirement({ id: 2, name: "Apple Child", parentId: 1 }),
      makeRequirement({ id: 3, name: "Zebra Root", parentId: null }),
      makeRequirement({ id: 4, name: "Zebra Child", parentId: 3 }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);
    const nameDesc: RequirementListSortConfig = {
      column: "name",
      direction: "desc",
    };

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: { 1: true, 3: true },
      sortConfig: nameDesc,
      coverage: undefined,
    });

    expect(rows.map((r) => r.id)).toEqual([3, 4, 1, 2]);
  });

  it("an 8-level chain flattens into a fully linear hierarchy with depths 0 through 7", () => {
    const chain: Issue[] = [];
    for (let i = 1; i <= 8; i++) {
      chain.push(
        makeRequirement({
          id: i,
          name: `Level ${i}`,
          parentId: i === 1 ? null : i - 1,
        })
      );
    }
    const { childrenMap } = buildRequirementMaps(chain);
    const expandedByIssueId: Record<number, boolean> = {};
    for (let i = 1; i <= 7; i++) expandedByIssueId[i] = true;

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId,
      sortConfig: nameAsc,
      coverage: undefined,
    });

    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("reports hasChildren false for a parent whose only child is filtered out", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Parent", parentId: null }),
      makeRequirement({ id: 2, name: "Only Child", parentId: 1 }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: new Set([1]),
      expandedByIssueId: { 1: true },
      sortConfig: nameAsc,
      coverage: undefined,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
    expect(rows[0].hasChildren).toBe(false);
  });

  it("terminates and caps at 100 levels rather than hanging on a cyclic parent chain", () => {
    const nodeA = makeRequirement({ id: 1, name: "A", parentId: null });
    const nodeB = makeRequirement({ id: 2, name: "B", parentId: 1 });

    // A cyclic fixture built by hand (not via buildRequirementMaps, which
    // could never produce a cycle from a flat requirements array): node 1's
    // only child is node 2, and node 2's only child is node 1 again.
    const cyclicChildrenMap = new Map<number | null, Issue[]>();
    cyclicChildrenMap.set(null, [nodeA]);
    cyclicChildrenMap.set(1, [nodeB]);
    cyclicChildrenMap.set(2, [nodeA]);

    const rows = flattenRequirementRows({
      childrenMap: cyclicChildrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: { 1: true, 2: true },
      sortConfig: nameAsc,
      coverage: undefined,
    });

    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows.every((row) => row.depth < 100)).toBe(true);
  });

  // 28-12 regression: this suite is 26.2's own proof that hierarchy
  // survives sort and filter, and 28-12 is the first thing to touch
  // `flattenRequirementRows` since. The expected shape below was captured
  // by running this exact fixture against the pre-28-12 implementation --
  // a full in-memory tree must produce byte-identical output after the
  // lazy-mode sibling (`flattenLazyRequirementRows`) and the optional
  // `isMatch` field were added alongside it.
  it("28-12 regression: a whole tree in memory produces byte-identical output to the pre-lazy-mode implementation", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Alpha Root", parentId: null }),
      makeRequirement({ id: 2, name: "Beta Child", parentId: 1 }),
      makeRequirement({ id: 3, name: "Charlie Child", parentId: 1 }),
      makeRequirement({ id: 5, name: "Delta Grandchild", parentId: 2 }),
      makeRequirement({ id: 4, name: "Echo Root", parentId: null }),
    ];
    const { childrenMap } = buildRequirementMaps(requirements);

    const rows = flattenRequirementRows({
      childrenMap,
      visibleRequirementIds: null,
      expandedByIssueId: { 1: true, 2: true },
      sortConfig: nameAsc,
      coverage: undefined,
    });

    expect(rows.map((r) => r.id)).toEqual([1, 2, 5, 3, 4]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(rows.map((r) => r.hasChildren)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    // The non-lazy path is unaffected by the new optional field: no row
    // carries an `isMatch` key at all, not even `undefined` explicitly set.
    rows.forEach((row) => expect("isMatch" in row).toBe(false));
  });
});
