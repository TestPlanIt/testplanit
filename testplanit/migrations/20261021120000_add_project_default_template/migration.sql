-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "defaultTemplateId" INTEGER;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_defaultTemplateId_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "Templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
