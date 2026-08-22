-- AlterEnum
ALTER TYPE "Locale" ADD VALUE 'cs_CZ';

-- AlterTable
ALTER TABLE "Attachments" ADD COLUMN     "issueId" INTEGER;

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isRequirement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentId" INTEGER,
ADD COLUMN     "requirementDetachedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "LlmProviderConfig" ALTER COLUMN "defaultMaxTokens" SET DEFAULT 8192;

-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "requirementsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Attachments_issueId_idx" ON "Attachments"("issueId");

-- `dcl_unprocessed_seq` is deliberately NOT recreated here. Migration
-- 20260629020000_datachangelog_partial_poll_index replaced the plain btree
-- with a PARTIAL index (`WHERE "processed" = false`) for the CDC poll. Prisma's
-- schema language cannot express a partial index, so every `migrate dev` diff
-- reports the index as missing and emits a plain `CREATE INDEX` for it. Left in,
-- that statement aborts the migration on a real database (42P07, the name is
-- taken) — and if the name were ever free it would silently restore a full
-- index over every DataChangeLog row. Delete this statement from any future
-- generated migration too.

-- CreateIndex
CREATE INDEX "Issue_parentId_idx" ON "Issue"("parentId");

-- AddForeignKey
ALTER TABLE "Attachments" ADD CONSTRAINT "Attachments_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
