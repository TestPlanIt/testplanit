-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "contentUpdatedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "RepositoryCaseIssue" ADD COLUMN     "suspectDismissedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "RequirementIssueReference" (
    "requirementId" INTEGER NOT NULL,
    "referencedIssueId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "RequirementIssueReference_pkey" PRIMARY KEY ("requirementId","referencedIssueId")
);

-- CreateIndex
CREATE INDEX "RequirementIssueReference_referencedIssueId_idx" ON "RequirementIssueReference"("referencedIssueId");

-- `dcl_unprocessed_seq` is deliberately NOT recreated here. Migration
-- 20260629020000_datachangelog_partial_poll_index replaced the plain btree
-- with a PARTIAL index (`WHERE "processed" = false`) for the CDC poll. Prisma's
-- schema language cannot express a partial index, so every `migrate dev` diff
-- reports the index as missing and emits a plain `CREATE INDEX` for it. Left in,
-- that statement aborts the migration on a real database (42P07, the name is
-- taken) — and if the name were ever free it would silently restore a full
-- index over every DataChangeLog row. Delete this statement from any future
-- generated migration too.

-- AddForeignKey
ALTER TABLE "RequirementIssueReference" ADD CONSTRAINT "RequirementIssueReference_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementIssueReference" ADD CONSTRAINT "RequirementIssueReference_referencedIssueId_fkey" FOREIGN KEY ("referencedIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementIssueReference" ADD CONSTRAINT "RequirementIssueReference_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
