-- Soft-delete retention basis: record WHEN a row was soft-deleted.
--
-- Additive `deletedAt` timestamp alongside the existing `isDeleted` boolean (Option A).
-- `isDeleted` stays the queryable liveness flag; `deletedAt` is retention/purge metadata.
-- The column is stamped on the isDeleted false->true flip (and cleared on restore) by the
-- `tpl_stamp_deleted_at_*` BEFORE UPDATE triggers, which are attached idempotently by
-- scripts/apply-triggers.ts (NOT here) — mirroring the audit and single-default trigger
-- substrate. Existing tombstones keep deletedAt NULL (deletion time predates tracking).
--
-- SharedStepGroup already carries deletedAt (created in the init migration), so it is absent below.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Groups" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Roles" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Projects" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Milestones" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "MilestoneTypes" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "CaseFields" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "ResultFields" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "FieldOptions" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Templates" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "CaseExportTemplate" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Status" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Workflows" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "ConfigCategories" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "ConfigVariants" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Configurations" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Tags" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Repositories" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "RepositoryFolders" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "RepositoryCaseLink" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "DuplicateScanResult" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "StepSequenceMatch" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "StepSequenceMatchCase" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "RepositoryCases" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "RepositoryCaseVersions" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Attachments" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Steps" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "TestCaseParameter" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Sessions" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "SessionResults" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "TestRuns" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "TestRunCases" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "TestRunResults" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "TestRunStepResults" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "TestRunCaseIteration" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "TestRunCaseDataSetSnapshot" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Issue" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Integration" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "CodeRepository" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "LlmIntegration" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "DataSet" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "DataSetRow" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Notification" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "ReviewRequest" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "ShareLink" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "PromptConfig" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "LlmReportSnapshot" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Comment" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
