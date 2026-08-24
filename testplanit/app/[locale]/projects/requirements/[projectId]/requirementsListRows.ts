import { coverageFor } from "~/hooks/useRequirementCoverage";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";
import type { Issue } from "~/zenstack/models";

/**
 * Pure hierarchy/filter/sort derivations for the requirements list
 * (26.2-PATTERNS.md "No Analog Found": nothing in this codebase does an
 * unbounded-depth flatten-with-depth). No React, no fetch, no rendering —
 * every function here is a plain data transform so 26.2's automated tests
 * can prove ROADMAP success criteria 2 (hierarchy survives sort/filter) and
 * 4 (the uncovered filter keeps ancestors) without mounting a component or
 * mocking the drag-drop seam.
 */

export type RequirementRow = Issue & { depth: number; hasChildren: boolean };

export interface RequirementListSortConfig {
  column: string;
  direction: "asc" | "desc";
}

/**
 * Ported from the earlier react-arborist tree component this phase
 * replaced (its own lines 302-333). `childrenMap` keys on
 * `requirement.parentId ?? null`; `hasChildrenMap` seeds every id `false`
 * then marks every referenced `parentId` `true`.
 */
export function buildRequirementMaps(requirements: Issue[]): {
  requirementMap: Map<number, Issue>;
  hasChildrenMap: Map<number, boolean>;
  childrenMap: Map<number | null, Issue[]>;
} {
  const requirementMap = new Map<number, Issue>();
  requirements.forEach((requirement) =>
    requirementMap.set(requirement.id, requirement)
  );

  const hasChildrenMap = new Map<number, boolean>();
  requirements.forEach((requirement) =>
    hasChildrenMap.set(requirement.id, false)
  );
  requirements.forEach((requirement) => {
    if (requirement.parentId !== null) {
      hasChildrenMap.set(requirement.parentId, true);
    }
  });

  const childrenMap = new Map<number | null, Issue[]>();
  requirements.forEach((requirement) => {
    const parentKey = requirement.parentId ?? null;
    if (!childrenMap.has(parentKey)) {
      childrenMap.set(parentKey, []);
    }
    childrenMap.get(parentKey)!.push(requirement);
  });

  return { requirementMap, hasChildrenMap, childrenMap };
}

/**
 * Ported from the earlier react-arborist tree component this phase
 * replaced (its own lines 340-349). Root excluded, matching
 * `getIssueSubtreeIds`'s own descendant-only contract and
 * `DeleteRequirementModal`'s `descendantCount` prop (HIER-04's UI contract).
 */
export function countDescendants(
  childrenMap: Map<number | null, Issue[]>,
  issueId: number
): number {
  const children = childrenMap.get(issueId) ?? [];
  return children.reduce(
    (total, child) => total + 1 + countDescendants(childrenMap, child.id),
    0
  );
}

export interface ComputeVisibleRequirementIdsArgs {
  requirements: Issue[];
  requirementMap: Map<number, Issue>;
  childrenMap: Map<number | null, Issue[]>;
  normalizedFilter: string;
  showOnlyUncovered: boolean;
  coverage: RequirementCoverageResponse | undefined;
  coverageError: boolean;
}

/**
 * Ported from the earlier react-arborist tree component this phase
 * replaced (its own lines 367-452), verbatim in behaviour. Returns `null`
 * when neither predicate is active (meaning "no filtering", not "nothing
 * visible").
 */
export function computeVisibleRequirementIds({
  requirements,
  requirementMap,
  childrenMap,
  normalizedFilter,
  showOnlyUncovered,
  coverage,
  coverageError,
}: ComputeVisibleRequirementIdsArgs): Set<number> | null {
  // Requirements whose own name matches the filter box.
  let filterMatchIds: Set<number> | null = null;
  if (normalizedFilter) {
    filterMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (requirement.name.toLowerCase().includes(normalizedFilter)) {
        filterMatchIds!.add(requirement.id);
      }
    });
  }

  // Requirements whose rolled-up breakdown says `uncovered` -- the
  // dedicated boolean, never inferred from `status` or from a missing map
  // entry. `null` (not an empty set) whenever the toggle is off OR coverage
  // hasn't loaded/errored, so a coverage outage that arrives after the
  // toggle was switched on degrades to "no filtering from this axis"
  // rather than silently hiding the whole tree.
  let uncoveredMatchIds: Set<number> | null = null;
  if (showOnlyUncovered && coverage && !coverageError) {
    uncoveredMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (coverageFor(coverage, requirement.id)?.uncovered === true) {
        uncoveredMatchIds!.add(requirement.id);
      }
    });
  }

  // The combined match set is the INTERSECTION of whichever predicates are
  // active, never a union: union would surface covered requirements the
  // instant someone typed in the search box, which is the opposite of
  // "show me the gaps." When only one of the two filters is active, that
  // filter alone determines matches; when neither is active, there is no
  // filtering at all.
  let activeMatchIds: Set<number> | null;
  if (filterMatchIds && uncoveredMatchIds) {
    const intersection = new Set<number>();
    filterMatchIds.forEach((issueId) => {
      if (uncoveredMatchIds!.has(issueId)) intersection.add(issueId);
    });
    activeMatchIds = intersection;
  } else {
    activeMatchIds = filterMatchIds ?? uncoveredMatchIds;
  }

  if (!activeMatchIds) return null;

  // A match is only reachable with its ancestors present, and only
  // browsable with its descendants present, so both join it in the visible
  // set -- mirrors TreeView.tsx's `filterVisibleFolderIds`.
  const visible = new Set<number>(activeMatchIds);

  activeMatchIds.forEach((issueId) => {
    let current = requirementMap.get(issueId)?.parentId ?? null;
    while (current !== null && !visible.has(current)) {
      visible.add(current);
      current = requirementMap.get(current)?.parentId ?? null;
    }
  });

  // Descendant BFS runs ONLY while the uncovered toggle is off. With the
  // toggle off this is exactly the pre-26-06 text-filter behavior
  // (activeMatchIds === filterMatchIds in that case) -- byte-for-byte,
  // including this expansion. With the toggle on, expanding to every
  // descendant of a match would re-introduce covered descendants under
  // an uncovered ancestor, contradicting the toggle's own promise. And
  // nothing is lost by skipping it: an uncovered requirement's
  // descendants are uncovered too by construction of the rollup (zero
  // cases in the subtree means zero cases anywhere beneath it), so they
  // already match on their own and need no BFS to be reached.
  if (!showOnlyUncovered) {
    const queue = [...activeMatchIds];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const child of childrenMap.get(parentId) ?? []) {
        if (!visible.has(child.id)) {
          visible.add(child.id);
          queue.push(child.id);
        }
      }
    }
  }

  return visible;
}

// D-02a: this is NOT `CoverageChip.coverageSortValue`. That function reads
// `breakdown.statuses` / `breakdown.uncovered` off a `CoverageBreakdown` —
// this list's cells consume `RequirementCoverageBreakdown`, which has no
// `statuses` array at all, so casting one into the other's signature
// type-checks under this repo's config but silently returns nonsense (every
// requirement would rank as uncovered). The two shapes are produced by two
// different services and converge only visually (both already share
// `IterationStatusPip`/`resolvePipColor`), not structurally, so this is
// written fresh against the correct type, following `coverageSortValue`'s
// *pattern* — uncovered groups separately, covered rows rank monotonically.
const STATUS_RANK: Record<RequirementCoverageBreakdown["status"], number> = {
  UNCOVERED: 0,
  FAILED: 1,
  NOT_RUN: 2,
  PASSED: 3,
};

export function requirementCoverageSortValue(
  breakdown: RequirementCoverageBreakdown | undefined
): number {
  if (!breakdown) return -1;
  return STATUS_RANK[breakdown.status] * 10_000 + breakdown.passed;
}

/**
 * Mirrors the three states `RequirementProvenanceBadge.tsx` renders, in
 * that order: Native (`integrationId == null`), Detached (`integrationId !=
 * null && requirementDetachedAt != null`), Synced/locked (otherwise).
 */
export function requirementSourceSortValue(requirement: Issue): number {
  if (requirement.integrationId == null) return 0;
  if (requirement.requirementDetachedAt != null) return 1;
  return 2;
}

export interface FlattenRequirementRowsArgs {
  childrenMap: Map<number | null, Issue[]>;
  visibleRequirementIds: Set<number> | null;
  expandedByIssueId: Record<number, boolean>;
  sortConfig: RequirementListSortConfig;
  coverage: RequirementCoverageResponse | undefined;
}

function compareRequirements(
  a: Issue,
  b: Issue,
  sortConfig: RequirementListSortConfig,
  coverage: RequirementCoverageResponse | undefined
): number {
  let primary: number;
  switch (sortConfig.column) {
    case "status": {
      const aStatus = a.externalStatus ?? a.status ?? "";
      const bStatus = b.externalStatus ?? b.status ?? "";
      primary = aStatus.localeCompare(bStatus);
      break;
    }
    case "coverage": {
      primary =
        requirementCoverageSortValue(coverageFor(coverage, a.id)) -
        requirementCoverageSortValue(coverageFor(coverage, b.id));
      break;
    }
    case "source": {
      primary = requirementSourceSortValue(a) - requirementSourceSortValue(b);
      break;
    }
    case "name":
    default: {
      primary = formatIssueDisplayText(a).localeCompare(
        formatIssueDisplayText(b)
      );
      break;
    }
  }

  if (primary !== 0) {
    return sortConfig.direction === "desc" ? -primary : primary;
  }

  // Tie-break by name then id, always ascending (never negated) -- a desc
  // sort that also reversed ties would shuffle rows that compare equal
  // (D-02c).
  const nameTieBreak = formatIssueDisplayText(a).localeCompare(
    formatIssueDisplayText(b)
  );
  if (nameTieBreak !== 0) return nameTieBreak;
  return a.id - b.id;
}

/**
 * Depth-first flatten from `parentId === null` at depth 0. A collapsed
 * parent's descendants are absent from the array entirely (UI-SPEC §4.1),
 * not hidden with CSS. Sorting is per-sibling-group and recursive
 * (UI-SPEC §4.4, D-02c) so parent-before-own-descendants adjacency can
 * never be broken by a sort.
 */
export function flattenRequirementRows({
  childrenMap,
  visibleRequirementIds,
  expandedByIssueId,
  sortConfig,
  coverage,
}: FlattenRequirementRowsArgs): RequirementRow[] {
  const rows: RequirementRow[] = [];

  // Depth cap mirroring `requirementHierarchy.ts`'s own CTE caps, so a
  // malformed/cyclic parent chain cannot hang the render (T-26.2-10).
  const walk = (parentId: number | null, depth: number): void => {
    if (!(depth < 100)) return;

    const siblings = (childrenMap.get(parentId) ?? []).filter(
      (requirement) =>
        visibleRequirementIds === null ||
        visibleRequirementIds.has(requirement.id)
    );

    const sorted = [...siblings].sort((a, b) =>
      compareRequirements(a, b, sortConfig, coverage)
    );

    for (const requirement of sorted) {
      // D-02b: `hasChildren` is computed against the VISIBLE set, not the
      // full set -- a `hasChildrenMap` derived from the unfiltered data
      // would give a chevron that expands into nothing.
      const hasChildren = (childrenMap.get(requirement.id) ?? []).some(
        (child) =>
          visibleRequirementIds === null || visibleRequirementIds.has(child.id)
      );

      rows.push({ ...requirement, depth, hasChildren } as RequirementRow);

      if (hasChildren && expandedByIssueId[requirement.id] === true) {
        walk(requirement.id, depth + 1);
      }
    }
  };

  walk(null, 0);

  return rows;
}
