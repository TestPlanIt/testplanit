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
 * coverage-chip renderer across both surfaces. `statuses[]` and
 * `untested` (gap-closure plan 26.2-07) ride the same single statement:
 * one extra CTE and one GROUP BY over the already-gated covering-case
 * set, mirroring `lib/services/milestoneMemberCoverage.ts`'s shipped
 * per-status rollup so the list's coverage cell can render through the
 * same `CoverageChip` the milestone details page already uses.
 * `directCaseCount` / `directCrossProjectCaseCount` (same plan) are
 * SUBSETS of `linkedCaseCount` / `crossProjectCaseCount` — cases linked
 * to the anchor requirement itself, never additive with the whole-subtree
 * totals.
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

/**
 * One row of the per-completed-status breakdown. Field names are dictated
 * by the milestone details page's `CoverageChip`/`CoverageStatusCount`
 * (`app/[locale]/projects/milestones/[projectId]/[milestoneId]/CoverageChip.tsx`)
 * so a requirement breakdown can be handed straight to that component with
 * no translation layer.
 */
export interface RequirementCoverageStatusCount {
  statusId: number;
  name: string;
  color: string | null;
  count: number;
}

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
  /**
   * How many of `linkedCaseCount` are linked DIRECTLY to this requirement
   * (min depth zero in the closure walk), as opposed to inherited from a
   * descendant. A SUBSET of `linkedCaseCount`, never additive with it.
   */
  directCaseCount: number;
  /**
   * How many of `directCaseCount` live in a project other than this
   * requirement's own. A SUBSET of both `directCaseCount` and
   * `crossProjectCaseCount` — a cross-project case inherited from a
   * descendant counts toward `crossProjectCaseCount` but not this field.
   */
  directCrossProjectCaseCount: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  /**
   * One entry per distinct COMPLETED status among the covering cases'
   * latest results (the system `untested` status excluded — it rides
   * `untested` below instead), ordered by count descending. Always
   * present, even when empty — the producer always fills this array, so
   * an optional field here would be a lie every consumer has to defend
   * against.
   */
  statuses: RequirementCoverageStatusCount[];
  /**
   * Explicit count of covering cases that are neither in `statuses`' sum
   * nor otherwise classified — missing results, non-completed results, and
   * results whose status IS the system `untested` status. Derived as
   * `linkedCaseCount - sum(statuses[].count)`, floored at zero — NOT
   * re-derived from `notRun`, which also absorbs a completed-but-
   * unclassifiable result and would silently disagree with this total.
   */
  untested: number;
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
 * The exact six counters `classifyRequirementCoverage` reads — spelled out
 * explicitly rather than derived via `Omit<RequirementCoverageBreakdown,
 * ...>`, so adding a new REQUIRED field to the breakdown (e.g. `statuses`,
 * `untested`) never silently widens this ladder's parameter type and
 * breaks every existing call site that only ever supplied these six.
 */
export type RequirementCoverageCounts = Pick<
  RequirementCoverageBreakdown,
  | "linkedCaseCount"
  | "crossProjectCaseCount"
  | "passed"
  | "failed"
  | "inProgress"
  | "notRun"
>;

/**
 * The four-rung failed-anywhere-wins precedence ladder, evaluated over a
 * requirement's covering-case counts. Pure — no I/O, no db client — so it
 * is unit-testable on its own, independent of the query that produces the
 * counts.
 */
export function classifyRequirementCoverage(
  counts: RequirementCoverageCounts
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

/** One element of the `statuses` JSON array before JS-side coercion — the
 * pg driver parses the `json` column into a plain JS value automatically,
 * but `count` still arrives as whatever JSON number type `json_build_object`
 * produced from the underlying bigint, so the JS loop coerces it too. */
interface RequirementCoverageStatusRawEntry {
  statusId: number;
  name: string;
  color: string | null;
  count: number;
}

/** Row shape returned by the rollup statement below, before JS-side coercion. */
interface RequirementCoverageRow {
  id: number | bigint;
  linked_case_count: number | bigint;
  cross_project_case_count: number | bigint;
  direct_case_count: number | bigint;
  direct_cross_project_case_count: number | bigint;
  passed: number | bigint;
  failed: number | bigint;
  in_progress: number | bigint;
  not_run: number | bigint;
  statuses: RequirementCoverageStatusRawEntry[] | null;
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
 * above supplies the whole-subtree walk, a grouped covering-case set
 * removes double-counting across levels (COV-02) while also tracking the
 * shallowest depth each case attaches at (`direct_*` counters), the shared
 * latest-result fragment classifies each covering case's most recent
 * execution, an additional per-status GROUP BY collapsed into one
 * `json_agg` supplies `statuses[]`, and a LEFT JOIN plus COALESCE turns a
 * requirement with nothing beneath it into an explicit zero row instead of
 * an absence (COV-03) — no application-code loop ever fills that gap. One
 * statement, one round trip: the shipped milestone analogue this
 * per-status rollup mirrors issues a SECOND statement for its own
 * per-status counts, but doing that here would either re-declare
 * `buildClosureFragment`'s closure (putting the anchor role predicate in
 * this file twice, which the structural test above forbids) or spend a
 * second round trip on data this statement already has in scope.
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
      -- COV-02: GROUP BY collapses a case linked at both an ancestor and
      -- one of its own descendants into exactly one row for that
      -- ancestor — the identical row set the prior DISTINCT produced (a
      -- case determines its own project, so no group can split). Riding
      -- along for free: MIN(cl.depth), the shallowest level at which the
      -- case attaches under that ancestor. 0 means linked to the ancestor
      -- itself (a direct link); anything deeper means inherited from a
      -- descendant — consumed below by the rollup's direct_* counters.
      SELECT
        cl.ancestor_id,
        rci."caseId" AS case_id,
        rc."projectId" AS case_project_id,
        MIN(cl.depth) AS min_depth
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
      GROUP BY cl.ancestor_id, rci."caseId", rc."projectId"
    ),
    ${latestCaseResultsCte()},
    rollup AS (
      -- The four counters below are mutually exclusive and exhaustive
      -- over covering_cases: every row lands in exactly one of them, so
      -- they always sum to linked_case_count. The two direct_* counters
      -- are SUBSETS of linked_case_count / cross_project_case_count,
      -- never additive with them.
      SELECT
        cc.ancestor_id,
        COUNT(*) AS linked_case_count,
        COUNT(*) FILTER (
          WHERE cc.case_project_id <> ${projectId}
        ) AS cross_project_case_count,
        COUNT(*) FILTER (WHERE cc.min_depth = 0) AS direct_case_count,
        COUNT(*) FILTER (
          WHERE cc.min_depth = 0 AND cc.case_project_id <> ${projectId}
        ) AS direct_cross_project_case_count,
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
    ),
    status_rollup AS (
      -- Per-status counts over the SAME already-gated covering_cases set
      -- (never a fresh read of the case-visibility table) — mirrors
      -- lib/services/milestoneMemberCoverage.ts's shipped per-status
      -- rollup: only COMPLETED statuses count, and the system 'untested'
      -- status is excluded even if matched, because 'untested' rides its
      -- own explicit aggregate below instead. The LEFT JOIN to "Status"
      -- (never an inner one) is what keeps the synthetic negative JUnit
      -- status ids (-1/-2/-3) present instead of silently dropping every
      -- automated-only result — the shared latest-result fragment already
      -- COALESCEd a name and a colour for exactly those rows.
      SELECT
        cc.ancestor_id,
        lr.status_id,
        lr.status_name,
        lr.status_color,
        COUNT(*) AS status_count
      FROM covering_cases cc
      JOIN latest_results lr ON lr.test_case_id = cc.case_id
      LEFT JOIN "Status" s ON s.id = lr.status_id
      WHERE lr.is_completed = true
        AND (s.id IS NULL OR s."systemName" IS DISTINCT FROM 'untested')
      GROUP BY cc.ancestor_id, lr.status_id, lr.status_name, lr.status_color
    ),
    statuses_agg AS (
      -- Collapses the per-status rows into one JSON array per ancestor,
      -- ordered by count descending — the same shape and ordering
      -- CoverageChip already reads (statusId / name / color / count).
      SELECT
        ancestor_id,
        json_agg(
          json_build_object(
            'statusId', status_id,
            'name', status_name,
            'color', status_color,
            'count', status_count
          )
          ORDER BY status_count DESC
        ) AS statuses
      FROM status_rollup
      GROUP BY ancestor_id
    )
    -- COV-03: rows come from the closure's own depth-zero entries — which
    -- ARE the anchor rows by construction — left-joined to the rollup
    -- above, never from a second pass over the issue table. A requirement
    -- with nothing beneath it in its subtree simply never appears in
    -- rollup; COALESCE turns that absence into a real, explicit zero
    -- row here, in the join, rather than in an application-code fill
    -- loop afterward. The same COV-03 property holds for statuses_agg: an
    -- absence becomes '[]', never an application-code fill.
    SELECT
      cl.ancestor_id AS id,
      COALESCE(r.linked_case_count, 0) AS linked_case_count,
      COALESCE(r.cross_project_case_count, 0) AS cross_project_case_count,
      COALESCE(r.direct_case_count, 0) AS direct_case_count,
      COALESCE(r.direct_cross_project_case_count, 0) AS direct_cross_project_case_count,
      COALESCE(r.passed, 0) AS passed,
      COALESCE(r.failed, 0) AS failed,
      COALESCE(r.in_progress, 0) AS in_progress,
      COALESCE(r.not_run, 0) AS not_run,
      COALESCE(sa.statuses, '[]'::json) AS statuses
    FROM closure cl
    LEFT JOIN rollup r ON r.ancestor_id = cl.ancestor_id
    LEFT JOIN statuses_agg sa ON sa.ancestor_id = cl.ancestor_id
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
    const statuses: RequirementCoverageStatusCount[] = (row.statuses ?? []).map(
      (entry) => ({
        statusId: Number(entry.statusId),
        name: entry.name,
        color: entry.color ?? null,
        count: Number(entry.count),
      })
    );
    const statusesTotal = statuses.reduce((sum, entry) => sum + entry.count, 0);
    breakdowns.set(Number(row.id), {
      ...counts,
      directCaseCount: Number(row.direct_case_count ?? 0),
      directCrossProjectCaseCount: Number(
        row.direct_cross_project_case_count ?? 0
      ),
      statuses,
      // Same derivation and zero floor the shipped milestone per-status
      // service uses — NOT re-derived from notRun, which also absorbs a
      // completed-but-unclassifiable result and would silently disagree
      // with this total.
      untested: Math.max(0, counts.linkedCaseCount - statusesTotal),
      uncovered: counts.linkedCaseCount === 0,
      status: classifyRequirementCoverage(counts),
    });
  }
  return breakdowns;
}

/** A single case covering a requirement, carrying the project it lives in
 * so a cross-project case can be badged and linked into its own project's
 * repository rather than the requirement's, plus that case's own latest
 * execution — the same "latest" definition the rollup counts with, so a
 * drill-down row can never show a status that disagrees with the counter
 * displayed above it. `null` on the four status fields and on
 * `lastExecutedAt` means the case has never been executed; it is still a
 * present, returned entry, never dropped for lacking an execution. */
export interface RequirementCoveringCase {
  caseId: number;
  caseName: string;
  projectId: number;
  projectName: string;
  /** Display metadata `TestCaseNameDisplay` keys its icon on — a case
   * served without these renders as a manual, parameterless case
   * regardless of what it is. */
  automated: boolean;
  source: string | null;
  hasParameters: boolean;
  lastStatusName: string | null;
  lastStatusColor: string | null;
  lastStatusIsSuccess: boolean | null;
  lastStatusIsFailure: boolean | null;
  lastExecutedAt: string | null;
  /** The run the latest result was recorded against, so a consumer can link
   *  the status back to its source. Null only when the case has never been
   *  executed — i.e. exactly when every other `last*` field is null too. */
  lastTestRunId: number | null;
}

/** Row shape returned by the covering-case drill-down statement below,
 * before JS-side coercion. */
interface RequirementCoveringCaseRow {
  ancestor_id: number | bigint;
  case_id: number | bigint;
  case_name: string;
  case_project_id: number | bigint;
  project_name: string;
  case_automated: boolean;
  case_source: string | null;
  case_has_parameters: boolean;
  status_name: string | null;
  status_color: string | null;
  is_success: boolean | null;
  is_failure: boolean | null;
  executed_at: Date | string | null;
  test_run_id: number | bigint | null;
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
 *
 * Each returned case also carries its own latest execution, composed from
 * the SAME shared latest-result fragment the rollup above joins into its
 * own statement — never a second, independently-written definition of
 * "latest." A drill-down whose per-row status disagreed with the rollup's
 * counters would be worse than no status at all: it would look authoritative
 * while quietly contradicting the number sitting right above it.
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
    WITH RECURSIVE ${closure}, ${latestCaseResultsCte()}
    SELECT DISTINCT
      cl.ancestor_id,
      rc.id AS case_id,
      rc.name AS case_name,
      rc."projectId" AS case_project_id,
      p.name AS project_name,
      rc."automated" AS case_automated,
      rc."source"::text AS case_source,
      rc."hasParameters" AS case_has_parameters,
      lr.status_name,
      lr.status_color,
      lr.is_success,
      lr.is_failure,
      lr.executed_at,
      lr.test_run_id
    FROM closure cl
    JOIN "RepositoryCaseIssue" rci ON rci."issueId" = cl.node_id
    JOIN "RepositoryCases" rc
      ON rc.id = rci."caseId"
      AND rc."isDeleted" = false
      AND rc."isArchived" = false
    JOIN "Projects" p ON p.id = rc."projectId"
    -- latest_results holds at most one row per case, so joining it in
    -- cannot multiply rows: DISTINCT stays exact, not merely present.
    LEFT JOIN latest_results lr ON lr.test_case_id = rc.id
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
      automated: row.case_automated === true,
      source: row.case_source ?? null,
      hasParameters: row.case_has_parameters === true,
      lastStatusName: row.status_name ?? null,
      lastStatusColor: row.status_color ?? null,
      lastStatusIsSuccess: row.is_success ?? null,
      lastStatusIsFailure: row.is_failure ?? null,
      lastExecutedAt: row.executed_at
        ? new Date(row.executed_at).toISOString()
        : null,
      lastTestRunId:
        row.test_run_id === null || row.test_run_id === undefined
          ? null
          : Number(row.test_run_id),
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
