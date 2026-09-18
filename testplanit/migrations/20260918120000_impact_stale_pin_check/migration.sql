-- A project-wide stale Code Pin check records, per pin, when it was last
-- evaluated and why it could not be found at the branch tip; the connection
-- keeps the check's summary.
ALTER TABLE "RepositoryCaseCodePin"
  ADD COLUMN "staleCheckedAt" TIMESTAMPTZ(6),
  ADD COLUMN "staleReason" TEXT;

ALTER TABLE "ProjectCodeRepositoryConfig" ADD COLUMN "stalePinReport" JSONB;
