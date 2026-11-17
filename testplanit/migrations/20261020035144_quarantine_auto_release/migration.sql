-- Quarantine auto-release: project policy + per-quarantine opt-out.

-- AlterTable
ALTER TABLE "CaseQuarantine" ADD COLUMN     "keepUntilReleased" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Projects" ADD COLUMN     "quarantineAutoRelease" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quarantineAutoReleasePasses" INTEGER NOT NULL DEFAULT 5;
