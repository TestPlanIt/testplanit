-- Index the foreign-key columns that were missing an index.
--
-- Postgres does not auto-create an index on the referencing (child) column of
-- a foreign key. All of the columns below are `onDelete: Cascade`, so without
-- an index every parent-row delete triggers a full sequential scan of the
-- child table to find rows to cascade. On large data this is catastrophic
-- (e.g. deleting projects cascaded into a per-row seq-scan of Attachments,
-- turning a bulk delete into an O(parents x rows) operation). These indexes
-- also speed ordinary parent->child joins and FK-filtered lookups.

CREATE INDEX IF NOT EXISTS "Attachments_testCaseId_idx" ON "Attachments"("testCaseId");
CREATE INDEX IF NOT EXISTS "Attachments_sessionId_idx" ON "Attachments"("sessionId");
CREATE INDEX IF NOT EXISTS "Attachments_sessionResultsId_idx" ON "Attachments"("sessionResultsId");
CREATE INDEX IF NOT EXISTS "Attachments_testRunsId_idx" ON "Attachments"("testRunsId");
CREATE INDEX IF NOT EXISTS "Attachments_testRunResultsId_idx" ON "Attachments"("testRunResultsId");
CREATE INDEX IF NOT EXISTS "Attachments_testRunStepResultId_idx" ON "Attachments"("testRunStepResultId");
CREATE INDEX IF NOT EXISTS "Attachments_junitTestResultId_idx" ON "Attachments"("junitTestResultId");
CREATE INDEX IF NOT EXISTS "JUnitProperty_testSuiteId_idx" ON "JUnitProperty"("testSuiteId");
CREATE INDEX IF NOT EXISTS "JUnitProperty_repositoryCaseId_idx" ON "JUnitProperty"("repositoryCaseId");
CREATE INDEX IF NOT EXISTS "JUnitAttachment_repositoryCaseId_idx" ON "JUnitAttachment"("repositoryCaseId");
CREATE INDEX IF NOT EXISTS "JUnitTestStep_repositoryCaseId_idx" ON "JUnitTestStep"("repositoryCaseId");
CREATE INDEX IF NOT EXISTS "ResultFieldValues_testCaseId_idx" ON "ResultFieldValues"("testCaseId");
CREATE INDEX IF NOT EXISTS "TestRunResults_testRunId_idx" ON "TestRunResults"("testRunId");
