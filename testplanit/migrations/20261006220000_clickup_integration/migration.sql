-- ClickUp joins the issue-tracker providers and the inbound webhook
-- adapters. An inbound webhook TestPlanIt registered through the tracker API
-- remembers the tracker-side webhook id so it can be removed again.

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'CLICKUP';

-- AlterEnum
ALTER TYPE "AdapterType" ADD VALUE 'CLICKUP';

-- AlterTable
ALTER TABLE "WebhookConfig" ADD COLUMN "externalWebhookId" TEXT;
