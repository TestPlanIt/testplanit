import { sql } from "kysely";

/**
 * The shared "latest result for a test case" definition for the
 * issue-coverage family — a composable CTE fragment, not a query that runs
 * on its own. This module owns query semantics and nothing else: zero db
 * client import, zero execution. That is exactly what lets two different
 * top-level statements compose it into their own `WITH` clause without a
 * shared connection or a second round trip.
 *
 * A case can be executed two ways — manually, recorded as TestRunResults
 * against a TestRunCase, and by an automated run, recorded as
 * JUnitTestResult — and "latest" has to consider both. The two sides are
 * unioned and re-ranked so exactly one row per case survives: the single
 * most recent execution across either mechanism.
 *
 * Consumers: the defect issue test-coverage report
 * (utils/issueTestCoverageUtils.ts, both the project-scoped and
 * cross-project report-builder routes) and the requirement coverage
 * rollup service (a later phase plan in this same milestone). Both
 * compose this fragment into their own statement rather than each
 * carrying an independent copy of this SQL.
 *
 * Classification keys off three boolean columns on the joined Status row
 * — success, failure, completed — never off a status's name or system
 * name. Statuses are an admin-configurable, per-project model, not a
 * hardcoded enum, so a consumer that branched on a status's name would
 * silently break the moment an admin renamed or reordered one.
 *
 * This fragment deliberately applies NO status exclusion on the manual
 * side: whatever a case's most recently recorded execution's status is,
 * that execution IS "the latest result" for that case, including a
 * result whose status happens to be a skip. A sibling module,
 * lib/services/latestTestResults.ts's queryLatestTestResults, makes a
 * different, equally deliberate choice for a different pair of product
 * surfaces (the Repository Case List and the Flaky Test Report): it
 * walks past a case's most recent skipped or never-run result to find an
 * older, more "meaningful" one. That behavior is not reused here — this
 * fragment's two consumers need "the most recent execution, full stop,"
 * not "the most recent execution that wasn't a skip."
 */

/**
 * Returns the shared CTE fragment as a Kysely `sql` template, ready to be
 * interpolated directly after the caller's own `WITH` keyword.
 *
 * Contract:
 * - Three comma-separated CTE definitions, in this order:
 *   `latest_manual_results`, `latest_junit_results`, `latest_results`.
 * - No leading `WITH` and no trailing comma — the caller supplies both,
 *   so it can define further CTEs before or after this one.
 * - `latest_results` is defined last, so a caller may reference it from
 *   CTEs defined after this fragment is interpolated.
 * - `latest_results`'s final projection is exactly these eight columns,
 *   in this order: `test_case_id`, `executed_at`, `status_id`,
 *   `status_name`, `status_color`, `is_success`, `is_failure`,
 *   `is_completed`.
 *
 * A zero-argument function rather than a module-level constant, so every
 * call site gets its own fragment instance and no shared builder object
 * travels between two independent statements.
 */
export function latestCaseResultsCte() {
  return sql`
latest_manual_results AS (
  -- Get the latest manual test result for each repository case
  SELECT DISTINCT ON (rc.id)
    rc.id as test_case_id,
    trr."executedAt" as executed_at,
    s.id as status_id,
    s.name as status_name,
    c.value as status_color,
    s."isSuccess" as is_success,
    s."isFailure" as is_failure,
    s."isCompleted" as is_completed
  FROM "RepositoryCases" rc
  INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
  INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
  INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id
  INNER JOIN "Status" s ON s.id = trr."statusId"
  LEFT JOIN "Color" c ON c.id = s."colorId"
  WHERE rc."isDeleted" = false
    AND rc."isArchived" = false
    AND trr."executedAt" IS NOT NULL
  ORDER BY rc.id, trr."executedAt" DESC
),
latest_junit_results AS (
  -- Get the latest JUnit result for each repository case
  SELECT DISTINCT ON (rc.id)
    rc.id as test_case_id,
    jr."executedAt" as executed_at,
    COALESCE(s.id,
      CASE jr.type
        WHEN 'PASSED' THEN -1
        WHEN 'FAILURE' THEN -2
        WHEN 'ERROR' THEN -3
        ELSE NULL
      END
    ) as status_id,
    COALESCE(s.name, jr.type::text) as status_name,
    COALESCE(c.value,
      CASE jr.type
        WHEN 'PASSED' THEN '#22c55e'
        WHEN 'FAILURE' THEN '#ef4444'
        WHEN 'ERROR' THEN '#ef4444'
        ELSE '#6b7280'
      END
    ) as status_color,
    COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
    COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
    COALESCE(s."isCompleted", jr.type IN ('PASSED', 'FAILURE', 'ERROR')) as is_completed
  FROM "RepositoryCases" rc
  INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
  INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
  INNER JOIN "TestRuns" tr ON tr.id = jts."testRunId" AND tr."isDeleted" = false
  LEFT JOIN "Status" s ON s.id = jr."statusId"
  LEFT JOIN "Color" c ON c.id = s."colorId"
  WHERE rc."isDeleted" = false
    AND rc."isArchived" = false
    AND jr."executedAt" IS NOT NULL
    AND jr.type != 'SKIPPED'
  ORDER BY rc.id, jr."executedAt" DESC
),
latest_results AS (
  -- Combine and get the most recent result for each test case
  SELECT DISTINCT ON (test_case_id)
    test_case_id,
    executed_at,
    status_id,
    status_name,
    status_color,
    is_success,
    is_failure,
    is_completed
  FROM (
    SELECT * FROM latest_manual_results
    UNION ALL
    SELECT * FROM latest_junit_results
  ) all_results
  ORDER BY test_case_id, executed_at DESC
)
`;
}
