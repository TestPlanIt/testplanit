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
import { sql } from "kysely";

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
