-- CreateTable
CREATE TABLE "RequirementTraceabilitySnapshot" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "capturedById" TEXT NOT NULL,
    "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scopeRequirementIds" JSONB NOT NULL DEFAULT '[]',
    "requirementCount" INTEGER NOT NULL,
    "passedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "notRunCount" INTEGER NOT NULL,
    "uncoveredCount" INTEGER NOT NULL,
    "caseLinkCount" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementTraceabilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementTraceabilitySnapshotEntry" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "requirementId" INTEGER NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "requirementTitle" TEXT,
    "requirementPath" TEXT NOT NULL,
    "requirementParentPath" TEXT NOT NULL,
    "requirementParentId" INTEGER,
    "requirementRootId" INTEGER NOT NULL,
    "requirementIssueTypeName" TEXT,
    "requirementIssueTypeIconUrl" TEXT,
    "requirementPriority" TEXT,
    "requirementStatus" TEXT,
    "requirementCreatedAt" TIMESTAMPTZ(6),
    "coverageStatus" TEXT NOT NULL,
    "linkedCaseCount" INTEGER NOT NULL,
    "cases" JSONB NOT NULL,

    CONSTRAINT "RequirementTraceabilitySnapshotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementTraceabilitySnapshot_projectId_capturedAt_idx" ON "RequirementTraceabilitySnapshot"("projectId", "capturedAt");

-- CreateIndex
CREATE INDEX "RequirementTraceabilitySnapshot_projectId_isDeleted_idx" ON "RequirementTraceabilitySnapshot"("projectId", "isDeleted");

-- CreateIndex
CREATE INDEX "RequirementTraceabilitySnapshotEntry_snapshotId_idx" ON "RequirementTraceabilitySnapshotEntry"("snapshotId");

-- CreateIndex
CREATE INDEX "RequirementTraceabilitySnapshotEntry_requirementId_snapshot_idx" ON "RequirementTraceabilitySnapshotEntry"("requirementId", "snapshotId");

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
ALTER TABLE "RequirementTraceabilitySnapshot" ADD CONSTRAINT "RequirementTraceabilitySnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceabilitySnapshot" ADD CONSTRAINT "RequirementTraceabilitySnapshot_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTraceabilitySnapshotEntry" ADD CONSTRAINT "RequirementTraceabilitySnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RequirementTraceabilitySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
