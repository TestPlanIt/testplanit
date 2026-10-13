// lib/services/requirementTree.ts
//
// Server-side primitives for the requirements tree's lazy/partial loading
// path (SCALE-02): a classified-row count that decides load-all vs lazy
// mode, a keyset-paginated window over a project's requirement ROOTS (each
// row carrying a server-computed `hasChildren`), and one node's live
// children on demand. (See `requirementHierarchy.ts`'s
// `getRequirementSubtreeCount` for the fourth primitive -- a descendant
// count without enumerating the subtree -- which lives beside the existing
// subtree-id CTE it mirrors instead of here.)
//
// RAW SQL ONLY, never a generated ZenStack hook and never an ORM
// `issue.findMany`/`findFirst`/`count` call. `lib/paginatedFindMany.ts`'s
// own header explains why: ZenStack v3 builds every selected relation *and
// the PolicyPlugin's per-row access subqueries* for ALL rows matching
// `where` before applying `LIMIT` -- fine for a page of 50 unfiltered rows,
// ruinous for a window pulled out of a project a typed import just
// populated with thousands of rows. `requirementCoverage.ts`'s rollup made
// this exact call for this exact reason, and every statement in this file
// follows its convention: Kysely `sql` tagged templates, executed via
// `.execute(db.$qb)` rather than `db.$queryRaw` -- because the shared
// column-projection fragment and the shared child-presence `EXISTS`
// fragment below need to compose into more than one top-level statement
// (the roots window and the children query), and Kysely's fragment
// composition is what lets each live in exactly one place instead of being
// retyped per call site. `db.$queryRaw`'s tagged-template signature (a
// fixed `TemplateStringsArray` plus bound `${}` values) cannot interpolate
// another tagged template's own text as raw SQL -- only as a bound
// parameter, which would try to bind a SQL fragment as a string literal and
// break the statement.
//
// KEYSET, NEVER OFFSET. This phase's whole premise is a typed import
// inserting thousands of rows while a user may be scrolling this very
// tree. `OFFSET` under concurrent inserts silently skips and repeats rows,
// because it counts rows from the start of the CURRENT result set on every
// call rather than resuming from a fixed point; `(name, id) > (lastName,
// lastId)` does not, because a row's identity in the ordering never moves
// out from under a cursor that names it directly. `SyncService` already
// moved its own Jira paging to a cursor for the same class of reason.
//
// NO AUTHORIZATION HERE, by design -- the same posture every function in
// `requirementHierarchy.ts` and `requirementCoverage.ts` already takes.
// This module answers "what does the tree look like", not "may this caller
// see it"; the route that calls in (28-10) is responsible for resolving
// the viewer's project scope before ever reaching these functions. A
// caller that forgets this exposes another project's requirements to
// whoever can reach the route.
import { sql, type RawBuilder } from "kysely";

import { baseDb } from "~/lib/db";
import { ISSUE_ROLE_SCOPE_SQL_REQUIREMENT } from "~/lib/services/issueRoleScope";
import {
  getRequirementCoverage,
  type RequirementCoverageScope,
  type RequirementCoverageStatusCount,
} from "~/lib/services/requirementCoverage";

/**
 * D-01's fixed load-all/lazy boundary: at or below this many live,
 * requirement-role rows in a project, the client loads everything and
 * builds its tree in memory (today's shipped behavior, byte for byte).
 * Above it, the roots-window/children-on-demand primitives below take
 * over. `> REQUIREMENT_LAZY_THRESHOLD` is lazy; `<= REQUIREMENT_LAZY_THRESHOLD`
 * is load-all -- that comparison belongs to this constant's own meaning, so
 * every later caller (28-13's mode decision) reads the boundary from here
 * rather than restating it. Fixed at 500 with no configuration knob
 * (28-CONTEXT D-01); admin-configurability was explicitly rejected for v1.
 */
export const REQUIREMENT_LAZY_THRESHOLD = 500;

/**
 * The Issue columns every requirements-tree list surface actually reads,
 * derived by reading `RequirementsListColumns.tsx`, `requirementsListRows.ts`
 * and `utils/issueDisplayText.ts` (`formatIssueDisplayText`,
 * `resolveRequirementDisplayStatus`, `requirementSourceSortValue`) end to
 * end. Deliberately EXCLUDES `description`, `data`, `externalData` and
 * `note` -- none of those three modules ever reads them, and a 500-row
 * page of any one of those blobs is exactly the payload problem this phase
 * exists to remove. `hasChildren` is not an Issue column at all: it is
 * computed server-side per row (see `requirementHasChildrenFragment`
 * below), the one thing D-02 says partial loading cannot derive locally.
 */
export interface RequirementTreeRow {
  id: number;
  name: string;
  title: string;
  status: string | null;
  externalStatus: string | null;
  priority: string | null;
  externalPriority: string | null;
  externalId: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  issueTypeId: string | null;
  issueTypeName: string | null;
  issueTypeIconUrl: string | null;
  contentUpdatedAt: Date | null;
  createdAt: Date;
  projectId: number;
  integrationId: number | null;
  parentId: number | null;
  isRequirement: boolean;
  requirementDetachedAt: Date | null;
  isDeleted: boolean;
  hasChildren: boolean;
}

/**
 * Keyset cursor for `getRequirementRootsPage`: the SORT VALUE and `id` of
 * the last row a caller has already seen. `id` breaks every tie the sort
 * value alone could leave, so the tuple comparison below is a strict total
 * order whatever column is being sorted on.
 *
 * `value` is the ALREADY-NORMALIZED value the sort expression produced for
 * that row -- never null, because every descriptor in
 * `REQUIREMENT_SORT_DESCRIPTORS` coalesces its own expression (see that
 * table's own doc). A caller never constructs one: it comes back from a
 * previous page and is handed straight to the next call.
 */
export interface RequirementRootsCursor {
  value: string | number;
  id: number;
}

/**
 * The list's sortable columns. Deliberately a closed union rather than a
 * free string: this feeds an `ORDER BY` fragment, so an unrecognized value
 * must fail at the route's schema rather than reach SQL.
 *
 * `linkedCases`/`coveringCases`/`coverage` are the three COVERAGE-DERIVED
 * columns -- they have no Issue column of their own and are sorted through
 * a caller-supplied value list (see `RequirementTreeSort.coverageValues`).
 */
export const REQUIREMENT_SORT_COLUMNS = [
  "name",
  "status",
  "priority",
  "source",
  "createdAt",
  "coverage",
  "linkedCases",
  "coveringCases",
] as const;

export type RequirementSortColumn = (typeof REQUIREMENT_SORT_COLUMNS)[number];

/** The three columns whose values live in the coverage rollup rather than
 *  on the Issue row, so a caller has to supply them. */
export const COVERAGE_DERIVED_SORT_COLUMNS: readonly RequirementSortColumn[] = [
  "coverage",
  "linkedCases",
  "coveringCases",
];

export interface RequirementTreeSort {
  column: RequirementSortColumn;
  direction: "asc" | "desc";
  /**
   * Per-requirement sort values for a COVERAGE-DERIVED column, as two
   * parallel arrays (`unnest` joins them into a two-column relation
   * server-side). Precomputed by the CALLER from `getRequirementCoverage`'s
   * rollup, for the same reason `resolveRequirementMatches` takes
   * `coverageMatchIds` rather than computing coverage itself: that rollup
   * needs the caller's resolved project scope, and this module takes no
   * session and performs no authorization (see this file's own header).
   *
   * Required for a coverage-derived column, ignored for every other one. A
   * requirement absent from the arrays sorts as `-1` -- the same "no
   * breakdown" sentinel `requirementCoverageSortValue` uses client-side.
   */
  coverageValues?: RequirementCoverageSortValues | null;
}

export interface RequirementCoverageSortValues {
  ids: number[];
  values: number[];
}

/** The list's default order, and the one every caller falls back to. */
export const DEFAULT_REQUIREMENT_SORT: RequirementTreeSort = {
  column: "name",
  direction: "asc",
};

export interface RequirementRootsPage {
  rows: RequirementTreeRow[];
  nextCursor: RequirementRootsCursor | null;
}

/**
 * The shared row projection, composed into every statement in this file
 * that returns a `RequirementTreeRow` -- written once so a future column
 * addition to the interface above cannot reach one query and miss another.
 * Read against alias `i`, the alias this file uses for `"Issue"`
 * everywhere, matching `requirementHierarchy.ts`'s and
 * `requirementCoverage.ts`'s own convention. No `SELECT *`: the heavy
 * `description`/`data`/`externalData`/`note` blobs multiplied by a
 * 500-row page are exactly the payload problem this phase removes.
 */
const REQUIREMENT_TREE_COLUMNS = sql`
  i.id,
  i.name,
  i.title,
  i.status,
  i."externalStatus",
  i.priority,
  i."externalPriority",
  i."externalId",
  i."externalKey",
  i."externalUrl",
  i."issueTypeId",
  i."issueTypeName",
  i."issueTypeIconUrl",
  i."contentUpdatedAt",
  i."createdAt",
  i."projectId",
  i."integrationId",
  i."parentId",
  i."isRequirement",
  i."requirementDetachedAt",
  i."isDeleted"
`;

/**
 * The shared child-presence probe (28-CONTEXT D-02): true only when a LIVE
 * requirement child of `i` exists IN THE SAME PROJECT. `"projectId"` is
 * repeated here even though `i` is already project-scoped by its own
 * query's WHERE clause -- `Issue.parentId` carries no project constraint of
 * its own (the cycle-guard trigger and `assertSameProject` are app-level,
 * not column-level), so without this a cross-project child could light up
 * a chevron on a root whose children the expand query then correctly
 * refuses to return. Composed into both the roots window and the children
 * query so a future edit to this probe cannot reach one and miss the
 * other.
 */
function requirementHasChildrenFragment(projectId: number) {
  return sql`
  EXISTS (
    SELECT 1 FROM "Issue" c
    WHERE c."parentId" = i.id
      AND c."projectId" = ${projectId}
      AND c."isRequirement" = true
      AND c."isDeleted" = false
  ) AS "hasChildren"
`;
}

/**
 * Effective-root predicate: a requirement renders at the tree's top level
 * when it has no parent, or when its parent is not a LIVE requirement in
 * the SAME project — a promoted issue sitting under a non-requirement
 * Epic, or a child orphaned by declassification. Without the second arm
 * such rows vanish from the unfiltered tree entirely: the roots window
 * skips them and their parent (not being in the tree) can never be
 * expanded to reveal them. The project pin mirrors
 * `requirementHasChildrenFragment` above for the same reason, so the two
 * fragments partition every live requirement exactly: reachable through a
 * same-project requirement parent, or an effective root — never neither.
 * The client-side twin of this rule is `flattenLazyRequirementRows`'s
 * orphan promotion (`requirementsListRows.ts`).
 */
function requirementEffectiveRootFragment() {
  return sql`(
    i."parentId" IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM "Issue" root_parent
      WHERE root_parent."id" = i."parentId"
        AND root_parent."projectId" = i."projectId"
        AND root_parent."isRequirement" = true
        AND root_parent."isDeleted" = false
    )
  )`;
}

/**
 * Live, requirement-role rows in a project -- the number 28-13's mode
 * decision compares against `REQUIREMENT_LAZY_THRESHOLD`. Soft-deleted rows
 * and non-requirement (defect) rows are excluded, matching every other
 * function in this file family's role-scope discipline. Coerces the result
 * to a JS `number` defensively (matching `requirementCoverage.ts`'s own
 * `Number(row.count ?? 0)` convention): the `::int` cast below already
 * keeps the pg driver from handing back a `BigInt` for `COUNT(*)`, but a
 * caller-visible `Number(...)` here means a future edit that drops the
 * cast fails loudly as a wrong VALUE rather than silently as a wrong TYPE
 * a naive `{count}` formatter would render incorrectly.
 */
export async function countProjectRequirements(
  projectId: number,
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<number> {
  const { rows } = await sql<{ count: number | bigint }>`
    SELECT COUNT(*)::int AS count
    FROM "Issue" i
    WHERE i."projectId" = ${projectId}
      AND i."isRequirement" = true
      AND i."isDeleted" = false
  `.execute(db.$qb);
  return Number(rows[0]?.count ?? 0);
}

/**
 * How many of a project's requirements sit at the TOP LEVEL. The list's
 * unfiltered "Showing x of y" compares loaded root rows against this, not
 * against every requirement: a nested child is not a row the roots window
 * can ever load, so counting it in the denominator makes a fully-loaded
 * list read as though it stalled (operator UAT — "I got to 463 of 516 and
 * nothing more loads", where 463 WAS every root and the other 53 were
 * children waiting behind an expand arrow).
 */
export async function countProjectRequirementRoots(
  projectId: number,
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<number> {
  const { rows } = await sql<{ count: number | bigint }>`
    SELECT COUNT(*)::int AS count
    FROM "Issue" i
    WHERE i."projectId" = ${projectId}
      AND i."isRequirement" = true
      AND i."isDeleted" = false
      AND ${requirementEffectiveRootFragment()}
  `.execute(db.$qb);
  return Number(rows[0]?.count ?? 0);
}

/**
 * One keyset-paginated window of a project's requirement ROOTS (the
 * effective-root predicate above: no parent, or no same-project
 * requirement parent), ordered by `(name, id)` -- stable and gap-free
 * under concurrent writes because `id` breaks every tie `name` alone could
 * leave (28-RESEARCH Q3(b), measured at 1,200 rows in 28-01: an Index Scan
 * on `Issue_projectId_idx`, sub-millisecond, no Seq Scan). Every returned
 * row carries `hasChildren`, computed server-side by the shared fragment
 * above -- the one thing D-02 says an unexpanded root cannot answer for
 * itself.
 *
 * Fetches `limit + 1` rows in the ONE query rather than issuing a separate
 * "is there more" count: if the extra row comes back, there is a next
 * page. The cursor value derived for that next page is the LAST KEPT
 * row's `(name, id)`, never the extra row's own -- using the extra row's
 * own values would make the next page's strict `>` comparison skip that
 * very row (it would never appear on either page), so the extra row
 * exists only to answer "is there more" and is otherwise discarded.
 */
export async function getRequirementRootsPage(
  args: {
    projectId: number;
    limit: number;
    cursor?: RequirementRootsCursor | null;
    /** Defaults to name ascending — the order this window shipped with. */
    sort?: RequirementTreeSort;
  },
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<RequirementRootsPage> {
  const { projectId, limit, cursor, sort = DEFAULT_REQUIREMENT_SORT } = args;

  // A real WHERE-clause fragment when a cursor is supplied, or a no-op
  // empty fragment on page one -- composed the same way
  // `requirementCoverage.ts`'s `buildClosureFragment` composes its own
  // optional `rootScope`, so a missing cursor never becomes a separate,
  // string-concatenated query branch.
  const cursorFragment = cursor
    ? sql`AND ${requirementSortCursorFragment(sort, cursor)}`
    : sql``;

  const { rows } = await sql<SortedRequirementRow>`
    SELECT
      ${REQUIREMENT_TREE_COLUMNS},
      ${requirementHasChildrenFragment(projectId)},
      ${requirementSortKeyFragment(sort)}
    FROM "Issue" i
    ${requirementSortJoinFragment(sort)}
    WHERE i."projectId" = ${projectId}
      AND i."isRequirement" = true
      AND i."isDeleted" = false
      AND ${requirementEffectiveRootFragment()}
      ${cursorFragment}
    ${requirementSortOrderFragment(sort)}
    LIMIT ${limit + 1}
  `.execute(db.$qb);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor: RequirementRootsCursor | null =
    hasMore && lastRow
      ? { value: toCursorValue(lastRow.requirementSortCursor), id: lastRow.id }
      : null;

  // The sort columns are a paging mechanism, not part of the row contract --
  // stripped so `RequirementTreeRow` stays exactly what every consumer
  // (and every serialized response) already expects.
  return {
    rows: pageRows.map(
      ({ requirementSortKey: _key, requirementSortCursor: _cursor, ...row }) =>
        row
    ),
    nextCursor,
  };
}

/**
 * One node's live requirement children, in the same project, ordered the
 * same way the roots window is. Unbounded and uncursored, deliberately: a
 * page of a project's ROOTS can run into the thousands (a typed import
 * commonly produces flat hierarchies -- D-03), but one node's DIRECT
 * children are bounded by the tracker's own fan-out, which this phase
 * accepts as a known limit (T-28-08-05) rather than paging speculatively.
 * If a real project ever has a node with thousands of direct children this
 * becomes a paging problem worth revisiting -- it is not one today.
 *
 * `"projectId"` is repeated on the child row itself, not inferred from
 * `parentId` alone -- the same reasoning `requirementHasChildrenFragment`
 * documents above: a parent in another project must return nothing, even
 * when a row sharing its id as `parentId` exists (it cannot, in practice,
 * since `assertSameProject` forbids a cross-project reparent -- but this
 * query does not rely on that invariant holding elsewhere in the
 * codebase).
 *
 * Reuses `REQUIREMENT_TREE_COLUMNS` and `requirementHasChildrenFragment`
 * verbatim -- the same shared fragments the roots window composes -- so a
 * future column addition to `RequirementTreeRow` cannot reach one query
 * and miss the other.
 */
export async function getRequirementChildren(
  args: { projectId: number; parentId: number },
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<RequirementTreeRow[]> {
  const { projectId, parentId } = args;

  const { rows } = await sql<RequirementTreeRow>`
    SELECT
      ${REQUIREMENT_TREE_COLUMNS},
      ${requirementHasChildrenFragment(projectId)}
    FROM "Issue" i
    WHERE i."projectId" = ${projectId}
      AND i."parentId" = ${parentId}
      AND i."isRequirement" = true
      AND i."isDeleted" = false
    ORDER BY i.name, i.id
  `.execute(db.$qb);

  return rows;
}

// ---------------------------------------------------------------------------
// 28-09 (SCALE-02, D-04/D-05): server-side filtering with a pruned-tree-plus-
// ancestors response. `computeVisibleRequirementIds`
// (app/[locale]/projects/requirements/[projectId]/requirementsListRows.ts:
// 235-365) is this module's SPECIFICATION -- it is NOT edited by this phase
// and must not be: it is the executable oracle the live-DB parity suite
// checks this SQL against, and it keeps pinning the four axes' semantics in
// TypeScript for a future reader even after 28-14 removes its call site.
// ---------------------------------------------------------------------------

/**
 * The requirements list's four independently-activatable filter axes,
 * server-side (28-CONTEXT D-04). Status and source are MULTI-SELECT, so
 * `[]` means "not filtering on this axis" and a non-empty array UNIONs its
 * own values -- mirroring `RequirementListFilters`'s own convention in
 * `requirementsListRows.ts`, which this module's SQL is the translation of.
 * `search` stays a single string ("" is inactive): it is one text box, not
 * a facet list. Coverage is NOT a field on this type -- it arrives as a
 * separately pre-computed id list (`resolveRequirementMatches`'s own
 * `coverageMatchIds` argument), because resolving it requires
 * `getRequirementCoverage`'s whole-project rollup, which needs the
 * CALLER's project scope, not this module's (this module still takes no
 * session and performs no authorization -- see this file's own header).
 */
export interface RequirementTreeFilterAxes {
  search: string;
  status: string[];
  source: ("MANUAL" | "SYNCED" | "DETACHED")[];
}

/**
 * One page of the requirements list's server-side filter/search result
 * (28-CONTEXT D-04/D-05, SCALE-02): the matches themselves, their complete
 * ancestor chains (so every match is reachable, never partially -- see
 * `resolveAncestorIds` below), a same-statement total (so "x of y" can
 * report the true match count across every page, not just this one), and a
 * flag telling the caller whether a match's own subtree should stay
 * browsable (D-05's text-only exception).
 */
export interface RequirementMatchPage {
  matchedTotal: number;
  matchedIds: number[];
  ancestorIds: number[];
  /** `matchedIds` rows plus `ancestorIds` rows when `include === "rows"`;
   *  always `[]` when `include === "ids"` -- the below-threshold caller
   *  already holds every row in memory and needs only the id sets. */
  rows: RequirementTreeRow[];
  nextCursor: RequirementRootsCursor | null;
  expandMatchedSubtrees: boolean;
}

/**
 * `.includes()` (`computeVisibleRequirementIds`'s own text-match check,
 * `requirementsListRows.ts:249`, `requirement.name.toLowerCase().includes(
 * normalizedFilter)`) has no wildcards; ILIKE's `%`/`_` do, and its default
 * escape character is a bare backslash. Escaping `\` FIRST -- before `%`
 * and `_` -- is what keeps a user-typed literal backslash from
 * re-escaping the very characters the next two replacements introduce.
 * Leaving these three characters live would let a search for e.g. `100%`
 * match every row (T-28-09-02): a correctness regression from today's
 * substring semantics, not merely a hardening measure.
 */
function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Wraps an already-escaped term for a substring ILIKE match, mirroring
 *  `.includes()`'s own unanchored-both-ends semantics. */
function wrapLikeTerm(term: string): string {
  return `%${escapeLikeTerm(term)}%`;
}

/**
 * Line-for-line SQL translation of `resolveRequirementDisplayStatus`
 * (utils/issueDisplayText.ts:89-99):
 *
 *   export function resolveRequirementDisplayStatus(row) {
 *     return isRequirementLocked(row)
 *       ? (row.externalStatus ?? row.status ?? null)
 *       : (row.status ?? row.externalStatus ?? null);
 *   }
 *
 * ...composed with `isRequirementLocked`
 * (lib/services/linkedIssueUpsert.ts:46-53):
 *
 *   export function isRequirementLocked(row) {
 *     if (!row) return false;
 *     return (
 *       row.isRequirement === true &&
 *       row.integrationId != null &&
 *       row.requirementDetachedAt == null
 *     );
 *   }
 *
 * `i."isRequirement" = true` is already guaranteed by every caller's own
 * outer WHERE clause, but this CASE expression repeats it anyway so it
 * reads as a complete, standalone translation of the lock predicate rather
 * than one that silently depends on a WHERE clause the reader has to find
 * elsewhere in the file. When this SQL and the TypeScript it mirrors
 * drift, the person reading the SQL needs to see what it was supposed to
 * match -- that is what the comment above is for.
 */
const REQUIREMENT_DISPLAY_STATUS_CASE = sql`
  CASE
    WHEN i."isRequirement" = true
      AND i."integrationId" IS NOT NULL
      AND i."requirementDetachedAt" IS NULL
    THEN COALESCE(i."externalStatus", i.status)
    ELSE COALESCE(i.status, i."externalStatus")
  END
`;

/**
 * The priority twin: line-for-line SQL translation of
 * `resolveRequirementDisplayPriority` (utils/issueDisplayText.ts), same
 * lock predicate as the status CASE above — the three expressions must
 * not drift.
 */
const REQUIREMENT_DISPLAY_PRIORITY_CASE = sql`
  CASE
    WHEN i."isRequirement" = true
      AND i."integrationId" IS NOT NULL
      AND i."requirementDetachedAt" IS NULL
    THEN COALESCE(i."externalPriority", i.priority)
    ELSE COALESCE(i.priority, i."externalPriority")
  END
`;

/**
 * SQL translation of `requirementSourceSortValue`
 * (requirementsListRows.ts:451-455):
 *
 *   export function requirementSourceSortValue(requirement) {
 *     if (requirement.integrationId == null) return 0;
 *     if (requirement.requirementDetachedAt != null) return 1;
 *     return 2;
 *   }
 *
 * ...re-expressed as the three-way filter value
 * `matchesRequirementSourceFilter` compares against
 * (`SOURCE_FILTER_BY_RANK`, same file, lines 199-203) rather than that
 * function's own 0/1/2 ranking: 0 -> "MANUAL", 1 -> "DETACHED",
 * 2 -> "SYNCED".
 */
const REQUIREMENT_SOURCE_CASE = sql`
  CASE
    WHEN i."integrationId" IS NULL THEN 'MANUAL'
    WHEN i."requirementDetachedAt" IS NOT NULL THEN 'DETACHED'
    ELSE 'SYNCED'
  END
`;

// ---------------------------------------------------------------------------
// Server-side sorting (SCALE-02 follow-up). Sorting used to happen entirely
// in the browser, over the rows already loaded -- which meant that above the
// lazy threshold "sort by coverage descending" ordered the loaded WINDOW, not
// the project. On a 4,727-root project the most-covered requirement simply
// never appeared, because it sorted past the first page by NAME and had never
// been fetched (operator report: "Coverage sorting doesn't seem to work").
// Ordering therefore has to move into the same statement that pages the rows.
// ---------------------------------------------------------------------------

/**
 * SQL translation of `formatIssueDisplayText` (utils/issueDisplayText.ts)
 * composed with `hasDistinctIssueTitle`:
 *
 *   hasDistinctIssueTitle = Boolean(externalUrl && title && title !== name)
 *   formatIssueDisplayText = hasDistinct ? `${name}: ${title}` : name
 *
 * The name column sorts on the DISPLAYED string, not on `i.name`, because
 * that is what `compareRequirements`'s own `name` case compares and what the
 * reader actually sees in the cell. `Boolean("")` is false in JS, so the
 * empty-string checks below are part of the translation, not defensiveness.
 */
const REQUIREMENT_DISPLAY_TEXT_CASE = sql`
  CASE
    WHEN i."externalUrl" IS NOT NULL AND i."externalUrl" <> ''
      AND i.title IS NOT NULL AND i.title <> ''
      AND i.title <> i.name
    THEN i.name || ': ' || i.title
    ELSE i.name
  END
`;

/**
 * `requirementSourceSortValue`'s own 0/1/2 ranking (Native, Detached,
 * Synced) in SQL -- the RANK, not the label, because the client comparator
 * orders by that rank and 'DETACHED' < 'MANUAL' < 'SYNCED' alphabetically
 * would disagree with it.
 */
const REQUIREMENT_SOURCE_RANK_CASE = sql`
  CASE
    WHEN i."integrationId" IS NULL THEN 0
    WHEN i."requirementDetachedAt" IS NOT NULL THEN 1
    ELSE 2
  END
`;

/**
 * One sortable column's ORDER BY expression plus the cast its keyset cursor
 * needs.
 *
 * EVERY expression is total (never null). That is not cosmetic: the keyset
 * predicate is a row comparison, and SQL row comparison against a NULL
 * yields NULL rather than true/false, which would silently drop rows from
 * page two onward. Coalescing at the descriptor means the cursor value a
 * page hands back is always a real, comparable value, and the one rule
 * below ("compare the tuple") holds for every column without per-column
 * null branches.
 *
 * The coalesce targets match the client comparator's own null handling:
 * `priority`/`status` compare as `""` there
 * (`(a.priority ?? "").localeCompare(...)`), and an absent coverage
 * breakdown is `-1` (`requirementCoverageSortValue`).
 */
interface RequirementSortDescriptor {
  expr: RawBuilder<unknown>;
  cast: "text" | "numeric" | "timestamptz";
}

function requirementSortDescriptor(
  sort: RequirementTreeSort
): RequirementSortDescriptor {
  switch (sort.column) {
    case "status":
      return {
        expr: sql`COALESCE(${REQUIREMENT_DISPLAY_STATUS_CASE}, '')`,
        cast: "text",
      };
    case "priority":
      return {
        expr: sql`COALESCE(${REQUIREMENT_DISPLAY_PRIORITY_CASE}, '')`,
        cast: "text",
      };
    case "source":
      return { expr: REQUIREMENT_SOURCE_RANK_CASE, cast: "numeric" };
    case "createdAt":
      return { expr: sql`i."createdAt"`, cast: "timestamptz" };
    case "coverage":
    case "linkedCases":
    case "coveringCases": {
      // Joined in as `req_sort_value` by `requirementSortJoinFragment`
      // below; `-1` is the "no breakdown" sentinel, matching
      // `requirementCoverageSortValue`'s own absent-breakdown return.
      return {
        expr: sql`COALESCE(req_sort.value, -1)`,
        cast: "numeric",
      };
    }
    case "name":
    default:
      return { expr: REQUIREMENT_DISPLAY_TEXT_CASE, cast: "text" };
  }
}

/**
 * The LEFT JOIN that supplies a coverage-derived column's per-requirement
 * sort value, or an empty fragment for every other column.
 *
 * `unnest(ids, values)` turns the caller's two parallel arrays into a
 * two-column relation in one bind, rather than a generated VALUES list
 * whose length would change the statement text on every call (and so defeat
 * the plan cache). LEFT, never INNER: a requirement missing from the rollup
 * must still appear in the page, sorted at the `-1` sentinel, not vanish.
 */
function requirementSortJoinFragment(
  sort: RequirementTreeSort
): RawBuilder<unknown> {
  if (!COVERAGE_DERIVED_SORT_COLUMNS.includes(sort.column)) return sql``;
  const ids = sort.coverageValues?.ids ?? [];
  const values = sort.coverageValues?.values ?? [];
  return sql`
    LEFT JOIN unnest(${ids}::int[], ${values}::double precision[])
      AS req_sort(id, value) ON req_sort.id = i.id
  `;
}

/**
 * `ORDER BY <expr> <dir>, i.id <dir>`.
 *
 * `id` is part of the ORDER BY, not merely a tie-break in spirit: the
 * keyset predicate below compares the `(expr, id)` TUPLE, and a tuple
 * comparison is only a valid page boundary when the ordering matches it
 * exactly. Both members carry the same direction for that reason -- an
 * ascending `id` under a descending sort value would make the tuple
 * comparison and the ordering disagree, and rows would be skipped.
 *
 * This deliberately differs from `compareRequirements`'s client-side
 * tie-break (name then id, always ascending even under desc): that
 * comparator sorts a small sibling group already in hand, where a stable
 * tie order costs nothing. A keyset pager cannot use a tie-break that runs
 * opposite to its own ordering.
 */
function requirementSortOrderFragment(
  sort: RequirementTreeSort
): RawBuilder<unknown> {
  const { expr } = requirementSortDescriptor(sort);
  return sort.direction === "desc"
    ? sql`ORDER BY ${expr} DESC, i.id DESC`
    : sql`ORDER BY ${expr} ASC, i.id ASC`;
}

/**
 * The keyset predicate for a cursor, as a bare boolean expression (the
 * caller supplies its own `AND`/`WHERE`). `>` for ascending, `<` for
 * descending -- "everything after the row you last saw, in the direction
 * this page is walking".
 */
function requirementSortCursorFragment(
  sort: RequirementTreeSort,
  cursor: RequirementRootsCursor
): RawBuilder<unknown> {
  const { expr } = requirementSortDescriptor(sort);
  const value = boundCursorValue(sort, cursor);
  return sort.direction === "desc"
    ? sql`(${expr}, i.id) < (${value}, ${cursor.id})`
    : sql`(${expr}, i.id) > (${value}, ${cursor.id})`;
}

/** The cursor's own value, bound and cast to the type its sort column
 *  compares in. Shared by the two cursor fragments so a column's cast is
 *  written once. */
function boundCursorValue(
  sort: RequirementTreeSort,
  cursor: RequirementRootsCursor
): RawBuilder<unknown> {
  const { cast } = requirementSortDescriptor(sort);
  if (cast === "numeric") {
    return sql`${Number(cursor.value)}::double precision`;
  }
  if (cast === "timestamptz") {
    return sql`${String(cursor.value)}::timestamptz`;
  }
  return sql`${String(cursor.value)}::text`;
}

/**
 * The ORDER BY / keyset pair for a statement that reads the sort key back
 * as an ALREADY-SELECTED column rather than re-evaluating its expression.
 *
 * `resolveRequirementMatches` needs this: its `i` alias lives inside the
 * `matches` CTE, so the outer SELECT that applies the cursor and the page
 * size cannot reference the expression at all -- only the key the CTE
 * already projected. Same ordering, same comparison, one level up.
 */
function requirementSortKeyOrderFragment(
  sort: RequirementTreeSort
): RawBuilder<unknown> {
  return sort.direction === "desc"
    ? sql`ORDER BY "requirementSortKey" DESC, id DESC`
    : sql`ORDER BY "requirementSortKey" ASC, id ASC`;
}

function requirementSortKeyCursorFragment(
  sort: RequirementTreeSort,
  cursor: RequirementRootsCursor
): RawBuilder<unknown> {
  const value = boundCursorValue(sort, cursor);
  return sort.direction === "desc"
    ? sql`("requirementSortKey", id) < (${value}, ${cursor.id})`
    : sql`("requirementSortKey", id) > (${value}, ${cursor.id})`;
}

/**
 * The sort value a page hands back as the next cursor. Selected as its own
 * aliased column rather than re-derived in JS from the row: re-deriving would
 * mean a SECOND implementation of every expression above, and the two would
 * drift the moment one changed.
 *
 * TWO columns, not one, because ordering and cursoring want different types
 * of the same value:
 *
 * `requirementSortKey` keeps the descriptor's own type. The matches-CTE path
 * both ORDERs BY and cursor-compares this alias, and those have to happen in
 * the column's real type -- a timestamp compared as text would be at the
 * mercy of the database's collation, and an ICU collation may treat the `-`
 * and `:` in an ISO timestamp as ignorable punctuation rather than ordering
 * on them.
 *
 * `requirementSortCursor` is that same value rendered LOSSLESSLY for the
 * round trip out to a caller and back. It exists for `timestamptz`:
 * `Issue.createdAt` is `@db.Timestamptz(6)` and so carries microseconds,
 * while the driver maps a timestamp to a JS `Date`, whose `toISOString()`
 * has only millisecond resolution. Handing that truncated value back as a
 * cursor makes the next page's `>` comparison match the boundary row all
 * over again -- the page repeats, its cursor is unchanged, and an ascending
 * `createdAt` walk never terminates. `to_char(... 'US' ...)` keeps all six
 * digits, and `boundCursorValue`'s `::timestamptz` parses them back exactly.
 */
function requirementSortKeyFragment(
  sort: RequirementTreeSort
): RawBuilder<unknown> {
  const { expr, cast } = requirementSortDescriptor(sort);
  const cursorExpr =
    cast === "timestamptz"
      ? sql`to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      : expr;
  return sql`${expr} AS "requirementSortKey", ${cursorExpr} AS "requirementSortCursor"`;
}

/** A row as it comes back from a sorted page, before the sort columns are
 *  stripped off for the caller. */
type SortedRequirementRow = RequirementTreeRow & {
  requirementSortKey: string | number | Date | null;
  requirementSortCursor: string | number | null;
};

/** Normalizes the selected cursor column into the cursor's own value type.
 *  Never sees a `Date`: `requirementSortKeyFragment` renders a timestamp to
 *  text in SQL precisely so the driver's millisecond-resolution `Date`
 *  mapping is never on this path. */
function toCursorValue(key: SortedRequirementRow["requirementSortCursor"]) {
  if (typeof key === "number") return key;
  return String(key ?? "");
}

/**
 * ANDs an array of SQL fragments together, left to right -- the adapters'
 * own optional-clause-array idiom (28-RESEARCH Q1's own phrase for the
 * pattern every `searchIssues` implementation already uses), translated to
 * Kysely fragment composition: one place to add a fifth axis later, and
 * each axis independently testable/removable without touching the others.
 *
 * Never joined with OR. `computeVisibleRequirementIds`'s own comment
 * (requirementsListRows.ts:297-301) explains why a union would be wrong
 * here -- it would surface a covered requirement the instant someone typed
 * in the search box, the opposite of "show me the gaps" -- and this
 * function is this SQL's ONE intersection point: the whole blast radius of
 * "AND" silently becoming "OR" is the one line below, which is deliberate
 * (see this file's own mutation-proof test for the consequence of
 * flipping it).
 */
function andAll(fragments: RawBuilder<unknown>[]): RawBuilder<unknown> {
  return fragments.reduce((acc, fragment, index) =>
    index === 0 ? fragment : sql`${acc} AND ${fragment}`
  );
}

/** One row of the ancestor-closure walk (`resolveAncestorIds`). */
interface AncestorRow {
  id: number;
}

/**
 * The ancestor chain of a whole PAGE of matches, in one round trip --
 * generalized from `assertNoCycle`'s proven walk direction
 * (requirementHierarchy.ts:184-208: seed a row's own parentId, then
 * re-join `i.id = a.id` to read THAT row's own parentId one level
 * further up) from one seed id to the page's whole matched-id array at
 * once, per 28-RESEARCH Q5's own warning that the naive self-join
 * direction is easy to get backwards.
 *
 * Self-scoped at EVERY level, unlike `assertNoCycle` (which is
 * deliberately role-agnostic, since a cycle in ANY issue kind must be
 * caught): each row this walk emits must itself be a live, project-scoped
 * requirement before it joins the chain, mirroring
 * `getRequirementSubtreeIds`'s own "the row being emitted carries its own
 * classification check" discipline rather than merely checking the seed
 * row's classification. A match whose immediate parent is not itself a
 * requirement-classified row (Jira sync writes `parentId` for every
 * synced issue regardless of classification) stops there -- exactly where
 * `computeVisibleRequirementIds`'s own `requirementMap.get(current)` walk
 * stops too, since that map only ever holds classified rows.
 *
 * `depth < 100` caps the walk for the same reason every sibling CTE in
 * this file family caps it: an unguarded recursive CTE over cyclic data
 * hangs rather than erroring. The final `WHERE NOT (id = ANY(...))`
 * excludes any id already present in `matchedIds` -- a match that is
 * itself the parent of a different match must never come back as its own
 * "ancestor" (`matchedIds`/`ancestorIds` must stay disjoint).
 */
/** One ancestor row, as the breadcrumb renders it. */
export interface RequirementAncestorRow {
  id: number;
  name: string;
  title: string;
  externalUrl: string | null;
}

/**
 * The chain of requirement-classified parents above one requirement,
 * OUTERMOST FIRST -- the order a breadcrumb reads in.
 *
 * Separate from `resolveAncestorIds` above, which answers a different
 * question for the filtered list: that one takes MANY seeds, returns a
 * DISTINCT unordered id set, and excludes ids that are themselves matches.
 * A breadcrumb needs exactly the opposite -- one seed, ordered, with the
 * columns needed to render a label -- so the two share the walk's shape and
 * its guards but not its result.
 *
 * The same classification rule the sibling walk uses: a parent that is not
 * itself a requirement-classified row ends the chain, because Jira sync
 * writes `parentId` on every synced issue regardless of classification. And
 * the same `depth < 100` cap, for the same reason -- an unguarded recursive
 * CTE over cyclic data hangs rather than errors.
 */
export async function getRequirementAncestorChain(
  projectId: number,
  requirementId: number,
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<RequirementAncestorRow[]> {
  const { rows } = await sql<RequirementAncestorRow & { depth: number }>`
    WITH RECURSIVE ancestors AS (
      SELECT parent.id, parent."parentId", parent.name, parent.title,
             parent."externalUrl", 1 AS depth
      FROM "Issue" seed
      JOIN "Issue" parent ON parent.id = seed."parentId"
      WHERE seed.id = ${requirementId}
        AND seed."projectId" = ${projectId}
        AND parent."projectId" = ${projectId}
        AND parent."isRequirement" = true
        AND parent."isDeleted" = false

      UNION ALL

      SELECT next.id, next."parentId", next.name, next.title,
             next."externalUrl", a.depth + 1
      FROM "Issue" next
      INNER JOIN ancestors a ON next.id = a."parentId"
      WHERE next."projectId" = ${projectId}
        AND next."isRequirement" = true
        AND next."isDeleted" = false
        AND a.depth < 100
    )
    SELECT id, name, title, "externalUrl"
    FROM ancestors
    ORDER BY depth DESC
  `.execute(db.$qb);
  return rows.map(({ id, name, title, externalUrl }) => ({
    id,
    name,
    title,
    externalUrl,
  }));
}

async function resolveAncestorIds(
  projectId: number,
  matchedIds: number[],
  db: Pick<typeof baseDb, "$qb">
): Promise<number[]> {
  const { rows } = await sql<AncestorRow>`
    WITH RECURSIVE ancestors AS (
      SELECT parent.id, parent."parentId", 1 AS depth
      FROM "Issue" m
      JOIN "Issue" parent ON parent.id = m."parentId"
      WHERE m.id = ANY(${matchedIds}::int[])
        AND parent."projectId" = ${projectId}
        AND parent."isRequirement" = true
        AND parent."isDeleted" = false

      UNION ALL

      SELECT next.id, next."parentId", a.depth + 1
      FROM "Issue" next
      INNER JOIN ancestors a ON next.id = a."parentId"
      WHERE next."projectId" = ${projectId}
        AND next."isRequirement" = true
        AND next."isDeleted" = false
        AND a.depth < 100
    )
    SELECT DISTINCT id FROM ancestors WHERE NOT (id = ANY(${matchedIds}::int[]))
  `.execute(db.$qb);
  return rows.map((row) => row.id);
}

/**
 * Hydrates the full `RequirementTreeRow` shape for a page's matches plus
 * their ancestor chain -- reuses `REQUIREMENT_TREE_COLUMNS` and
 * `requirementHasChildrenFragment` verbatim, the same shared fragments the
 * roots window and the children query already compose, so a future column
 * addition to `RequirementTreeRow` cannot reach one query and miss
 * another. Skipped entirely when `include: "ids"` (`resolveRequirementMatches`
 * never calls this function in that mode) -- the below-threshold caller
 * already holds every row in memory and needs only the id sets.
 */
async function hydrateMatchAndAncestorRows(
  projectId: number,
  matchedIds: number[],
  ancestorIds: number[],
  db: Pick<typeof baseDb, "$qb">
): Promise<RequirementTreeRow[]> {
  const ids = [...matchedIds, ...ancestorIds];
  if (ids.length === 0) return [];

  const { rows } = await sql<RequirementTreeRow>`
    SELECT
      ${REQUIREMENT_TREE_COLUMNS},
      ${requirementHasChildrenFragment(projectId)}
    FROM "Issue" i
    WHERE i.id = ANY(${ids}::int[])
      AND i."projectId" = ${projectId}
      AND i."isRequirement" = true
      AND i."isDeleted" = false
    ORDER BY i.name, i.id
  `.execute(db.$qb);

  return rows;
}

/**
 * Resolves the requirements list's four filter axes server-side
 * (28-CONTEXT D-04), reproducing `computeVisibleRequirementIds`'s exact
 * match/ancestor/descendant-flag semantics as a paged, counted match set
 * with its ancestor chains:
 *
 * - Text, status and source are evaluated in SQL; coverage arrives
 *   pre-computed as `coverageMatchIds` (an id list) -- see this function's
 *   own argument doc below for why.
 * - Active axes intersect (`andAll` above), never union.
 * - `coverageMatchIds === null` means the axis is INACTIVE (unset, not yet
 *   loaded, or errored) -- the oracle's own "degrades to inactive" rule,
 *   so a coverage outage can never blank the other three axes' results. A
 *   non-null EMPTY array is a fully active axis that matches nothing --
 *   the two must never collapse into one behavior (T-28-09's own
 *   empty-coverage-array distinction).
 * - `matchedTotal` and the page come from ONE statement (`COUNT(*) OVER
 *   ()`), never a second `COUNT` query that could disagree with the page
 *   under concurrent writes.
 * - The ancestor chain is resolved for the WHOLE PAGE's matched ids in one
 *   additional round trip (`resolveAncestorIds`), never per-match.
 * - Calling this with no active axis at all (every string axis empty AND
 *   `coverageMatchIds === null`) is a caller error, not an unfiltered
 *   read -- that read is `getRequirementRootsPage`'s job, and silently
 *   falling back to it here would hide a caller bug that forgot to check
 *   its own "is any filter active" condition before reaching for this
 *   function.
 */
export async function resolveRequirementMatches(
  args: {
    projectId: number;
    axes: RequirementTreeFilterAxes;
    /**
     * A pre-computed coverage match id list, or `null` when the axis is
     * inactive. Computing coverage requires `getRequirementCoverage`'s
     * whole-project rollup, which needs the CALLER's resolved project
     * scope (`accessibleProjectIds`) -- this module still takes no
     * session and performs no authorization, matching every sibling
     * function in this file, so it cannot compute that rollup itself.
     */
    coverageMatchIds: number[] | null;
    limit: number;
    cursor?: RequirementRootsCursor | null;
    include: "ids" | "rows";
    /** Defaults to name ascending — the order this page shipped with. */
    sort?: RequirementTreeSort;
  },
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<RequirementMatchPage> {
  const {
    projectId,
    axes,
    coverageMatchIds,
    limit,
    cursor,
    include,
    sort = DEFAULT_REQUIREMENT_SORT,
  } = args;

  // `!== null`, deliberately never a truthy/`.length` check: a non-null
  // empty array is still an ACTIVE axis (see this function's own doc
  // comment above) -- a mutation to a truthy check is exactly what this
  // file's structural test guards against.
  const coverageAxisActive = coverageMatchIds !== null;

  const axisFragments: RawBuilder<unknown>[] = [];
  if (axes.search !== "") {
    // Bound to a local first (rather than interpolating the property
    // access directly) so the parameter this template binds is
    // unambiguously the escaped/wrapped VALUE, never raw user input.
    const likeTerm = wrapLikeTerm(axes.search);
    // Name OR title -- see `computeVisibleRequirementIds`'s own comment for
    // why both: `name` is a synced requirement's tracker key, `title` its
    // summary, and the list renders them together. The two must agree, since
    // the live-DB parity suite measures this SQL against that function.
    axisFragments.push(
      sql`(i.name ILIKE ${likeTerm} OR i.title ILIKE ${likeTerm})`
    );
  }
  // `= ANY(...::text[])` is the multi-select translation of
  // `matchesRequirementStatusFilters`/`matchesRequirementSourceFilters`'s
  // own `.includes()`: WITHIN one axis the selected values union, which is
  // what a multi-select reads as. The axes still AND together through
  // `andAll` below -- that asymmetry is the whole point and is spelled out
  // in `andAll`'s own doc comment.
  if (axes.status.length > 0) {
    const statuses = axes.status;
    axisFragments.push(
      sql`(${REQUIREMENT_DISPLAY_STATUS_CASE}) = ANY(${statuses}::text[])`
    );
  }
  if (axes.source.length > 0) {
    const sources = axes.source;
    axisFragments.push(
      sql`(${REQUIREMENT_SOURCE_CASE}) = ANY(${sources}::text[])`
    );
  }
  if (coverageAxisActive) {
    axisFragments.push(sql`i.id = ANY(${coverageMatchIds}::int[])`);
  }

  if (axisFragments.length === 0) {
    throw new Error(
      "resolveRequirementMatches: at least one filter axis must be active -- an unfiltered read is getRequirementRootsPage's job"
    );
  }

  // The cursor restriction is applied OUTSIDE the `matches` CTE, never
  // folded into the same WHERE clause `COUNT(*) OVER ()` counts over --
  // a real-Postgres bug this file's own live-DB suite caught: with the
  // cursor predicate in the SAME WHERE clause, `matchedTotal` reported only
  // the REMAINING rows past the cursor (10 total, then 7 on page 2, one
  // page's worth fewer each time), not the true total across every page. A
  // mocked unit test cannot catch this -- it never runs the two clauses
  // through a real query planner, only returns whatever rows a test hands
  // it back verbatim. `matches` computes the axis intersection once;
  // `counted` windows `COUNT(*) OVER ()` over that WHOLE set BEFORE any
  // cursor trimming; the outer SELECT applies the cursor and the page
  // LIMIT last, against `counted`'s own (already-computed) matchedTotal.
  const cursorFragment = cursor
    ? sql`WHERE ${requirementSortKeyCursorFragment(sort, cursor)}`
    : sql``;

  const { rows } = await sql<
    SortedRequirementRow & { matchedTotal: number | bigint }
  >`
    WITH matches AS (
      SELECT
        ${REQUIREMENT_TREE_COLUMNS},
        ${requirementHasChildrenFragment(projectId)},
        ${requirementSortKeyFragment(sort)}
      FROM "Issue" i
      ${requirementSortJoinFragment(sort)}
      WHERE i."projectId" = ${projectId}
        AND i."isRequirement" = true
        AND i."isDeleted" = false
        AND (${andAll(axisFragments)})
    ),
    counted AS (
      SELECT *, COUNT(*) OVER ()::int AS "matchedTotal" FROM matches
    )
    SELECT * FROM counted
    ${cursorFragment}
    ${requirementSortKeyOrderFragment(sort)}
    LIMIT ${limit + 1}
  `.execute(db.$qb);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor: RequirementRootsCursor | null =
    hasMore && lastRow
      ? { value: toCursorValue(lastRow.requirementSortCursor), id: lastRow.id }
      : null;

  const matchedTotal = Number(rows[0]?.matchedTotal ?? 0);
  const matchedIds = pageRows.map((row) => row.id);

  const ancestorIds =
    matchedIds.length > 0
      ? await resolveAncestorIds(projectId, matchedIds, db)
      : [];

  // The direct translation of the oracle's own `nonTextAxisActive` flag
  // (requirementsListRows.ts:349-350), inverted: browsable-subtree
  // expansion is allowed ONLY when text is the sole active axis.
  const expandMatchedSubtrees =
    !coverageAxisActive &&
    axes.status.length === 0 &&
    axes.source.length === 0 &&
    axes.search !== "";

  const hydratedRows =
    include === "rows"
      ? await hydrateMatchAndAncestorRows(
          projectId,
          matchedIds,
          ancestorIds,
          db
        )
      : [];

  return {
    matchedTotal,
    matchedIds,
    ancestorIds,
    rows: hydratedRows,
    nextCursor,
    expandMatchedSubtrees,
  };
}

// ---------------------------------------------------------------------------
// 28-19 (SCALE-02 gap closure): the requirements list's two dynamic filter
// Selects (Status/Coverage) served server-side. `collectRequirementStatusOptions`/
// `collectCoverageStatusOptions` (requirementsListRows.ts) both read the
// all-mode-only in-memory `requirements` array, which lazy mode never
// populates -- above the threshold both Selects rendered empty (defect A).
// This is NOT a second specification: the status axis reuses
// `REQUIREMENT_DISPLAY_STATUS_CASE` verbatim (the same expression
// `resolveRequirementMatches` already uses for its own status axis, itself a
// line-for-line translation of `resolveRequirementDisplayStatus`), and the
// coverage axis reuses `getRequirementCoverage` -- the SAME whole-project
// rollup `useRequirementCoverage`/the below-threshold collector both read --
// rather than recomputing coverage in SQL.
// ---------------------------------------------------------------------------

/** The requirements list's two dynamic Selects' option source, computed
 *  server-side. `statuses` matches `collectRequirementStatusOptions`'s own
 *  output type (`string[]`, case-insensitively de-duplicated and sorted);
 *  `coverageStatuses` matches `collectCoverageStatusOptions`'s own output
 *  type (`RequirementCoverageStatusCount[]`, summed by statusId and sorted
 *  by count descending) -- so the caller's Select props never change shape
 *  by mode. */
export interface RequirementFilterFacets {
  statuses: string[];
  coverageStatuses: RequirementCoverageStatusCount[];
}

/**
 * The project's distinct requirement statuses (under the lock-aware
 * display-status precedence) and its coverage states -- scoped, computed
 * server-side (28-19, SCALE-02's fourth success criterion).
 *
 * Status: `SELECT DISTINCT` over `REQUIREMENT_DISPLAY_STATUS_CASE`, scoped by
 * project, `ISSUE_ROLE_SCOPE_SQL_REQUIREMENT` (this constant's first real
 * consumer -- every other role-scope predicate in this file was written
 * inline before this module had a raw-SQL caller of the shared mirror), and
 * `isDeleted = false`. De-duplicated case-insensitively (first-seen casing
 * kept) and sorted case-insensitively in JS, mirroring
 * `collectRequirementStatusOptions`'s own algorithm exactly so the two modes
 * present the same order.
 *
 * Coverage: NOT recomputed in SQL. Calls `getRequirementCoverage` for the
 * WHOLE project (no `rootIds`, matching the `/coverage` route's own
 * deliberate whole-project scope) and aggregates its per-requirement
 * `statuses[]` across every classified row, matching
 * `collectCoverageStatusOptions`'s own reducer (sum counts per statusId,
 * drop non-positive entries -- defensive, since the rollup's own producer
 * already never emits one -- sort by count descending). A rollup failure
 * degrades to an empty coverage facet (mirroring
 * `collectCoverageStatusOptions`'s own `if (!coverage) return []` rule)
 * rather than failing the whole facet response: the status facet, which
 * needs no coverage data at all, must never go dark because the coverage
 * rollup did.
 */
export async function getRequirementFilterFacets(
  args: {
    projectId: number;
    coverageScope: RequirementCoverageScope;
  },
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<RequirementFilterFacets> {
  const { projectId, coverageScope } = args;

  const { rows } = await sql<{ status: string | null }>`
    SELECT DISTINCT (${REQUIREMENT_DISPLAY_STATUS_CASE}) AS status
    FROM "Issue" i
    WHERE i."projectId" = ${projectId}
      ${sql.raw(ISSUE_ROLE_SCOPE_SQL_REQUIREMENT)}
      AND i."isDeleted" = false
  `.execute(db.$qb);

  // Case-insensitive de-dupe, first-seen casing kept, sorted
  // case-insensitively -- verbatim to `collectRequirementStatusOptions`'s
  // own algorithm (requirementsListRows.ts), so the two modes present the
  // same values in the same order.
  const seenStatuses = new Map<string, string>();
  rows.forEach((row) => {
    const value = row.status;
    if (value && value.trim() !== "") {
      const lower = value.toLowerCase();
      if (!seenStatuses.has(lower)) seenStatuses.set(lower, value);
    }
  });
  const statuses = Array.from(seenStatuses.values()).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  let coverageStatuses: RequirementCoverageStatusCount[] = [];
  try {
    const coverage = await getRequirementCoverage(
      projectId,
      coverageScope,
      undefined,
      db
    );
    const byStatus = new Map<number, RequirementCoverageStatusCount>();
    for (const breakdown of coverage.values()) {
      breakdown.statuses.forEach((entry) => {
        if (entry.count <= 0) return;
        const existing = byStatus.get(entry.statusId);
        if (existing) {
          existing.count += entry.count;
        } else {
          byStatus.set(entry.statusId, { ...entry });
        }
      });
    }
    coverageStatuses = Array.from(byStatus.values()).sort(
      (a, b) => b.count - a.count
    );
  } catch (error) {
    console.error("Requirement filter facets coverage rollup error:", error);
    coverageStatuses = [];
  }

  return { statuses, coverageStatuses };
}
