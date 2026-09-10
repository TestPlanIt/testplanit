-- Automated execution dispatch (999.31): per-project execution targets and
-- per-run execution records.

-- CreateEnum
CREATE TYPE "ExecutionProvider" AS ENUM ('GITHUB_ACTIONS', 'GITLAB_CI', 'GENERIC_WEBHOOK');

-- CreateEnum
CREATE TYPE "TestRunExecutionStatus" AS ENUM ('PENDING', 'DISPATCHED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DISPATCH_FAILED', 'TIMED_OUT', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'EXECUTION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'EXECUTION_DISPATCHED';
ALTER TYPE "AuditAction" ADD VALUE 'EXECUTION_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE 'EXECUTION_CANCELLED';

-- CreateTable
CREATE TABLE "ExecutionTarget" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "ExecutionProvider" NOT NULL,
    "codeRepositoryId" INTEGER,
    "workflowRef" TEXT,
    "defaultRef" TEXT,
    "url" TEXT,
    "staticInputs" JSONB NOT NULL DEFAULT '{}',
    "credentials" JSONB,
    "timeoutMinutes" INTEGER NOT NULL DEFAULT 240,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMPTZ(6),
    "lastVerifyError" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunExecution" (
    "id" SERIAL NOT NULL,
    "testRunId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "targetId" INTEGER NOT NULL,
    "provider" "ExecutionProvider" NOT NULL,
    "status" "TestRunExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "ref" TEXT,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "selectionCount" INTEGER NOT NULL DEFAULT 0,
    "requestedCaseIds" JSONB NOT NULL DEFAULT '[]',
    "externalRunId" TEXT,
    "externalUrl" TEXT,
    "externalStatus" TEXT,
    "error" TEXT,
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "dispatchedAt" TIMESTAMPTZ(6),
    "lastPolledAt" TIMESTAMPTZ(6),
    "resultsReceivedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestRunExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionTarget_projectId_isDeleted_idx" ON "ExecutionTarget"("projectId", "isDeleted");

-- CreateIndex
CREATE INDEX "ExecutionTarget_codeRepositoryId_idx" ON "ExecutionTarget"("codeRepositoryId");

-- CreateIndex
CREATE INDEX "TestRunExecution_testRunId_status_idx" ON "TestRunExecution"("testRunId", "status");

-- CreateIndex
CREATE INDEX "TestRunExecution_status_lastPolledAt_idx" ON "TestRunExecution"("status", "lastPolledAt");

-- CreateIndex
CREATE INDEX "TestRunExecution_projectId_createdAt_idx" ON "TestRunExecution"("projectId", "createdAt");

-- One in-flight execution per run. The application checks this under a row
-- lock; this partial unique index is the database-level backstop. (Prisma
-- cannot express partial indexes, so it is hand-written here, like the
-- DataChangeLog poll index.)
CREATE UNIQUE INDEX "TestRunExecution_active_per_run" ON "TestRunExecution"("testRunId")
  WHERE "status" IN ('PENDING', 'DISPATCHED', 'RUNNING');

-- NOTE: the generated diff also re-emitted a plain CREATE INDEX for
-- "dcl_unprocessed_seq" on "DataChangeLog". That index is deliberately a
-- partial index (migration 20260629020000); the statement is removed here,
-- as in every migration generated since.

-- AddForeignKey
ALTER TABLE "ExecutionTarget" ADD CONSTRAINT "ExecutionTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTarget" ADD CONSTRAINT "ExecutionTarget_codeRepositoryId_fkey" FOREIGN KEY ("codeRepositoryId") REFERENCES "CodeRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTarget" ADD CONSTRAINT "ExecutionTarget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunExecution" ADD CONSTRAINT "TestRunExecution_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRuns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunExecution" ADD CONSTRAINT "TestRunExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunExecution" ADD CONSTRAINT "TestRunExecution_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ExecutionTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunExecution" ADD CONSTRAINT "TestRunExecution_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
