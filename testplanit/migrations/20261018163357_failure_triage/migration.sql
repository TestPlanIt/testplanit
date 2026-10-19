-- CreateEnum
CREATE TYPE "FailureFingerprintKind" AS ENUM ('STACK', 'MESSAGE', 'NONE');

-- CreateEnum
CREATE TYPE "FailureClassification" AS ENUM ('UNCLASSIFIED', 'PRODUCT_BUG', 'TEST_BUG', 'ENVIRONMENT', 'FLAKY');

-- CreateEnum
CREATE TYPE "FailureClassificationSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "FailureSignatureStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- AlterTable
ALTER TABLE "JUnitTestResult" ADD COLUMN     "failureSignatureId" INTEGER;

-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "failureTriageAutoClassify" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "failureTriageEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "FailureSignature" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" "FailureFingerprintKind" NOT NULL,
    "title" TEXT NOT NULL,
    "exceptionType" TEXT,
    "normalizedMessage" TEXT,
    "frames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "flakyCandidate" BOOLEAN NOT NULL DEFAULT false,
    "status" "FailureSignatureStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMPTZ(6),
    "resolvedById" TEXT,
    "classification" "FailureClassification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "classificationSource" "FailureClassificationSource",
    "classifiedAt" TIMESTAMPTZ(6),
    "classifiedById" TEXT,
    "aiClassification" "FailureClassification",
    "aiConfidence" DOUBLE PRECISION,
    "aiRationale" TEXT,
    "aiSuggestedIssueTitle" TEXT,
    "aiSuggestedNextStep" TEXT,
    "aiModel" TEXT,
    "aiClassifiedAt" TIMESTAMPTZ(6),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailureSignatureIssue" (
    "signatureId" INTEGER NOT NULL,
    "issueId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailureSignatureIssue_pkey" PRIMARY KEY ("signatureId","issueId")
);

-- CreateTable
CREATE TABLE "CaseQuarantine" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "signatureId" INTEGER,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseQuarantine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailureSignature_projectId_status_lastSeenAt_idx" ON "FailureSignature"("projectId", "status", "lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "FailureSignature_projectId_classification_idx" ON "FailureSignature"("projectId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "FailureSignature_projectId_fingerprint_key" ON "FailureSignature"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "FailureSignatureIssue_issueId_idx" ON "FailureSignatureIssue"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseQuarantine_caseId_key" ON "CaseQuarantine"("caseId");

-- CreateIndex
CREATE INDEX "CaseQuarantine_projectId_idx" ON "CaseQuarantine"("projectId");

-- CreateIndex
CREATE INDEX "CaseQuarantine_signatureId_idx" ON "CaseQuarantine"("signatureId");

-- NOTE: `migrate dev` also emitted `CREATE INDEX "dcl_unprocessed_seq" ON
-- "DataChangeLog"("seq")` here. Deliberately dropped: that index is a PARTIAL
-- index (WHERE "processed" = false) created by
-- 20260629020000_datachangelog_partial_poll_index, which Prisma cannot express,
-- so it re-emits a plain copy on every migration. Left in, it aborts the
-- migration (42P07) on any real database.

-- CreateIndex
CREATE INDEX "JUnitTestResult_failureSignatureId_executedAt_idx" ON "JUnitTestResult"("failureSignatureId", "executedAt" DESC);

-- AddForeignKey
ALTER TABLE "JUnitTestResult" ADD CONSTRAINT "JUnitTestResult_failureSignatureId_fkey" FOREIGN KEY ("failureSignatureId") REFERENCES "FailureSignature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureSignature" ADD CONSTRAINT "FailureSignature_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureSignature" ADD CONSTRAINT "FailureSignature_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureSignature" ADD CONSTRAINT "FailureSignature_classifiedById_fkey" FOREIGN KEY ("classifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureSignatureIssue" ADD CONSTRAINT "FailureSignatureIssue_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "FailureSignature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureSignatureIssue" ADD CONSTRAINT "FailureSignatureIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseQuarantine" ADD CONSTRAINT "CaseQuarantine_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseQuarantine" ADD CONSTRAINT "CaseQuarantine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseQuarantine" ADD CONSTRAINT "CaseQuarantine_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "FailureSignature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseQuarantine" ADD CONSTRAINT "CaseQuarantine_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
