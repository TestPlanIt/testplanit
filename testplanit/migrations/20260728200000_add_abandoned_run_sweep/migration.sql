-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "abandonedRunIdleMinutes" INTEGER,
ADD COLUMN     "abandonedRunStateId" INTEGER;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_abandonedRunStateId_fkey" FOREIGN KEY ("abandonedRunStateId") REFERENCES "Workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
