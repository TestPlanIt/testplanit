-- WebhookConfig.allowUnsigned: an inbound webhook that accepts deliveries carrying no signature
-- (a Jira Server that cannot sign). Off for every existing webhook.
ALTER TABLE "WebhookConfig" ADD COLUMN "allowUnsigned" BOOLEAN NOT NULL DEFAULT false;
