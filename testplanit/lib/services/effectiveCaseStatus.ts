import { baseDb } from "~/lib/db";
import { AUTOMATED_TEST_RUN_TYPES } from "~/utils/testResultTypes";

/**
 * Single accessor for "what is a run-case's effective completion status"
 * (https://github.com/TestPlanIt/testplanit/issues/591).
 *
 * A run-case's completion lives in one of two tables depending on how the
 * run was produced. Manual runs denormalise the outcome onto
 * TestRunCases.statusId; automated runs (JUnit, TestNG, Mocha, etc. — see
 * AUTOMATED_TEST_RUN_TYPES) record it in JUnitTestResult and may leave the
 * run-case row completely empty. Two details every consumer must get right:
 *
 *   1. Presence is not the test. Automated runs DO create a TestRunCases
 *      row — branch on whether it carries a status, never on whether the
 *      row exists.
 *   2. Automated results are many-per-case (retries). Per-run-case
 *      resolution takes the LATEST attempt; a status the import pipeline
 *      already rolled up onto the run-case always wins over the raw
 *      results.
 *
 * Raw SQL should read the "EffectiveCaseStatus" view (same semantics,
 * decided once — see its migration); ORM callers use the helpers below.
 * `pnpm check:case-status` guards against new direct reads.
 */

/**
 * Minimal client surface the helpers need — accepts a transaction client so
 * rollback-scoped integration tests can see their own uncommitted fixtures.
 */
export type EffectiveStatusDbClient = {
  $queryRaw: (typeof baseDb)["$queryRaw"];
  status: { findMany: (typeof baseDb)["status"]["findMany"] };
};

export type CompletionCounts = { total: number; completed: number };

export type CompletionScope = { milestoneIds: number[] } | { runIds: number[] };

/**
 * Per-milestone completion counts, resolved from the correct source per run
 * type: manual run-cases count from TestRunCases (completed = their
 * denormalised status), automated runs count every JUnitTestResult attempt.
 * The automated denominator is deliberately per-RESULT, not per-case — the
 * milestone page has always reported progress across attempts, and both
 * halves must keep matching `calculateMilestoneCompletion`.
 */
export async function getMilestoneCaseCompletion(
  milestoneIds: number[],
  client: EffectiveStatusDbClient = baseDb
): Promise<Map<number, CompletionCounts>> {
  const counts = new Map<number, CompletionCounts>();
  if (milestoneIds.length === 0) return counts;

  const automatedTypes = [...AUTOMATED_TEST_RUN_TYPES];
  const rows = await client.$queryRaw<
    Array<{ milestoneId: number; total: bigint; completed: bigint }>
  >`
    WITH manual AS (
      SELECT tr."milestoneId" AS milestone_id,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE s."isCompleted" = true) AS completed
      FROM "TestRunCases" trc
      JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
      LEFT JOIN "Status" s ON s.id = trc."statusId"
      WHERE trc."isDeleted" = false
        AND tr."milestoneId" = ANY(${milestoneIds}::int[])
        AND NOT (tr."testRunType"::text = ANY(${automatedTypes}::text[]))
      GROUP BY 1
    ),
    automated AS (
      SELECT tr."milestoneId" AS milestone_id,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE s."isCompleted" = true) AS completed
      FROM "JUnitTestResult" jr
      JOIN "JUnitTestSuite" js ON js.id = jr."testSuiteId"
      JOIN "TestRuns" tr ON tr.id = js."testRunId" AND tr."isDeleted" = false
      LEFT JOIN "Status" s ON s.id = jr."statusId"
      WHERE tr."milestoneId" = ANY(${milestoneIds}::int[])
        AND tr."testRunType"::text = ANY(${automatedTypes}::text[])
      GROUP BY 1
    )
    SELECT
      COALESCE(m.milestone_id, a.milestone_id) AS "milestoneId",
      COALESCE(m.total, 0) + COALESCE(a.total, 0) AS total,
      COALESCE(m.completed, 0) + COALESCE(a.completed, 0) AS completed
    FROM manual m
    FULL OUTER JOIN automated a ON a.milestone_id = m.milestone_id
  `;

  for (const row of rows) {
    if (row.milestoneId == null) continue;
    counts.set(row.milestoneId, {
      total: Number(row.total),
      completed: Number(row.completed),
    });
  }
  return counts;
}

/**
 * Completion for the run-cases in scope, resolved from the correct source
 * per run type (see `getMilestoneCaseCompletion` for the counting rules).
 * Always prefer this over reading TestRunCases.statusId directly — that
 * column is empty for reporter-SDK automated runs.
 */
export async function getEffectiveCaseCompletion(
  scope: CompletionScope,
  client: EffectiveStatusDbClient = baseDb
): Promise<CompletionCounts> {
  if ("milestoneIds" in scope) {
    const byMilestone = await getMilestoneCaseCompletion(
      scope.milestoneIds,
      client
    );
    let total = 0;
    let completed = 0;
    for (const counts of byMilestone.values()) {
      total += counts.total;
      completed += counts.completed;
    }
    return { total, completed };
  }

  if (scope.runIds.length === 0) return { total: 0, completed: 0 };

  const automatedTypes = [...AUTOMATED_TEST_RUN_TYPES];
  const rows = await client.$queryRaw<
    Array<{ total: bigint; completed: bigint }>
  >`
    WITH manual AS (
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE s."isCompleted" = true) AS completed
      FROM "TestRunCases" trc
      JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
      LEFT JOIN "Status" s ON s.id = trc."statusId"
      WHERE trc."isDeleted" = false
        AND tr.id = ANY(${scope.runIds}::int[])
        AND NOT (tr."testRunType"::text = ANY(${automatedTypes}::text[]))
    ),
    automated AS (
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE s."isCompleted" = true) AS completed
      FROM "JUnitTestResult" jr
      JOIN "JUnitTestSuite" js ON js.id = jr."testSuiteId"
      JOIN "TestRuns" tr ON tr.id = js."testRunId" AND tr."isDeleted" = false
      LEFT JOIN "Status" s ON s.id = jr."statusId"
      WHERE tr.id = ANY(${scope.runIds}::int[])
        AND tr."testRunType"::text = ANY(${automatedTypes}::text[])
    )
    SELECT m.total + a.total AS total, m.completed + a.completed AS completed
    FROM manual m, automated a
  `;

  return {
    total: Number(rows[0]?.total ?? 0),
    completed: Number(rows[0]?.completed ?? 0),
  };
}

export type EffectiveRunCaseStatus = Awaited<
  ReturnType<(typeof baseDb)["status"]["findMany"]>
>[number] & { color: { value: string } | null };

/**
 * Effective status (with color) for each run-case id, from the
 * "EffectiveCaseStatus" view: a denormalised run-case status when present,
 * otherwise the case's latest automated attempt in the same run. Run-cases
 * with no result at all — or belonging to deleted runs/run-cases — are
 * absent from the returned map.
 */
export async function getEffectiveRunCaseStatuses(
  testRunCaseIds: number[],
  client: EffectiveStatusDbClient = baseDb
): Promise<Map<number, EffectiveRunCaseStatus>> {
  const resolved = new Map<number, EffectiveRunCaseStatus>();
  if (testRunCaseIds.length === 0) return resolved;

  const rows = await client.$queryRaw<
    Array<{ testRunCaseId: number; statusId: number }>
  >`
    SELECT "testRunCaseId", "statusId"
    FROM "EffectiveCaseStatus"
    WHERE "testRunCaseId" = ANY(${testRunCaseIds}::int[])
      AND "statusId" IS NOT NULL
  `;
  if (rows.length === 0) return resolved;

  const statuses = await client.status.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.statusId))] } },
    include: { color: true },
  });
  const statusById = new Map(statuses.map((status) => [status.id, status]));

  for (const row of rows) {
    const status = statusById.get(row.statusId);
    if (status) {
      resolved.set(row.testRunCaseId, status as EffectiveRunCaseStatus);
    }
  }
  return resolved;
}
