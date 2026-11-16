-- The storage scan started from Admin > Attachments: its runs, the objects it
-- found in the bucket, and the attachments whose file it did not find.

-- CreateEnum
CREATE TYPE "StorageScanStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StorageObjectStatus" AS ENUM ('REFERENCED', 'ORPHAN');

-- CreateTable
CREATE TABLE "StorageScan" (
    "id" SERIAL NOT NULL,
    "status" "StorageScanStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "startedById" TEXT,
    "objectCount" INTEGER NOT NULL DEFAULT 0,
    "objectBytes" BIGINT NOT NULL DEFAULT 0,
    "orphanCount" INTEGER NOT NULL DEFAULT 0,
    "orphanBytes" BIGINT NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "StorageScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageObject" (
    "key" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "lastModified" TIMESTAMPTZ(6) NOT NULL,
    "folder" TEXT NOT NULL,
    "status" "StorageObjectStatus" NOT NULL,
    "scanId" INTEGER NOT NULL,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StorageMissingFile" (
    "attachmentId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "scanId" INTEGER NOT NULL,

    CONSTRAINT "StorageMissingFile_pkey" PRIMARY KEY ("attachmentId")
);

-- CreateIndex
CREATE INDEX "StorageScan_startedAt_idx" ON "StorageScan"("startedAt");

-- CreateIndex
CREATE INDEX "StorageObject_status_folder_idx" ON "StorageObject"("status", "folder");

-- CreateIndex
CREATE INDEX "StorageObject_scanId_idx" ON "StorageObject"("scanId");

-- CreateIndex
CREATE INDEX "StorageMissingFile_scanId_idx" ON "StorageMissingFile"("scanId");
