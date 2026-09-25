-- Saved CSV import column mappings, private to their creator unless shared.
CREATE TYPE "ImportMappingWizard" AS ENUM ('TEST_CASES', 'SHARED_STEPS', 'DATASET');

CREATE TABLE "ImportMapping" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "wizard" "ImportMappingWizard" NOT NULL,
    "config" JSONB NOT NULL,
    "templateId" INTEGER,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportMapping_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportMapping_createdById_wizard_isDeleted_idx" ON "ImportMapping"("createdById", "wizard", "isDeleted");

CREATE INDEX "ImportMapping_wizard_isShared_isDeleted_idx" ON "ImportMapping"("wizard", "isShared", "isDeleted");

ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
