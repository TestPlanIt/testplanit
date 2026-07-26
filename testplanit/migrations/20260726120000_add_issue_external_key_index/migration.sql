-- Index tracker-key lookups on Issue: `externalId` is indexed but `externalKey`
-- is not, so the Testmo importer's per-issue (externalKey, integrationId)
-- resolve and sync's `externalId OR externalKey` match both fall back to a
-- sequential scan.

CREATE INDEX IF NOT EXISTS "Issue_externalKey_integrationId_idx" ON "Issue"("externalKey", "integrationId");
