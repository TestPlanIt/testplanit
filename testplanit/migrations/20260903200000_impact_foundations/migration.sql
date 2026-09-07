-- CreateEnum
CREATE TYPE "CodeRepositoryConfigPurpose" AS ENUM ('QUICKSCRIPT', 'IMPACT');

-- CreateEnum
CREATE TYPE "CodePinKind" AS ENUM ('FILE', 'RANGE', 'SYMBOL', 'GLOB');

-- CreateEnum
CREATE TYPE "CodePinSource" AS ENUM ('MANUAL', 'AI', 'ANNOTATION', 'MAPFILE');

-- CreateEnum
CREATE TYPE "ImpactAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- DropIndex
DROP INDEX "ProjectCodeRepositoryConfig_projectId_key";

-- AlterTable
ALTER TABLE "ProjectCodeRepositoryConfig" ADD COLUMN     "markerScanReport" JSONB,
ADD COLUMN     "purpose" "CodeRepositoryConfigPurpose" NOT NULL DEFAULT 'QUICKSCRIPT';

-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "impactEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RepositoryCaseCodePin" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "configId" INTEGER NOT NULL,
    "kind" "CodePinKind" NOT NULL,
    "filePath" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "symbol" TEXT,
    "anchorSha" TEXT,
    "anchorSnippet" TEXT,
    "anchorHash" TEXT,
    "source" "CodePinSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "staleDismissedAt" TIMESTAMPTZ(6),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "RepositoryCaseCodePin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactAnalysis" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "configId" INTEGER NOT NULL,
    "baseSha" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "baseRef" TEXT,
    "headRef" TEXT,
    "status" "ImpactAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "jobId" TEXT,
    "notes" TEXT,
    "diffSummary" JSONB,
    "changedPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changedDirs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "pinnedCaseCount" INTEGER NOT NULL DEFAULT 0,
    "affectedCaseCount" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "testRunId" INTEGER,
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImpactAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactAnalysisCase" (
    "id" SERIAL NOT NULL,
    "analysisId" INTEGER NOT NULL,
    "caseId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "tier" TEXT NOT NULL,
    "layers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasons" JSONB,
    "coveredFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested" BOOLEAN NOT NULL DEFAULT true,
    "accepted" BOOLEAN,
    "addedManually" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedById" TEXT,

    CONSTRAINT "ImpactAnalysisCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepositoryCaseCodePin_caseId_isDeleted_idx" ON "RepositoryCaseCodePin"("caseId", "isDeleted");

-- CreateIndex
CREATE INDEX "RepositoryCaseCodePin_configId_filePath_idx" ON "RepositoryCaseCodePin"("configId", "filePath");

-- CreateIndex
CREATE INDEX "ImpactAnalysis_projectId_createdAt_idx" ON "ImpactAnalysis"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ImpactAnalysis_projectId_isDeleted_idx" ON "ImpactAnalysis"("projectId", "isDeleted");

-- CreateIndex
CREATE INDEX "ImpactAnalysis_configId_baseSha_headSha_idx" ON "ImpactAnalysis"("configId", "baseSha", "headSha");

-- CreateIndex
CREATE INDEX "ImpactAnalysis_testRunId_idx" ON "ImpactAnalysis"("testRunId");

-- CreateIndex
CREATE INDEX "ImpactAnalysisCase_caseId_idx" ON "ImpactAnalysisCase"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactAnalysisCase_analysisId_caseId_key" ON "ImpactAnalysisCase"("analysisId", "caseId");

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
CREATE INDEX "ProjectCodeRepositoryConfig_repositoryId_idx" ON "ProjectCodeRepositoryConfig"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCodeRepositoryConfig_projectId_purpose_key" ON "ProjectCodeRepositoryConfig"("projectId", "purpose");

-- AddForeignKey
ALTER TABLE "RepositoryCaseCodePin" ADD CONSTRAINT "RepositoryCaseCodePin_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseCodePin" ADD CONSTRAINT "RepositoryCaseCodePin_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ProjectCodeRepositoryConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryCaseCodePin" ADD CONSTRAINT "RepositoryCaseCodePin_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ProjectCodeRepositoryConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRuns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysis" ADD CONSTRAINT "ImpactAnalysis_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysisCase" ADD CONSTRAINT "ImpactAnalysisCase_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ImpactAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysisCase" ADD CONSTRAINT "ImpactAnalysisCase_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAnalysisCase" ADD CONSTRAINT "ImpactAnalysisCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

