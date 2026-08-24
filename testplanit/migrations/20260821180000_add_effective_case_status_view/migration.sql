-- EffectiveCaseStatus: the one place that knows where a run-case's completion
-- lives (https://github.com/TestPlanIt/testplanit/issues/591).
--
-- Manual runs denormalise their outcome onto TestRunCases.statusId. Automated
-- runs (JUNIT, TESTNG, XUNIT, NUNIT, MSTEST, MOCHA, CUCUMBER — see
-- AUTOMATED_TEST_RUN_TYPES in utils/testResultTypes.ts) record outcomes in
-- JUnitTestResult and may leave the run-case row completely empty: no
-- statusId, isCompleted, completedAt, elapsed, or startedAt. Reading
-- TestRunCases.statusId without branching on run type silently treats every
-- such case as never executed — in the app and in ad-hoc SQL/BI alike. Query
-- this view instead of TestRunCases.statusId.
--
-- Semantics, decided once here so every consumer inherits them:
--
--   * One row per live run-case (deleted run-cases and runs excluded).
--   * A status-carrying run-case always wins ("statusSource" = 'RUN_CASE').
--     The import pipeline rolls status up across attempts onto some automated
--     run-cases; that rollup is authoritative and is never overridden by the
--     raw results, even when a newer attempt disagrees.
--   * A status-less run-case resolves from its own run's LATEST automated
--     attempt ("statusSource" = 'AUTOMATED') — latest attempt wins, not
--     worst-of-attempts. Retries produce many JUnitTestResult rows per case,
--     hence the DISTINCT-ON-style pick below.
--   * "executedAt" comes from the same source as "statusId" (completedAt for
--     RUN_CASE, the attempt's executedAt for AUTOMATED).
--   * "hasResult" is the test for "has this case been executed at all" —
--     never test for the presence of a TestRunCases row, which automated
--     submissions create empty.
CREATE OR REPLACE VIEW "EffectiveCaseStatus" AS
SELECT
  trc.id                    AS "testRunCaseId",
  trc."testRunId",
  trc."repositoryCaseId",
  tr."milestoneId",
  tr."projectId",
  tr."testRunType",
  COALESCE(trc."statusId", j."statusId") AS "statusId",
  CASE
    WHEN trc."statusId" IS NOT NULL THEN trc."completedAt"
    ELSE j."executedAt"
  END                       AS "executedAt",
  (trc."statusId" IS NOT NULL OR j."statusId" IS NOT NULL) AS "hasResult",
  CASE
    WHEN trc."statusId" IS NOT NULL THEN 'RUN_CASE'
    WHEN j."statusId" IS NOT NULL THEN 'AUTOMATED'
  END                       AS "statusSource"
FROM "TestRunCases" trc
JOIN "TestRuns" tr
  ON tr.id = trc."testRunId"
 AND tr."isDeleted" = false
LEFT JOIN LATERAL (
  -- Only consulted for status-less run-cases; the guard lets the planner
  -- skip the lookup entirely for rows whose status is already denormalised.
  SELECT jr."statusId", jr."executedAt"
  FROM "JUnitTestResult" jr
  JOIN "JUnitTestSuite" js ON js.id = jr."testSuiteId"
  WHERE trc."statusId" IS NULL
    AND js."testRunId" = trc."testRunId"
    AND jr."repositoryCaseId" = trc."repositoryCaseId"
  ORDER BY jr."executedAt" DESC NULLS LAST, jr.id DESC
  LIMIT 1
) j ON true
WHERE trc."isDeleted" = false
