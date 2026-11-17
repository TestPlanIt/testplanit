-- AlterTable
ALTER TABLE "CaseDraft" ADD COLUMN     "isSaved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "problemCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rowCount" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "CaseDraft_userId_isSaved_idx" ON "CaseDraft"("userId", "isSaved");
