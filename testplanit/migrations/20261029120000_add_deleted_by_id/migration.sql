-- Soft-delete attribution: record WHO soft-deleted a row.
--
-- Additive nullable `deletedById` next to the existing `deletedAt` on every soft-deletable
-- table. A plain text column (no FK): it is tombstone metadata like deletedAt, and a relation
-- would add one back-relation per table to User. Stamped from the audit GUC actor on the
-- isDeleted false->true flip (and cleared on restore) by the `tpl_stamp_deleted_at_*` BEFORE
-- UPDATE triggers, which are attached idempotently by scripts/apply-triggers.ts (NOT here).
-- Existing tombstones keep deletedById NULL (deleter predates tracking), so they stay
-- restorable from Admin > Trash only.
--
-- The composite index backs the per-user Trash query (deletedById = me AND deletedAt >= cutoff)
-- on the types users may restore themselves.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Groups" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Roles" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Projects" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Milestones" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "MilestoneTypes" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "FailureClassification" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "CaseFields" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ResultFields" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "FieldOptions" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Templates" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "CaseExportTemplate" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Status" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Workflows" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ConfigCategories" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ConfigVariants" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Configurations" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Tags" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Repositories" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "RepositoryFolders" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "RepositoryCaseLink" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "RepositoryCaseCodePin" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "DuplicateScanResult" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "StepSequenceMatch" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "StepSequenceMatchCase" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "RepositoryCases" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "RepositoryCaseVersions" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Attachments" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Steps" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "TestCaseParameter" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Sessions" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "SessionResults" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "TestRuns" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "TestRunCases" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "TestRunResults" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "TestRunStepResults" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "TestRunCaseIteration" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "TestRunCaseDataSetSnapshot" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Issue" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Integration" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "CodeRepository" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ExecutionTarget" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "AlertRule" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ImpactAnalysis" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "LlmIntegration" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "SharedStepGroup" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "DataSet" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "DataSetRow" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Notification" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ReviewRequest" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ShareLink" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "PromptConfig" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "LlmReportSnapshot" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "RequirementTraceabilitySnapshot" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Comment" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ImportMapping" ADD COLUMN "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "RepositoryCases_deletedById_deletedAt_idx" ON "RepositoryCases"("deletedById", "deletedAt");
CREATE INDEX "RepositoryFolders_deletedById_deletedAt_idx" ON "RepositoryFolders"("deletedById", "deletedAt");
CREATE INDEX "SharedStepGroup_deletedById_deletedAt_idx" ON "SharedStepGroup"("deletedById", "deletedAt");
CREATE INDEX "TestRuns_deletedById_deletedAt_idx" ON "TestRuns"("deletedById", "deletedAt");
CREATE INDEX "Sessions_deletedById_deletedAt_idx" ON "Sessions"("deletedById", "deletedAt");
CREATE INDEX "Milestones_deletedById_deletedAt_idx" ON "Milestones"("deletedById", "deletedAt");
CREATE INDEX "Issue_deletedById_deletedAt_idx" ON "Issue"("deletedById", "deletedAt");
CREATE INDEX "DataSet_deletedById_deletedAt_idx" ON "DataSet"("deletedById", "deletedAt");
CREATE INDEX "Attachments_deletedById_deletedAt_idx" ON "Attachments"("deletedById", "deletedAt");
