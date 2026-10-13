-- Code Pins derived from ticket keys found in commit messages.
ALTER TYPE "CodePinSource" ADD VALUE 'ISSUE';

ALTER TABLE "ProjectCodeRepositoryConfig"
  ADD COLUMN "issueScanEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "issueScanReport" JSONB;
