-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_DECISION_REVERTED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REVIEW_DECISION_REVERTED';

-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "revertDecisionDurationSeconds" INTEGER;

-- AlterTable
ALTER TABLE "ReviewRequest" ADD COLUMN     "revertCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revertedAt" TIMESTAMPTZ(6),
ADD COLUMN     "revertedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_revertedByUserId_fkey" FOREIGN KEY ("revertedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
