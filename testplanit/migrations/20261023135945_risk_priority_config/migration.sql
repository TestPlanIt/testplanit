-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "riskCriticalityFieldId" INTEGER,
ADD COLUMN     "riskPriorityWeights" JSONB;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_riskCriticalityFieldId_fkey" FOREIGN KEY ("riskCriticalityFieldId") REFERENCES "CaseFields"("id") ON DELETE SET NULL ON UPDATE CASCADE;
