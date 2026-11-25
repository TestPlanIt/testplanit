-- CreateEnum
CREATE TYPE "CaseChangeSuggestionKind" AS ENUM ('UPDATE', 'RETIRE');

-- CreateEnum
CREATE TYPE "CaseChangeSuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED', 'SUPERSEDED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CASES_UPDATED';

-- AlterEnum
ALTER TYPE "WebhookActionTrigger" ADD VALUE 'ISSUE_CONTENT_CHANGED';

-- AlterEnum
ALTER TYPE "WebhookActionType" ADD VALUE 'UPDATE_CASES';

-- AlterTable
ALTER TABLE "RepositoryCaseIssue" ADD COLUMN     "alignedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "RepositoryCases" ADD COLUMN     "aiWrittenVersion" INTEGER,
ADD COLUMN     "reviewedAt" TIMESTAMPTZ(6),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "Workflows" ADD COLUMN     "isAiDraft" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CaseChangeSuggestion" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "caseId" INTEGER NOT NULL,
    "issueId" INTEGER NOT NULL,
    "issueContentUpdatedAt" TIMESTAMPTZ(6),
    "baseCaseVersion" INTEGER NOT NULL,
    "kind" "CaseChangeSuggestionKind" NOT NULL,
    "proposed" JSONB,
    "rationale" TEXT,
    "status" "CaseChangeSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "webhookActionId" TEXT,
    "deliveryId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "lastRemindedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseChangeSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseChangeSuggestion_caseId_status_idx" ON "CaseChangeSuggestion"("caseId", "status");

-- CreateIndex
CREATE INDEX "CaseChangeSuggestion_issueId_status_idx" ON "CaseChangeSuggestion"("issueId", "status");

-- CreateIndex
CREATE INDEX "CaseChangeSuggestion_projectId_status_idx" ON "CaseChangeSuggestion"("projectId", "status");

-- AddForeignKey
ALTER TABLE "CaseChangeSuggestion" ADD CONSTRAINT "CaseChangeSuggestion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RepositoryCases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseChangeSuggestion" ADD CONSTRAINT "CaseChangeSuggestion_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
