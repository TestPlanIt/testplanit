-- IssueIntegration and Forecasting were never enforced anywhere, so drop them
-- from the role permission areas.
DELETE FROM "RolePermission" WHERE "area" IN ('IssueIntegration', 'Forecasting');

CREATE TYPE "ApplicationArea_new" AS ENUM ('Documentation', 'Milestones', 'TestCaseRepository', 'TestCaseRestrictedFields', 'TestRuns', 'ClosedTestRuns', 'TestRunResults', 'TestRunResultRestrictedFields', 'AutomatedExecution', 'Sessions', 'SessionsRestrictedFields', 'ClosedSessions', 'SessionResults', 'Tags', 'SharedSteps', 'Issues', 'Reporting', 'Settings');
ALTER TABLE "RolePermission" ALTER COLUMN "area" TYPE "ApplicationArea_new" USING ("area"::text::"ApplicationArea_new");
ALTER TYPE "ApplicationArea" RENAME TO "ApplicationArea_old";
ALTER TYPE "ApplicationArea_new" RENAME TO "ApplicationArea";
DROP TYPE "ApplicationArea_old";
