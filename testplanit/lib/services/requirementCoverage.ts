import { sql } from "kysely";

import { baseDb } from "~/lib/db";

import { latestCaseResultsCte } from "./latestCaseResults";

/**
 * Requirement coverage rollup (COV-01/COV-02/COV-03) — computes each
 * requirement's test coverage from the cases linked anywhere in its
 * subtree, classified failed-anywhere-wins over each case's single most
 * recent execution.
 *
 * Vocabulary (`linkedCaseCount`/`passed`/`failed`/`inProgress`/`notRun`/
 * `uncovered`) is adopted verbatim from the existing shipped per-issue
 * coverage breakdown shape elsewhere in this codebase, dropping that
 * shape's release-scoped framing, so a later UI can share one
 * coverage-chip renderer across both surfaces. Deliberately NOT carried
 * over: that shape's per-status matrix array and its untested counter —
 * those exist to drive a status-by-status breakdown table this phase has
 * no UI for yet; a later phase can add them back onto this same
 * breakdown shape if a matrix view needs them.
 *
 * "Most recent" is global and unscoped: the single latest execution a
 * covering case has ever recorded, independent of any particular release
 * window or test cycle. This is a settled scope decision for this
 * service, not a default awaiting a future filter parameter.
 *
 * A requirement's covering cases may live in projects other than the
 * requirement's own — those cases count toward the total and are also
 * reported separately via `crossProjectCaseCount`. Which projects' cases
 * may contribute at all is gated by the caller-supplied visibility scope
 * (`RequirementCoverageScope.accessibleProjectIds`); this is a
 * correctness boundary on the aggregated numbers, not an authorization
 * check — the caller remains responsible for authorizing the queried
 * project itself before calling in, matching this service family's
 * existing no-authorization-here convention.
 *
 * The hierarchical walk this rollup performs has two arms that are
 * deliberately asymmetric: only the row set a requirement anchors at is
 * scoped by role, and the walk that descends from each anchor is not. A
 * dedicated structural test elsewhere in this codebase polices that
 * asymmetry.
 */

export type RequirementCoverageStatus =
  "UNCOVERED" | "FAILED" | "NOT_RUN" | "PASSED";

export interface RequirementCoverageBreakdown {
  linkedCaseCount: number;
  /**
   * How many of `linkedCaseCount` live in projects other than the
   * requirement's own project. Measured against the requirement's own
   * project (never any other reference project), which is why this
   * counter is named independently of a similarly-shaped counter on a
   * different, release-scoped coverage computation elsewhere in this
   * codebase.
   */
  crossProjectCaseCount: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  uncovered: boolean;
  status: RequirementCoverageStatus;
}

export interface RequirementCoverageScope {
  /**
   * Projects the viewer may read. `null` means unrestricted (ADMIN). The
   * requirement's own project is NOT part of this shape — the rollup
   * already takes the project as its own argument, and duplicating it
   * here would let the two disagree.
   */
  accessibleProjectIds: number[] | null;
}

/**
 * The four-rung failed-anywhere-wins precedence ladder, evaluated over a
 * requirement's covering-case counts. Pure — no I/O, no db client — so it
 * is unit-testable on its own, independent of the query that produces the
 * counts.
 */
export function classifyRequirementCoverage(
  counts: Omit<RequirementCoverageBreakdown, "status" | "uncovered">
): RequirementCoverageStatus {
  // Rung 1 — structural: no covering cases anywhere in the subtree wins
  // first, regardless of every other counter also being zero.
  if (counts.linkedCaseCount === 0) {
    return "UNCOVERED";
  }
  // Rung 2 — one failure anywhere holds the whole requirement back, even
  // against a majority of passes.
  if (counts.failed > 0) {
    return "FAILED";
  }
  // Rung 3 — every covering case passed. This can never be reached with
  // zero linked cases: rung 1 already returned in that case, so
  // `passed === linkedCaseCount` here always means at least one real pass,
  // not a 0 === 0 coincidence that looks like a bug in review but is not.
  if (counts.passed === counts.linkedCaseCount) {
    return "PASSED";
  }
  // Rung 4 — everything else: in-progress, not-run, or a mix that never
  // failed and never fully passed.
  return "NOT_RUN";
}

/** A caller-supplied cap on `opts.rootIds` — see `getRequirementCoverage`. */
const MAX_ROOT_IDS = 1000;

/**
 * Builds the `closure` CTE — a batched, multi-root ancestor/descendant
 * walk over a project's issue tree, generalizing the shipped single-root
 * subtree walk this service family already ships elsewhere in
 * `lib/services/requirementHierarchy.ts`. Every statement in this file
 * composes this one builder, which is what keeps the role predicate below
 * at exactly one occurrence in this file even as more than one statement
 * ends up consuming it.
 *
 * Emits three columns: `ancestor_id`, `node_id`, `depth`. When `rootIds`
 * is supplied, the anchor is additionally bounded to that id list — used
 * by a future drill-down caller that wants one requirement's rollup
 * rather than every requirement in the project.
 */
function buildClosureFragment(projectId: number, rootIds?: number[]) {
  const rootScope =
    rootIds && rootIds.length > 0
      ? sql`AND i.id = ANY(${rootIds}::int[])`
      : sql``;

  return sql`
closure AS (
  -- ANCHOR: every row this file's shared role-scope predicate selects
  -- becomes its own ancestor at depth zero. The predicate on the next
  -- line is reproduced character for character from this service
  -- family's shared raw-SQL mirror for that predicate — the ONE and
  -- only occurrence of it in this whole file.
  SELECT i.id AS ancestor_id, i.id AS node_id, 0 AS depth
  FROM "Issue" i
  WHERE i."projectId" = ${projectId} AND i."isDeleted" = false AND i."isRequirement" = true
  ${rootScope}

  UNION ALL

  -- RECURSIVE ARM, deliberately UNSCOPED by that same predicate: a node
  -- beneath an anchor that does not itself carry the anchor's own role
  -- still carries its case links up to the ancestor gathered above.
  -- Scoping this arm the same way as the anchor "for consistency" would
  -- silently stop a whole class of rollups at the first such node in
  -- every subtree — a dedicated structural test elsewhere in this
  -- codebase exists specifically to catch that mistake.
  SELECT c.ancestor_id, child.id AS node_id, c.depth + 1
  FROM "Issue" child
  JOIN closure c ON child."parentId" = c.node_id
  WHERE child."projectId" = ${projectId} AND child."isDeleted" = false AND c.depth < 100
)
`;
}

/** Row shape returned by the rollup statement below, before JS-side coercion. */
interface RequirementCoverageRow {
  id: number | bigint;
  linked_case_count: number | bigint;
  cross_project_case_count: number | bigint;
  passed: number | bigint;
  failed: number | bigint;
  in_progress: number | bigint;
  not_run: number | bigint;
}

export interface GetRequirementCoverageOptions {
  /** Bound the rollup to these requirement ids only, instead of every
   * requirement in the project. Rejected when empty (short-circuits to an
   * empty result with no query) or when it exceeds `MAX_ROOT_IDS`. */
  rootIds?: number[];
}

/**
 * Computes a coverage breakdown for every requirement in a project (or,
 * with `opts.rootIds`, a bounded subset), in one statement: the closure
 * above supplies the whole-subtree walk, a DISTINCT covering-case set
 * removes double-counting across levels (COV-02), the shared latest-result
 * fragment classifies each covering case's most recent execution, and a
 * LEFT JOIN plus COALESCE turns a requirement with nothing beneath it into
 * an explicit zero row instead of an absence (COV-03) — no application-code
 * loop ever fills that gap.
 */
export async function getRequirementCoverage(
  projectId: number,
  scope: RequirementCoverageScope,
  opts?: GetRequirementCoverageOptions,
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<Map<number, RequirementCoverageBreakdown>> {
  if (!Number.isInteger(projectId)) {
    throw new Error(
      `getRequirementCoverage: projectId must be an integer, received ${String(projectId)}`
    );
  }

  if (opts?.rootIds !== undefined) {
    if (opts.rootIds.length === 0) {
      // Short-circuit: an explicitly empty root list can never produce a
      // row, and running the statement anyway would be a wasted round
      // trip for a caller that already knows the answer.
      return new Map();
    }
    if (opts.rootIds.length > MAX_ROOT_IDS) {
      throw new RangeError(
        `getRequirementCoverage: rootIds may not exceed ${MAX_ROOT_IDS} entries, received ${opts.rootIds.length}`
      );
    }
  }

  // Destructured the same way this service family's existing visibility
  // predicate is: a null scope means unrestricted (ADMIN), otherwise the
  // list is the exact set of projects allowed to contribute.
  const unrestricted = scope.accessibleProjectIds === null;
  const accessibleProjectIds = scope.accessibleProjectIds ?? [];

  const closure = buildClosureFragment(projectId, opts?.rootIds);

  const { rows } = await sql<RequirementCoverageRow>`
    WITH RECURSIVE ${closure},
    covering_cases AS (
      -- COV-02: DISTINCT collapses a case linked at both an ancestor and
      -- one of its own descendants into exactly one row for that
      -- ancestor. Carrying the case's own project alongside the case id
      -- does not weaken that guarantee — a case determines its own
      -- project, so it can never produce two distinct rows for the same
      -- (ancestor, case) pair that differ only by that column.
      SELECT DISTINCT
        cl.ancestor_id,
        rci."caseId" AS case_id,
        rc."projectId" AS case_project_id
      FROM closure cl
      JOIN "RepositoryCaseIssue" rci ON rci."issueId" = cl.node_id
      JOIN "RepositoryCases" rc
        ON rc.id = rci."caseId"
        AND rc."isDeleted" = false
        AND rc."isArchived" = false
      -- Visibility boundary on the data being aggregated (not an
      -- authorization check): applies uniformly to every case's project,
      -- including the queried project itself. Unrestricted-or-member,
      -- mirroring this service family's existing null-means-ADMIN
      -- convention.
      WHERE (${unrestricted} OR rc."projectId" = ANY(${accessibleProjectIds}::int[]))
    ),
    ${latestCaseResultsCte()},
    rollup AS (
      -- The four counters below are mutually exclusive and exhaustive
      -- over covering_cases: every row lands in exactly one of them, so
      -- they always sum to linked_case_count.
      SELECT
        cc.ancestor_id,
        COUNT(*) AS linked_case_count,
        COUNT(*) FILTER (
          WHERE cc.case_project_id <> ${projectId}
        ) AS cross_project_case_count,
        COUNT(*) FILTER (WHERE lr.is_success = true) AS passed,
        COUNT(*) FILTER (WHERE lr.is_failure = true) AS failed,
        COUNT(*) FILTER (
          WHERE lr.test_case_id IS NOT NULL
            AND lr.is_completed = true
            AND lr.is_success IS NOT true
            AND lr.is_failure IS NOT true
        ) AS in_progress,
        COUNT(*) FILTER (
          WHERE lr.test_case_id IS NULL OR lr.is_completed IS NOT true
        ) AS not_run
      FROM covering_cases cc
      LEFT JOIN latest_results lr ON lr.test_case_id = cc.case_id
      GROUP BY cc.ancestor_id
    )
    -- COV-03: rows come from the closure's own depth-zero entries — which
    -- ARE the anchor rows by construction — left-joined to the rollup
    -- above, never from a second pass over the issue table. A requirement
    -- with nothing beneath it in its subtree simply never appears in
    -- rollup; COALESCE turns that absence into a real, explicit zero
    -- row here, in the join, rather than in an application-code fill
    -- loop afterward.
    SELECT
      cl.ancestor_id AS id,
      COALESCE(r.linked_case_count, 0) AS linked_case_count,
      COALESCE(r.cross_project_case_count, 0) AS cross_project_case_count,
      COALESCE(r.passed, 0) AS passed,
      COALESCE(r.failed, 0) AS failed,
      COALESCE(r.in_progress, 0) AS in_progress,
      COALESCE(r.not_run, 0) AS not_run
    FROM closure cl
    LEFT JOIN rollup r ON r.ancestor_id = cl.ancestor_id
    WHERE cl.depth = 0
    ORDER BY cl.ancestor_id
  `.execute(db.$qb);

  const breakdowns = new Map<number, RequirementCoverageBreakdown>();
  for (const row of rows) {
    const counts = {
      linkedCaseCount: Number(row.linked_case_count ?? 0),
      crossProjectCaseCount: Number(row.cross_project_case_count ?? 0),
      passed: Number(row.passed ?? 0),
      failed: Number(row.failed ?? 0),
      inProgress: Number(row.in_progress ?? 0),
      notRun: Number(row.not_run ?? 0),
    };
    breakdowns.set(Number(row.id), {
      ...counts,
      uncovered: counts.linkedCaseCount === 0,
      status: classifyRequirementCoverage(counts),
    });
  }
  return breakdowns;
}

/** A single case covering a requirement, carrying the project it lives in
 * so a cross-project case can be badged and linked into its own project's
 * repository rather than the requirement's. */
export interface RequirementCoveringCase {
  caseId: number;
  caseName: string;
  projectId: number;
  projectName: string;
}

/** Row shape returned by the covering-case drill-down statement below,
 * before JS-side coercion. */
interface RequirementCoveringCaseRow {
  ancestor_id: number | bigint;
  case_id: number | bigint;
  case_name: string;
  case_project_id: number | bigint;
  project_name: string;
}

/**
 * Lists the individual cases covering a bounded set of requirements — the
 * per-case counterpart to `getRequirementCoverage`'s counts. Composes the
 * SAME closure builder above, bounded to `requirementIds` as its root-id
 * list, so this drill-down can never resolve a different covering-case set
 * than the rollup whose numbers it sits beneath.
 *
 * Each returned case carries its own project id and project name — a
 * covering case may live in a project other than the requirement's own
 * (see `RequirementCoverageBreakdown.crossProjectCaseCount`), and a later
 * phase needs both fields to badge that case and link into its own
 * project's repository rather than the requirement's.
 */
export async function getRequirementCoveringCases(
  projectId: number,
  requirementIds: number[],
  scope: RequirementCoverageScope,
  db: Pick<typeof baseDb, "$qb"> = baseDb
): Promise<Map<number, RequirementCoveringCase[]>> {
  if (!Number.isInteger(projectId)) {
    throw new Error(
      `getRequirementCoveringCases: projectId must be an integer, received ${String(projectId)}`
    );
  }

  if (requirementIds.length === 0) {
    // Short-circuit: an explicitly empty requirement list can never
    // produce a row, and running the statement anyway would be a wasted
    // round trip for a caller that already knows the answer.
    return new Map();
  }
  if (requirementIds.length > MAX_ROOT_IDS) {
    throw new RangeError(
      `getRequirementCoveringCases: requirementIds may not exceed ${MAX_ROOT_IDS} entries, received ${requirementIds.length}`
    );
  }

  // Destructured the same way the rollup above does: a null scope means
  // unrestricted (ADMIN), otherwise the list is the exact set of projects
  // allowed to contribute. A drill-down listing cases the rollup refused
  // to count would be both wrong and a disclosure.
  const unrestricted = scope.accessibleProjectIds === null;
  const accessibleProjectIds = scope.accessibleProjectIds ?? [];

  const closure = buildClosureFragment(projectId, requirementIds);

  const { rows } = await sql<RequirementCoveringCaseRow>`
    WITH RECURSIVE ${closure}
    SELECT DISTINCT
      cl.ancestor_id,
      rc.id AS case_id,
      rc.name AS case_name,
      rc."projectId" AS case_project_id,
      p.name AS project_name
    FROM closure cl
    JOIN "RepositoryCaseIssue" rci ON rci."issueId" = cl.node_id
    JOIN "RepositoryCases" rc
      ON rc.id = rci."caseId"
      AND rc."isDeleted" = false
      AND rc."isArchived" = false
    JOIN "Projects" p ON p.id = rc."projectId"
    -- Same unrestricted-or-member visibility predicate as the rollup's
    -- covering_cases CTE above, applied to the same case-project column.
    WHERE (${unrestricted} OR rc."projectId" = ANY(${accessibleProjectIds}::int[]))
    ORDER BY cl.ancestor_id, rc.id
  `.execute(db.$qb);

  const covering = new Map<number, RequirementCoveringCase[]>();
  for (const row of rows) {
    const requirementId = Number(row.ancestor_id);
    const entry: RequirementCoveringCase = {
      caseId: Number(row.case_id),
      caseName: row.case_name,
      projectId: Number(row.case_project_id),
      projectName: row.project_name,
    };
    const existing = covering.get(requirementId);
    if (existing) {
      existing.push(entry);
    } else {
      covering.set(requirementId, [entry]);
    }
  }
  return covering;
}
