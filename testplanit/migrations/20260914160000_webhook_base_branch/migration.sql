-- A repository webhook can name the branch its pushes compare against.
ALTER TABLE "WebhookConfig" ADD COLUMN "baseBranch" TEXT;
