-- Inbound webhook actions: rules that replace the repository webhook's event
-- switches, minimum score and auto-execute columns, plus a per-action log.

-- CreateEnum
CREATE TYPE "WebhookActionTrigger" AS ENUM ('ISSUE_EVENT', 'ISSUE_CREATED', 'ISSUE_STATUS_ENTERED', 'CODE_PULL_REQUEST', 'CODE_PUSH', 'CODE_BRANCH_PUSH');

-- CreateEnum
CREATE TYPE "WebhookActionType" AS ENUM ('IMPORT_ISSUE', 'CREATE_RUN', 'DRAFT_CASES');

-- CreateTable
CREATE TABLE "WebhookAction" (
    "id" TEXT NOT NULL,
    "webhookConfigId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "WebhookActionTrigger" NOT NULL,
    "action" "WebhookActionType" NOT NULL,
    "filter" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookActionLog" (
    "id" TEXT NOT NULL,
    "webhookActionId" TEXT,
    "webhookConfigId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "projectId" INTEGER NOT NULL,
    "issueId" INTEGER,
    "analysisId" INTEGER,
    "testRunId" INTEGER,
    "caseCount" INTEGER,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookAction_webhookConfigId_order_idx" ON "WebhookAction"("webhookConfigId", "order");

-- CreateIndex
CREATE INDEX "WebhookAction_projectId_idx" ON "WebhookAction"("projectId");

-- CreateIndex
CREATE INDEX "WebhookActionLog_webhookActionId_createdAt_idx" ON "WebhookActionLog"("webhookActionId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookActionLog_webhookConfigId_createdAt_idx" ON "WebhookActionLog"("webhookConfigId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookActionLog_webhookActionId_analysisId_idx" ON "WebhookActionLog"("webhookActionId", "analysisId");

-- CreateIndex
CREATE INDEX "WebhookActionLog_deliveryId_idx" ON "WebhookActionLog"("deliveryId");

-- AddForeignKey
ALTER TABLE "WebhookAction" ADD CONSTRAINT "WebhookAction_webhookConfigId_fkey" FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookAction" ADD CONSTRAINT "WebhookAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookActionLog" ADD CONSTRAINT "WebhookActionLog_webhookActionId_fkey" FOREIGN KEY ("webhookActionId") REFERENCES "WebhookAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookActionLog" ADD CONSTRAINT "WebhookActionLog_webhookConfigId_fkey" FOREIGN KEY ("webhookConfigId") REFERENCES "WebhookConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookActionLog" ADD CONSTRAINT "WebhookActionLog_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one Create test run rule per event a repository webhook had on,
-- carrying its minimum score and auto-execute settings.
INSERT INTO "WebhookAction" ("id", "webhookConfigId", "projectId", "order", "isEnabled", "trigger", "action", "filter", "options", "updatedAt")
SELECT
    'wha_' || replace(gen_random_uuid()::text, '-', ''),
    w."id",
    w."projectId",
    e.ord,
    true,
    e.trigger::"WebhookActionTrigger",
    'CREATE_RUN',
    '{}',
    jsonb_strip_nulls(jsonb_build_object(
        'minScore', w."autoRunMinScore",
        'autoExecute', CASE
            WHEN w."autoExecuteEnabled" AND w."autoExecuteTargetId" IS NOT NULL THEN
                jsonb_strip_nulls(jsonb_build_object(
                    'targetId', w."autoExecuteTargetId",
                    'ref', w."autoExecuteRef",
                    'inputs', w."autoExecuteInputs"
                ))
            ELSE NULL
        END
    )),
    CURRENT_TIMESTAMP
FROM "WebhookConfig" w
JOIN (VALUES
    ('code:pull_request', 'CODE_PULL_REQUEST', 0),
    ('code:push', 'CODE_PUSH', 1),
    ('code:branch_push', 'CODE_BRANCH_PUSH', 2)
) AS e(event, trigger, ord) ON e.event = ANY(w."subscribedEvents")
WHERE w."direction" = 'INBOUND' AND w."codeRepositoryConfigId" IS NOT NULL;

-- Backfill: tracker webhooks keep importing issues TestPlanIt doesn't have yet.
INSERT INTO "WebhookAction" ("id", "webhookConfigId", "projectId", "order", "isEnabled", "trigger", "action", "filter", "options", "updatedAt")
SELECT
    'wha_' || replace(gen_random_uuid()::text, '-', ''),
    w."id",
    w."projectId",
    0,
    true,
    'ISSUE_EVENT',
    'IMPORT_ISSUE',
    '{}',
    '{}',
    CURRENT_TIMESTAMP
FROM "WebhookConfig" w
WHERE w."direction" = 'INBOUND' AND w."codeRepositoryConfigId" IS NULL;

-- Repository webhooks no longer read their event list.
UPDATE "WebhookConfig" SET "subscribedEvents" = '{}'
WHERE "direction" = 'INBOUND' AND "codeRepositoryConfigId" IS NOT NULL;

-- AlterTable
ALTER TABLE "WebhookConfig" DROP COLUMN "autoExecuteEnabled",
DROP COLUMN "autoExecuteInputs",
DROP COLUMN "autoExecuteRef",
DROP COLUMN "autoExecuteTargetId",
DROP COLUMN "autoRunMinScore";
