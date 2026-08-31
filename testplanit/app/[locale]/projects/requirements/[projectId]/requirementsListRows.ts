import { coverageFor } from "~/hooks/useRequirementCoverage";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import {
  matchesRequirementCoverageFilter,
  matchesRequirementCoverageFilters,
  type RequirementCoverageFilter,
} from "~/lib/services/requirementCoverageFilter";
import { requirementCoverageSortValue } from "~/lib/services/requirementCoverageSort";
import type { RequirementCoverageStatusCount } from "~/lib/services/requirementCoverage";
import {
  formatIssueDisplayText,
  resolveRequirementDisplayPriority,
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

export type RequirementRow = Issue & {
  depth: number;
  hasChildren: boolean;
  /** Set only when a filter is active: `true` for a server-matched row,
   *  `false` for an ancestor-context row shown solely to make a match
   *  reachable. Left `undefined` when not filtering -- every row is simply
   *  in scope and no match/ancestor distinction applies (28-12, read by
   *  28-14's renderer). */
  isMatch?: boolean;
};

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
 * `RequirementCoverageFilter` and `matchesRequirementCoverageFilter` now
 * live in `lib/services/requirementCoverageFilter.ts` (28-12) -- a pure,
 * type-only-import module a route handler can share with the client
 * without pulling React Query into a server bundle. Re-exported here
 * verbatim so no existing importer of this file has to move.
 *
 * `[]` means "not filtering on this axis" throughout -- the array form of
 * the `""` the singular predicates still take. Coverage's non-empty states
 * are the requirements domain's own definitions (plan 10's chip, the
 * shipped gap report), NOT the milestone's "no completed outcome" --
 * `matchesRequirementCoverageFilter` says so explicitly in its own module.
 */
export {
  matchesRequirementCoverageFilter,
  matchesRequirementCoverageFilters,
  type RequirementCoverageFilter,
};

/** One selectable provenance value. The `""` member is the SINGULAR axis's
 *  own "inactive" marker and is kept only for the per-value predicates
 *  below; the filter state itself is an array, where `[]` says the same
 *  thing without a sentinel string. */
export type RequirementSourceFilter = "" | "MANUAL" | "SYNCED" | "DETACHED";
export type RequirementSourceValue = Exclude<RequirementSourceFilter, "">;

/**
 * Every axis is MULTI-SELECT (three `MultiAsyncCombobox`es in
 * `RequirementsListView.tsx`, following `JunitFilterBar.tsx`'s own facet
 * shape). Within one axis the selections UNION; the axes still INTERSECT
 * with each other -- see `computeVisibleRequirementIds` below, which is
 * where that asymmetry is decided and explained.
 */
export interface RequirementListFilters {
  /** `[]` means every coverage state, never a literal empty-state match. */
  coverage: RequirementCoverageFilter[];
  /** Exact matches against `resolveRequirementDisplayStatus`'s own
   *  lock-aware value; `[]` means every status, never a literal
   *  empty-status match. */
  status: string[];
  source: RequirementSourceValue[];
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

/** The multi-select form: a row matches when its display status is ANY of
 *  the selected ones. `[]` is the inactive axis. */
export function matchesRequirementStatusFilters(
  filters: readonly string[],
  requirement: Issue
): boolean {
  if (filters.length === 0) return true;
  const resolved = resolveRequirementDisplayStatus(requirement) ?? "";
  return filters.includes(resolved);
}

// Indexed by `requirementSourceSortValue`'s own 0/1/2 ranking (Native,
// Detached, Synced) -- reusing that encoding rather than re-deriving the
// provenance rules a second time.
const SOURCE_FILTER_BY_RANK: readonly RequirementSourceValue[] = [
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

/** The multi-select form: a row matches when its provenance is ANY of the
 *  selected ones. `[]` is the inactive axis. */
export function matchesRequirementSourceFilters(
  filters: readonly RequirementSourceValue[],
  requirement: Issue
): boolean {
  if (filters.length === 0) return true;
  return filters.includes(
    SOURCE_FILTER_BY_RANK[requirementSourceSortValue(requirement)]
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
  // Requirements whose own name OR title matches the filter box.
  //
  // Both, because a synced requirement's `name` is the tracker KEY and its
  // `title` is the human summary -- which is exactly why every surface
  // renders them together as "KEY: Title" (`formatIssueDisplayText`).
  // Matching name alone made a requirement reachable only by typing its key,
  // never by a word someone remembers from reading it.
  let filterMatchIds: Set<number> | null = null;
  if (normalizedFilter) {
    filterMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      const haystack = `${requirement.name} ${requirement.title ?? ""}`;
      if (haystack.toLowerCase().includes(normalizedFilter)) {
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
    filters.coverage.length > 0 && coverage !== undefined && !coverageError;
  let coverageMatchIds: Set<number> | null = null;
  if (coverageAxisActive) {
    coverageMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (
        matchesRequirementCoverageFilters(
          filters.coverage,
          coverageFor(coverage, requirement.id)
        )
      ) {
        coverageMatchIds!.add(requirement.id);
      }
    });
  }

  let statusMatchIds: Set<number> | null = null;
  if (filters.status.length > 0) {
    statusMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (matchesRequirementStatusFilters(filters.status, requirement)) {
        statusMatchIds!.add(requirement.id);
      }
    });
  }

  let sourceMatchIds: Set<number> | null = null;
  if (filters.source.length > 0) {
    sourceMatchIds = new Set<number>();
    requirements.forEach((requirement) => {
      if (matchesRequirementSourceFilters(filters.source, requirement)) {
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
    coverageAxisActive ||
    filters.status.length > 0 ||
    filters.source.length > 0;
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

/**
 * `requirementCoverageSortValue` now lives in
 * `lib/services/requirementCoverageSort.ts` -- a pure, type-only-import
 * module the tree route can share with the client, extracted for exactly
 * the reason `requirementCoverageFilter.ts` was. The server-side sort
 * (28-SORT) needs this ranking to order a page in SQL, and a route handler
 * cannot import THIS file: it pulls in `~/hooks/useRequirementCoverage`,
 * a React Query hook module. Re-exported verbatim so no existing importer
 * of this file has to move.
 */
export { requirementCoverageSortValue };

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
      primary = (resolveRequirementDisplayPriority(a) ?? "").localeCompare(
        resolveRequirementDisplayPriority(b) ?? ""
      );
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

/**
 * The shape a lazily loaded row already carries per row, straight from the
 * server (28-08's `RequirementTreeRow`): `hasChildren` is a server-computed
 * fact here, never re-derived from `childrenMap` -- exactly 28-RESEARCH
 * Pitfall 1, where a root whose children have not been fetched yet would
 * otherwise answer `false`.
 */
export type LazyRequirementSourceRow = Issue & { hasChildren: boolean };

export interface FlattenLazyRequirementRowsArgs {
  /**
   * Every row currently held in the client's partial forest -- some roots,
   * some fetched children, plus (under an active filter) matches and their
   * ancestor chain. Order does not matter: this function derives its own
   * parent/child grouping from `parentId` and re-sorts every sibling group
   * itself, the same as the full-data flatten above.
   */
  rows: LazyRequirementSourceRow[];
  expandedByIssueId: Record<number, boolean>;
  sortConfig: RequirementListSortConfig;
  coverage: RequirementCoverageResponse | undefined;
  /**
   * The server's matched-id set under an active filter. `null`/`undefined`
   * means "not filtering" -- every row is in scope and `isMatch` is left
   * `undefined` rather than forced to `true` (see `RequirementRow.isMatch`).
   */
  matchedIds?: Set<number> | null;
}

/**
 * The lazy-mode sibling of `flattenRequirementRows` above (28-12,
 * SCALE-02): a SEPARATE function rather than a mode flag threaded through
 * the one above, because the two answer a different question about "does
 * this row have children" -- the full-data flatten can only ever ask the
 * in-memory `childrenMap`, which is complete by construction; this one must
 * trust a server-supplied flag instead, since the loaded set is, by
 * definition, incomplete. A mode flag would need to branch on that question
 * inside every part of the walk; two small functions sharing what genuinely
 * IS shared -- the comparator (`compareRequirements`) and the `depth < 100`
 * cap -- reads clearer than one function with two personalities.
 *
 * Partial-forest assembly rules (28-12 `<interfaces>`):
 * - A row whose `parentId` is not itself present in the loaded set renders
 *   at the top level of what is displayed, exactly like a true root -- it
 *   is never dropped and never re-parented to some other loaded row.
 * - A row is never emitted twice, however it was delivered (as a root, as a
 *   fetched child, or as an ancestor of a match).
 * - Ordering within a sibling group uses the SAME comparator the full-data
 *   flatten uses.
 * - The depth used for indentation is the row's depth WITHIN THE LOADED
 *   FOREST, not its true depth in the tracker -- an intermediate ancestor
 *   that has not been loaded would otherwise have to be fabricated as a
 *   placeholder row, which is worse than an indentation level that is
 *   sometimes shallower than the tracker's own hierarchy.
 */
export function flattenLazyRequirementRows({
  rows,
  expandedByIssueId,
  sortConfig,
  coverage,
  matchedIds,
}: FlattenLazyRequirementRowsArgs): RequirementRow[] {
  const isFiltering = matchedIds != null;

  const loadedIds = new Set<number>(rows.map((row) => row.id));

  // Group by parent WITHIN the loaded set only -- a row whose parentId is
  // not itself a loaded row's id renders at the top level (the orphan rule
  // above), keyed the same as a true root (`null`).
  const childrenByParent = new Map<number | null, LazyRequirementSourceRow[]>();
  rows.forEach((row) => {
    const parentKey =
      row.parentId !== null && loadedIds.has(row.parentId)
        ? row.parentId
        : null;
    if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
    childrenByParent.get(parentKey)!.push(row);
  });

  const output: RequirementRow[] = [];
  const emitted = new Set<number>();

  // Depth cap mirroring `flattenRequirementRows`'s own guard (T-26.2-10 /
  // T-28-12-03): a malformed or duplicated-parent loaded set cannot hang
  // this walk either.
  const walk = (parentKey: number | null, depth: number): void => {
    if (!(depth < 100)) return;

    const siblings = (childrenByParent.get(parentKey) ?? []).filter(
      (row) => !emitted.has(row.id)
    );

    const sorted = [...siblings].sort((a, b) =>
      compareRequirements(a, b, sortConfig, coverage)
    );

    for (const row of sorted) {
      // Delivered more than once (e.g. once as a fetched child, again as
      // an ancestor of a different match) -- emit it exactly once.
      if (emitted.has(row.id)) continue;
      emitted.add(row.id);

      const isMatch = isFiltering ? matchedIds!.has(row.id) : undefined;

      output.push({
        ...row,
        depth,
        hasChildren: row.hasChildren,
        ...(isMatch === undefined ? {} : { isMatch }),
      } as RequirementRow);

      if (row.hasChildren && expandedByIssueId[row.id] === true) {
        walk(row.id, depth + 1);
      }
    }
  };

  walk(null, 0);

  return output;
}
