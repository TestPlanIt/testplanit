-- CreateTable
CREATE TABLE "CaseDraft" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "draftKey" TEXT NOT NULL,
    "caseId" INTEGER,
    "folderId" INTEGER,
    "payload" JSONB NOT NULL,
    "baseVersion" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CaseDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseDraft_updatedAt_idx" ON "CaseDraft"("updatedAt");

-- CreateIndex
CREATE INDEX "CaseDraft_projectId_idx" ON "CaseDraft"("projectId");

-- CreateIndex
CREATE INDEX "CaseDraft_caseId_idx" ON "CaseDraft"("caseId");

-- CreateIndex
CREATE INDEX "CaseDraft_folderId_idx" ON "CaseDraft"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseDraft_userId_draftKey_key" ON "CaseDraft"("userId", "draftKey");

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
ALTER TABLE "CaseDraft" ADD CONSTRAINT "CaseDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDraft" ADD CONSTRAINT "CaseDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDraft" ADD CONSTRAINT "CaseDraft_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDraft" ADD CONSTRAINT "CaseDraft_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "RepositoryFolders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
