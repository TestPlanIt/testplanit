-- Audit log retention: archive/purge audit actions and one manifest row per archive object.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'AUDIT_LOG_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'AUDIT_LOG_PURGED';

-- CreateTable
CREATE TABLE "AuditLogArchive" (
    "id" SERIAL NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "firstTimestamp" TIMESTAMPTZ(6) NOT NULL,
    "lastTimestamp" TIMESTAMPTZ(6) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditLogArchive_key_key" ON "AuditLogArchive"("key");

-- CreateIndex
CREATE INDEX "AuditLogArchive_periodStart_idx" ON "AuditLogArchive"("periodStart");

-- CreateIndex
CREATE INDEX "AuditLogArchive_lastTimestamp_idx" ON "AuditLogArchive"("lastTimestamp");
