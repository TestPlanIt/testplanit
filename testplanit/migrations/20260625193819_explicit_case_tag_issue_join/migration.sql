/*
  Implicit case<->tag / case<->issue many-to-many  ->  explicit join models
  (RepositoryCaseTag, RepositoryCaseIssue).

  DATA-PRESERVING. The Prisma-generated diff dropped the implicit join tables
  first (losing every link). This edited version reorders to
  create -> copy -> drop so existing links are moved into the new tables before
  the old ones are removed. The whole migration runs in one transaction, so a
  failure rolls back cleanly.
*/

-- 1. Create the explicit join tables -----------------------------------------
-- CreateTable
CREATE TABLE "RepositoryCaseTag" (
    "caseId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "RepositoryCaseTag_pkey" PRIMARY KEY ("caseId","tagId")
);

-- CreateTable
CREATE TABLE "RepositoryCaseIssue" (
    "caseId" INTEGER NOT NULL,
    "issueId" INTEGER NOT NULL,

    CONSTRAINT "RepositoryCaseIssue_pkey" PRIMARY KEY ("caseId","issueId")
);

-- CreateIndex
CREATE INDEX "RepositoryCaseTag_tagId_idx" ON "RepositoryCaseTag"("tagId");

-- CreateIndex
CREATE INDEX "RepositoryCaseIssue_issueId_idx" ON "RepositoryCaseIssue"("issueId");

-- AddForeignKey
ALTER TABLE "RepositoryCaseTag" ADD CONSTRAINT "RepositoryCaseTag_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseTag" ADD CONSTRAINT "RepositoryCaseTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseIssue" ADD CONSTRAINT "RepositoryCaseIssue_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseIssue" ADD CONSTRAINT "RepositoryCaseIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Copy existing links out of the implicit join tables ----------------------
-- Prisma names implicit-join columns by alphabetical model order:
--   _RepositoryCasesToTags : "A" = RepositoryCases.id, "B" = Tags.id
--   _IssueToRepositoryCases: "A" = Issue.id,           "B" = RepositoryCases.id  (reversed)
-- Every implicit row already satisfied both FKs, so the copy cannot orphan.
INSERT INTO "RepositoryCaseTag" ("caseId", "tagId")
    SELECT "A", "B" FROM "_RepositoryCasesToTags"
    ON CONFLICT ("caseId", "tagId") DO NOTHING;

INSERT INTO "RepositoryCaseIssue" ("caseId", "issueId")
    SELECT "B", "A" FROM "_IssueToRepositoryCases"
    ON CONFLICT ("caseId", "issueId") DO NOTHING;

-- 3. Drop the now-migrated implicit join tables -------------------------------
-- DropForeignKey
ALTER TABLE "_IssueToRepositoryCases" DROP CONSTRAINT "_IssueToRepositoryCases_A_fkey";

-- DropForeignKey
ALTER TABLE "_IssueToRepositoryCases" DROP CONSTRAINT "_IssueToRepositoryCases_B_fkey";

-- DropForeignKey
ALTER TABLE "_RepositoryCasesToTags" DROP CONSTRAINT "_RepositoryCasesToTags_A_fkey";

-- DropForeignKey
ALTER TABLE "_RepositoryCasesToTags" DROP CONSTRAINT "_RepositoryCasesToTags_B_fkey";

-- DropTable
DROP TABLE "_IssueToRepositoryCases";

-- DropTable
DROP TABLE "_RepositoryCasesToTags";
