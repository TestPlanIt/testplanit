import { describe, expect, it } from "vitest";

import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import type { Issue } from "~/zenstack/models";

import {
  buildRequirementMaps,
  computeVisibleRequirementIds,
  countDescendants,
  flattenRequirementRows,
  requirementCoverageSortValue,
  requirementSourceSortValue,
  type RequirementListSortConfig,
} from "./requirementsListRows";

// Local fixture factory -- deliberately not a full ZenStack model object,
// only the fields this module's functions actually read.
function makeRequirement(args: {
  id: number;
  name: string;
  title?: string | null;
  parentId?: number | null;
  integrationId?: number | null;
  requirementDetachedAt?: Date | string | null;
  externalStatus?: string | null;
  status?: string | null;
}): Issue {
  return {
    id: args.id,
    name: args.name,
    title: args.title ?? args.name,
    parentId: args.parentId ?? null,
    integrationId: args.integrationId ?? null,
    requirementDetachedAt: args.requirementDetachedAt ?? null,
    externalStatus: args.externalStatus ?? null,
    status: args.status ?? null,
  } as Issue;
}

// Established fixture shape for RequirementCoverageBreakdown, matching
// RequirementCoverageBadge.test.tsx rather than inventing a second one.
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

describe("computeVisibleRequirementIds", () => {
  it("returns null when the filter box is empty and the uncovered toggle is off", () => {
    const requirements = [
      makeRequirement({ id: 1, name: "Root", parentId: null }),
    ];
    const { requirementMap, childrenMap } = buildRequirementMaps(requirements);

    const result = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "",
      showOnlyUncovered: false,
      coverage: undefined,
      coverageError: false,
    });

    expect(result).toBeNull();
  });

  it("the uncovered filter keeps every ancestor of 8 uncovered leaves visible, but excludes a covered sibling", () => {
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
      showOnlyUncovered: true,
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

  it("the uncovered filter keeps ancestors visible transitively, 4 levels deep", () => {
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
      showOnlyUncovered: true,
      coverage,
      coverageError: false,
    });

    expect(visible).toEqual(new Set([1, 2, 3, 4]));
  });

  it("intersects the text filter and the uncovered filter rather than unioning them", () => {
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
      showOnlyUncovered: true,
      coverage,
      coverageError: false,
    });

    expect(visible!.has(3)).toBe(true);
    expect(visible!.has(2)).toBe(false);
  });

  it("expands a text match's descendants when the uncovered filter is off, but not when it is on", () => {
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

    const withoutToggle = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "login",
      showOnlyUncovered: false,
      coverage,
      coverageError: false,
    });
    expect(withoutToggle!.has(2)).toBe(true);

    const withToggle = computeVisibleRequirementIds({
      requirements,
      requirementMap,
      childrenMap,
      normalizedFilter: "login",
      showOnlyUncovered: true,
      coverage,
      coverageError: false,
    });
    expect(withToggle!.has(2)).toBe(false);
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
});
