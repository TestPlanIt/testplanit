-- AlterTable
ALTER TABLE "RepositoryCaseIssue" ALTER COLUMN "alignedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Existing links count as aligned as of this migration. Row triggers are off
-- for the backfill so it writes no change-log rows.
ALTER TABLE "RepositoryCaseIssue" DISABLE TRIGGER USER;
UPDATE "RepositoryCaseIssue" SET "alignedAt" = CURRENT_TIMESTAMP WHERE "alignedAt" IS NULL;
ALTER TABLE "RepositoryCaseIssue" ENABLE TRIGGER USER;

-- Close suggestions waiting on automated test cases.
UPDATE "CaseChangeSuggestion" SET "status" = 'SUPERSEDED'
WHERE "status" = 'PENDING'
  AND "caseId" IN (SELECT "id" FROM "RepositoryCases" WHERE "automated");
