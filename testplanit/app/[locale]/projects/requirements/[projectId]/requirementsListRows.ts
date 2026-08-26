import { coverageFor } from "~/hooks/useRequirementCoverage";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type {
  RequirementCoverageBreakdown,
  RequirementCoverageStatusCount,
} from "~/lib/services/requirementCoverage";
import {
  formatIssueDisplayText,
  resolveRequirementDisplayStatus,
} from "~/utils/issueDisplayText";
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

/**
 * For every requirement id, an array whose FIRST element is that id itself
 * followed by every descendant id, depth-first (self-inclusive by contract:
 * every consumer wants `issueId: { in: [self, ...descendants] }`, and a
 * caller that had to remember to prepend the self id would eventually
 * forget). Computed in one pass over `childrenMap`, memoised per id so a
 * child's own descendant list is computed once and reused by every ancestor
 * -- a deep tree does not go quadratic.
 *
 * Depth cap mirrors `flattenRequirementRows`'s own `depth < 100` guard
 * (itself mirroring `requirementHierarchy.ts`'s CTE caps), so a malformed or
 * cyclic parent chain cannot hang this computation either. A node reached
 * via a cycle (an ancestor still on the current recursion path) or past the
 * depth cap returns just itself, uncached -- caching a partial view under a
 * cycle would give the WRONG (truncated) answer to a sibling branch that
 * reaches the same node by a different, cycle-free path.
 */
export function buildDescendantIdMap(
  childrenMap: Map<number | null, Issue[]>
): Map<number, number[]> {
  const map = new Map<number, number[]>();

  function visit(
    id: number,
    depth: number,
    ancestorsOnPath: Set<number>
  ): number[] {
    const cached = map.get(id);
    if (cached) return cached;
    if (ancestorsOnPath.has(id) || depth >= 100) {
      return [id];
    }

    ancestorsOnPath.add(id);
    const seen = new Set<number>([id]);
    const ids = [id];
    for (const child of childrenMap.get(id) ?? []) {
      for (const descendantId of visit(child.id, depth + 1, ancestorsOnPath)) {
        if (!seen.has(descendantId)) {
          seen.add(descendantId);
          ids.push(descendantId);
        }
      }
    }
    ancestorsOnPath.delete(id);

    map.set(id, ids);
    return ids;
  }

  for (const children of childrenMap.values()) {
    for (const requirement of children) {
      if (!map.has(requirement.id)) {
        visit(requirement.id, 0, new Set<number>());
      }
    }
  }

  return map;
}

/**
 * "" means "not filtering on this axis" throughout, mirroring the milestone
 * comparator's own convention (`MemberIssuesTable.tsx`'s
 * `CoverageStateFilter`/`SourceFilter`). Coverage's non-empty states are the
 * requirements domain's own definitions (plan 10's chip, the shipped gap
 * report), NOT the milestone's "no completed outcome" --
 * `matchesRequirementCoverageFilter` says so explicitly below.
 */
export type RequirementCoverageFilter =
  "" | "UNCOVERED" | "UNTESTED" | `status:${number}`;
export type RequirementSourceFilter = "" | "MANUAL" | "SYNCED" | "DETACHED";

export interface RequirementListFilters {
  coverage: RequirementCoverageFilter;
  /** Exact match against `resolveRequirementDisplayStatus`'s own lock-aware
   *  value; `""` means every status, never a literal empty-status match. */
  status: string;
  source: RequirementSourceFilter;
}

/**
 * The requirements domain's own coverage-state predicate -- deliberately NOT
 * `MemberIssuesTable.tsx`'s `matchesCoverageState`, even though the shape is
 * mirrored. `UNCOVERED` here is `breakdown.uncovered === true` (zero linked
 * cases anywhere in the subtree, the same boolean plan 10's `CoverageChip`
 * and the gap report both key on), not the milestone's "no completed
 * outcome" -- a requirement whose linked cases are all NOT_RUN is
 * "Untested" here, not "Uncovered". An absent breakdown matches only
 * `"UNCOVERED"`, mirroring the comparator.
 */
export function matchesRequirementCoverageFilter(
  filter: RequirementCoverageFilter,
  breakdown: RequirementCoverageBreakdown | undefined
): boolean {
  if (!filter) return true;
  if (!breakdown) return filter === "UNCOVERED";
  if (filter === "UNCOVERED") return breakdown.uncovered === true;
  if (filter === "UNTESTED") return (breakdown.untested ?? 0) > 0;
  if (filter.startsWith("status:")) {
    const statusId = Number(filter.slice("status:".length));
    return (breakdown.statuses ?? []).some(
      (entry) => entry.statusId === statusId && entry.count > 0
    );
  }
  return true;
}

/** Exact match against the same lock-aware value the Status column sorts on
 *  and displays (`resolveRequirementDisplayStatus`, `compareRequirements`'s
 *  own "status" case below). */
export function matchesRequirementStatusFilter(
  filter: string,
  requirement: Issue
): boolean {
  if (!filter) return true;
  return (resolveRequirementDisplayStatus(requirement) ?? "") === filter;
}

// Indexed by `requirementSourceSortValue`'s own 0/1/2 ranking (Native,
// Detached, Synced) -- reusing that encoding rather than re-deriving the
// provenance rules a second time.
const SOURCE_FILTER_BY_RANK: readonly Exclude<RequirementSourceFilter, "">[] = [
  "MANUAL",
  "DETACHED",
  "SYNCED",
];

export function matchesRequirementSourceFilter(
  filter: RequirementSourceFilter,
  requirement: Issue
): boolean {
  if (!filter) return true;
  return (
    SOURCE_FILTER_BY_RANK[requirementSourceSortValue(requirement)] === filter
  );
}

export interface ComputeVisibleRequirementIdsArgs {
  requirements: Issue[];
  requirementMap: Map<number, Issue>;
  childrenMap: Map<number | null, Issue[]>;
  normalizedFilter: string;
  filters: RequirementListFilters;
  coverage: RequirementCoverageResponse | undefined;
  coverageError: boolean;
}

/**
 * Ported from the earlier react-arborist tree component this phase
 * replaced (its own lines 367-452), generalized for gap closure 26.2-12
 * (UAT gap 7) from the single boolean "only show uncovered" toggle this
 * function used to take to four independent filter axes -- text, coverage,
 * status, source -- that intersect into ONE match set, which then shares
 * the SAME ancestor-retention walk every prior version of this function
 * used. Returns `null` when NO axis is active (meaning "no filtering", not
 * "nothing visible").
 */
export function computeVisibleRequirementIds({
  requirements,
  requirementMap,
  childrenMap,
  normalizedFilter,
  filters,
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

  // The coverage axis degrades to INACTIVE (not "matches nothing") when
  // coverage hasn't loaded or has errored -- exactly the old toggle's own
  // no-op-on-outage behaviour, generalized: a coverage outage that arrives
  // after the Coverage Select was set never hides the whole tree, and the
  // other three axes keep working regardless.
  const coverageAxisActive =
    filters.coverage !== "" && coverage !== undefined && !coverageError;
  let coverageMatchIds: Set<number> | null = null;
  if (coverageAxisActive) {
    coverageMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (
        matchesRequirementCoverageFilter(
          filters.coverage,
          coverageFor(coverage, requirement.id)
        )
      ) {
        coverageMatchIds!.add(requirement.id);
      }
    });
  }

  let statusMatchIds: Set<number> | null = null;
  if (filters.status) {
    statusMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (matchesRequirementStatusFilter(filters.status, requirement)) {
        statusMatchIds!.add(requirement.id);
      }
    });
  }

  let sourceMatchIds: Set<number> | null = null;
  if (filters.source) {
    sourceMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (matchesRequirementSourceFilter(filters.source, requirement)) {
        sourceMatchIds!.add(requirement.id);
      }
    });
  }

  // The combined match set is the INTERSECTION of whichever axes are
  // active, never a union: union would surface e.g. a covered requirement
  // the instant someone typed in the search box, which is the opposite of
  // "show me the gaps." When only one axis is active, that axis alone
  // determines matches; when none are active, there is no filtering at all.
  const activeSets = [
    filterMatchIds,
    coverageMatchIds,
    statusMatchIds,
    sourceMatchIds,
  ].filter((set): set is Set<number> => set !== null);

  let activeMatchIds: Set<number> | null;
  if (activeSets.length === 0) {
    activeMatchIds = null;
  } else {
    const [first, ...rest] = activeSets;
    activeMatchIds = new Set(
      [...first].filter((issueId) => rest.every((set) => set.has(issueId)))
    );
  }

  if (!activeMatchIds) return null;

  // A match is only reachable with its ancestors present, and only
  // browsable with its descendants present, so both join it in the visible
  // set -- mirrors TreeView.tsx's `filterVisibleFolderIds`. ONE walk shared
  // by every axis: filters choose the match set, they do not each
  // re-implement this walk.
  const visible = new Set<number>(activeMatchIds);

  activeMatchIds.forEach((issueId) => {
    let current = requirementMap.get(issueId)?.parentId ?? null;
    while (current !== null && !visible.has(current)) {
      visible.add(current);
      current = requirementMap.get(current)?.parentId ?? null;
    }
  });

  // Descendant BFS runs ONLY when NO non-text axis is active. With every
  // non-text axis inactive this is exactly the pre-26-06 text-filter
  // behavior (activeMatchIds === filterMatchIds in that case) --
  // byte-for-byte, including this expansion. With any coverage/status/source
  // axis active, expanding to every descendant of a match would re-admit
  // rows that do not match, contradicting that axis's own promise -- the
  // same reason the original uncovered toggle suppressed this walk. Nothing
  // is lost for coverage specifically: an uncovered requirement's
  // descendants are uncovered too by construction of the rollup (zero cases
  // in the subtree means zero cases anywhere beneath it), so they already
  // match on their own and need no BFS to be reached; status/source are
  // per-row properties with no such inheritance, so a non-matching
  // descendant genuinely should stay hidden under those axes.
  const nonTextAxisActive =
    coverageAxisActive || filters.status !== "" || filters.source !== "";
  if (!nonTextAxisActive) {
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

/**
 * The union of `statuses[]` across every loaded requirement's breakdown, one
 * entry per `statusId` with its name/colour and the summed count, ordered by
 * count descending -- verbatim in shape to the milestone comparator's own
 * `coverageTotals.statuses` collector (`MemberIssuesTable.tsx` lines
 * 283-311). A status with a zero count never becomes an option:
 * `RequirementCoverageBreakdown.statuses` only ever carries COMPLETED
 * statuses with `count > 0` by construction, but this collector re-asserts
 * that filter defensively rather than trusting the producer silently.
 */
export function collectCoverageStatusOptions(
  requirements: Issue[],
  coverage: RequirementCoverageResponse | undefined
): RequirementCoverageStatusCount[] {
  if (!coverage) return [];
  const byStatus = new Map<number, RequirementCoverageStatusCount>();
  requirements.forEach((requirement) => {
    const breakdown = coverageFor(coverage, requirement.id);
    (breakdown?.statuses ?? []).forEach((entry) => {
      if (entry.count <= 0) return;
      const existing = byStatus.get(entry.statusId);
      if (existing) {
        existing.count += entry.count;
      } else {
        byStatus.set(entry.statusId, { ...entry });
      }
    });
  });
  return Array.from(byStatus.values()).sort((a, b) => b.count - a.count);
}

/**
 * The distinct non-empty `resolveRequirementDisplayStatus` values present
 * across the loaded requirements, de-duplicated case-insensitively but
 * preserving the first-seen casing, sorted case-insensitively -- verbatim in
 * shape to the milestone comparator's own `issueTypes` collector (lines
 * 313-325).
 */
export function collectRequirementStatusOptions(
  requirements: Issue[]
): string[] {
  const seen = new Map<string, string>();
  requirements.forEach((requirement) => {
    const value = resolveRequirementDisplayStatus(requirement);
    if (value && value.trim() !== "") {
      const lower = value.toLowerCase();
      if (!seen.has(lower)) seen.set(lower, value);
    }
  });
  return Array.from(seen.values()).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
}

// D-02a: this is NOT `CoverageChip.coverageSortValue`, even though the
// coverage cell now renders through `CoverageChip` itself (D-03c/UAT gap 4).
// `coverageSortValue` ranks by a sum of completed-outcome counts; this
// function ranks by `RequirementCoverageBreakdown`'s own four-rung
// precedence ladder (`STATUS_RANK` below), where any FAILED result anywhere
// in the subtree outranks NOT_RUN regardless of how many cases passed. That
// ladder is strictly richer than a sum and agrees with the chip by
// construction: `status === "UNCOVERED"` is true exactly when
// `linkedCaseCount === 0`, which is exactly the chip's `"no-linked-cases"`
// gate — the same chip/filter/sort consistency rule `MemberIssuesTable.tsx`
// states for itself.
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
      const aStatus = resolveRequirementDisplayStatus(a) ?? "";
      const bStatus = resolveRequirementDisplayStatus(b) ?? "";
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
    case "linkedCases": {
      primary =
        (coverageFor(coverage, a.id)?.directCaseCount ?? 0) -
        (coverageFor(coverage, b.id)?.directCaseCount ?? 0);
      break;
    }
    case "coveringCases": {
      primary =
        (coverageFor(coverage, a.id)?.linkedCaseCount ?? 0) -
        (coverageFor(coverage, b.id)?.linkedCaseCount ?? 0);
      break;
    }
    // Gap closure 26.2-17: `createdAt` is a non-nullable Issue column, but
    // this comparator stays defensive the same way `requirementCoverageSortValue`
    // does for an absent breakdown -- a missing timestamp becomes
    // `POSITIVE_INFINITY` rather than a special-cased branch, so the SAME
    // `direction === "desc"` negation below (never a second sentinel) is what
    // produces "null last in asc, null first in desc" -- one rule, proven by
    // the existing negation path every other column already relies on.
    case "createdAt": {
      const aTime = a.createdAt
        ? new Date(a.createdAt).getTime()
        : Number.POSITIVE_INFINITY;
      const bTime = b.createdAt
        ? new Date(b.createdAt).getTime()
        : Number.POSITIVE_INFINITY;
      primary = aTime - bTime;
      break;
    }
    // D-17: `Issue.priority` is a free-form `String?` that carries whatever
    // vocabulary the connected tracker uses (Jira priorities are per-project
    // configurable), so a hardcoded critical/high/medium/low rank would
    // mis-order every non-default tracker vocabulary and silently disagree
    // with `IssuePriorityDisplay`, which also treats the value as an opaque
    // string. The `status` case above already made this exact call for
    // `externalStatus`.
    case "priority": {
      primary = (a.priority ?? "").localeCompare(b.priority ?? "");
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
