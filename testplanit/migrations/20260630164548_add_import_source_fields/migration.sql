/*
  Warnings:

  - A unique constraint covering the columns `[projectId,importSource,importSourceId]` on the table `RepositoryCases` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[projectId,importSource,importSourceId]` on the table `Sessions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[projectId,importSource,importSourceId]` on the table `TestRuns` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RepositoryCases" ADD COLUMN     "importSource" TEXT,
ADD COLUMN     "importSourceId" TEXT;

-- AlterTable
ALTER TABLE "Sessions" ADD COLUMN     "importSource" TEXT,
ADD COLUMN     "importSourceId" TEXT;

-- AlterTable
ALTER TABLE "TestRuns" ADD COLUMN     "importSource" TEXT,
ADD COLUMN     "importSourceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryCases_projectId_importSource_importSourceId_key" ON "RepositoryCases"("projectId", "importSource", "importSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Sessions_projectId_importSource_importSourceId_key" ON "Sessions"("projectId", "importSource", "importSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TestRuns_projectId_importSource_importSourceId_key" ON "TestRuns"("projectId", "importSource", "importSourceId");
