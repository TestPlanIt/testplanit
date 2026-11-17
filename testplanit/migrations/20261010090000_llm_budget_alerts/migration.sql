-- AI budget alerts through the alert rules (#651 follow-up): a system-scope
-- metric replaces the hardcoded 80/90/100% notifications. System rules
-- carry no project, so the project columns become nullable.

ALTER TYPE "AlertMetric" ADD VALUE 'LLM_BUDGET_USED';
ALTER TYPE "AlertScopeType" ADD VALUE 'LLM_INTEGRATION';
ALTER TYPE "AlertSubjectType" ADD VALUE 'LLM_INTEGRATION';

ALTER TABLE "AlertRule" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "AlertEvent" ALTER COLUMN "projectId" DROP NOT NULL;

-- The per-period fired-threshold ledger belonged to the hardcoded path; the
-- rules dedupe on their own history, reset by this stamp.
ALTER TABLE "LlmProviderConfig" DROP COLUMN "alertThresholdsFired";
ALTER TABLE "LlmProviderConfig" ADD COLUMN "budgetAlertResetAt" TIMESTAMPTZ(6);
