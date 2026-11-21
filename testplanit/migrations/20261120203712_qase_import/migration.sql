-- CreateEnum
CREATE TYPE "QaseImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "QaseImportPhase" AS ENUM ('FETCHING', 'CONFIGURING', 'IMPORTING');

-- CreateTable
CREATE TABLE "QaseImportJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "QaseImportStatus" NOT NULL DEFAULT 'QUEUED',
    "statusMessage" TEXT,
    "phase" "QaseImportPhase",
    "apiHost" TEXT NOT NULL,
    "apiToken" TEXT,
    "projects" JSONB NOT NULL,
    "fetchProgress" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "error" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "currentEntity" TEXT,
    "estimatedTimeRemaining" TEXT,
    "processingRate" TEXT,
    "activityLog" JSONB,
    "entityProgress" JSONB,
    "configuration" JSONB,
    "analysis" JSONB,
    "lastImportStartedAt" TIMESTAMP(3),

    CONSTRAINT "QaseImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaseImportStaging" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "projectCode" TEXT,
    "entity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaseImportStaging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QaseImportJob_createdById_idx" ON "QaseImportJob"("createdById");

-- CreateIndex
CREATE INDEX "QaseImportJob_status_idx" ON "QaseImportJob"("status");

-- CreateIndex
CREATE INDEX "QaseImportJob_createdAt_idx" ON "QaseImportJob"("createdAt");

-- CreateIndex
CREATE INDEX "QaseImportStaging_jobId_entity_rowIndex_idx" ON "QaseImportStaging"("jobId", "entity", "rowIndex");

-- CreateIndex
CREATE INDEX "QaseImportStaging_jobId_entity_projectCode_sourceId_idx" ON "QaseImportStaging"("jobId", "entity", "projectCode", "sourceId");

-- AddForeignKey
ALTER TABLE "QaseImportJob" ADD CONSTRAINT "QaseImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaseImportStaging" ADD CONSTRAINT "QaseImportStaging_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "QaseImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
