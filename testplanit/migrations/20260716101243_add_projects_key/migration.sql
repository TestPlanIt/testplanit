-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Projects_key_key" ON "Projects"("key");
