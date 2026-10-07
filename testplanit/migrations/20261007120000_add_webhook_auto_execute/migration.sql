-- AlterTable
ALTER TABLE "WebhookConfig" ADD COLUMN "autoExecuteEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoExecuteTargetId" INTEGER,
ADD COLUMN "autoExecuteRef" TEXT,
ADD COLUMN "autoExecuteInputs" JSONB NOT NULL DEFAULT '{}';
