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

/** Keyset cursor for `getRequirementRootsPage`: the `(name, id)` of the
 *  last row a caller has already seen. `id` breaks every tie `name` alone
 *  could leave, so the tuple comparison below is a strict total order. */
export interface RequirementRootsCursor {
  name: string;
  id: number;
}

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
 * One keyset-paginated window of a project's requirement ROOTS
 * (`parentId IS NULL`), ordered by `(name, id)` -- stable and gap-free
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
  },
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<RequirementRootsPage> {
  const { projectId, limit, cursor } = args;

  // A real WHERE-clause fragment when a cursor is supplied, or a no-op
  // empty fragment on page one -- composed the same way
  // `requirementCoverage.ts`'s `buildClosureFragment` composes its own
  // optional `rootScope`, so a missing cursor never becomes a separate,
  // string-concatenated query branch.
  const cursorFragment = cursor
    ? sql`AND (i.name, i.id) > (${cursor.name}, ${cursor.id})`
    : sql``;

  const { rows } = await sql<RequirementTreeRow>`
    SELECT
      ${REQUIREMENT_TREE_COLUMNS},
      ${requirementHasChildrenFragment(projectId)}
    FROM "Issue" i
    WHERE i."projectId" = ${projectId}
      AND i."isRequirement" = true
      AND i."isDeleted" = false
      AND i."parentId" IS NULL
      ${cursorFragment}
    ORDER BY i.name, i.id
    LIMIT ${limit + 1}
  `.execute(db.$qb);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor: RequirementRootsCursor | null =
    hasMore && lastRow ? { name: lastRow.name, id: lastRow.id } : null;

  return { rows: pageRows, nextCursor };
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
 * server-side (28-CONTEXT D-04): `""` means "not filtering on this axis"
 * for every string field here, mirroring `RequirementListFilters`'s own
 * convention in `requirementsListRows.ts`. Coverage is NOT a field on this
 * type -- it arrives as a separately pre-computed id list
 * (`resolveRequirementMatches`'s own `coverageMatchIds` argument), because
 * resolving it requires `getRequirementCoverage`'s whole-project rollup,
 * which needs the CALLER's project scope, not this module's (this module
 * still takes no session and performs no authorization -- see this file's
 * own header).
 */
export interface RequirementTreeFilterAxes {
  search: string;
  status: string;
  source: "" | "MANUAL" | "SYNCED" | "DETACHED";
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
  },
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<RequirementMatchPage> {
  const { projectId, axes, coverageMatchIds, limit, cursor, include } = args;

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
    axisFragments.push(sql`i.name ILIKE ${likeTerm}`);
  }
  if (axes.status !== "") {
    axisFragments.push(
      sql`(${REQUIREMENT_DISPLAY_STATUS_CASE}) = ${axes.status}`
    );
  }
  if (axes.source !== "") {
    axisFragments.push(sql`(${REQUIREMENT_SOURCE_CASE}) = ${axes.source}`);
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
    ? sql`WHERE (name, id) > (${cursor.name}, ${cursor.id})`
    : sql``;

  const { rows } = await sql<
    RequirementTreeRow & { matchedTotal: number | bigint }
  >`
    WITH matches AS (
      SELECT
        ${REQUIREMENT_TREE_COLUMNS},
        ${requirementHasChildrenFragment(projectId)}
      FROM "Issue" i
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
    ORDER BY name, id
    LIMIT ${limit + 1}
  `.execute(db.$qb);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor: RequirementRootsCursor | null =
    hasMore && lastRow ? { name: lastRow.name, id: lastRow.id } : null;

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
    axes.status === "" &&
    axes.source === "" &&
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
