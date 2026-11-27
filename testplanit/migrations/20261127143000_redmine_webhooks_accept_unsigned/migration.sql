-- Redmine webhooks created before this release receive deliveries from the
-- redmine_webhook plugin, which cannot sign. Unsigned deliveries are now
-- refused unless the webhook accepts them, so the existing ones keep doing so.
UPDATE "WebhookConfig"
SET "allowUnsigned" = true
WHERE "adapterType" = 'REDMINE'
  AND "direction" = 'INBOUND';
