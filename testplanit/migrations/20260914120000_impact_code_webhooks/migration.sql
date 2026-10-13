-- Repository webhooks start Impact analyses: Bitbucket joins the inbound
-- adapters, an inbound webhook can belong to a repository connection, and an
-- analysis records the event that started it.
ALTER TYPE "AdapterType" ADD VALUE 'BITBUCKET';

ALTER TABLE "WebhookConfig" ADD COLUMN "codeRepositoryConfigId" INTEGER;
ALTER TABLE "WebhookConfig"
  ADD CONSTRAINT "WebhookConfig_codeRepositoryConfigId_fkey"
  FOREIGN KEY ("codeRepositoryConfigId") REFERENCES "ProjectCodeRepositoryConfig"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "WebhookConfig_codeRepositoryConfigId_idx" ON "WebhookConfig"("codeRepositoryConfigId");

ALTER TABLE "ImpactAnalysis"
  ADD COLUMN "trigger" TEXT,
  ADD COLUMN "triggerLabel" TEXT,
  ADD COLUMN "triggerUrl" TEXT;
