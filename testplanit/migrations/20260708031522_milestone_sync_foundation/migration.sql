/*
  Warnings:

  - A unique constraint covering the columns `[externalId,integrationId]` on the table `Milestones` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "MilestoneExternalKind" AS ENUM ('RELEASE', 'ITERATION');

-- CreateEnum
CREATE TYPE "MilestoneIssueSource" AS ENUM ('SYNCED', 'MANUAL');

-- AlterTable
ALTER TABLE "Milestones" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalKind" "MilestoneExternalKind",
ADD COLUMN     "externalState" TEXT,
ADD COLUMN     "externalUrl" TEXT,
ADD COLUMN     "integrationId" INTEGER,
ADD COLUMN     "lastSyncedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "MilestoneIssue" (
    "milestoneId" INTEGER NOT NULL,
    "issueId" INTEGER NOT NULL,
    "source" "MilestoneIssueSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneIssue_pkey" PRIMARY KEY ("milestoneId","issueId")
);

-- CreateIndex
CREATE INDEX "MilestoneIssue_issueId_idx" ON "MilestoneIssue"("issueId");

-- CreateIndex
CREATE INDEX "Milestones_externalId_idx" ON "Milestones"("externalId");

-- CreateIndex
CREATE INDEX "Milestones_integrationId_idx" ON "Milestones"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestones_externalId_integrationId_key" ON "Milestones"("externalId", "integrationId");

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneIssue" ADD CONSTRAINT "MilestoneIssue_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneIssue" ADD CONSTRAINT "MilestoneIssue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
