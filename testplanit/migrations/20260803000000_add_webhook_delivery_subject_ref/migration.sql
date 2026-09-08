-- Identifier of the entity a webhook delivery was about (e.g. Jira issue key
-- "PROJ-123", GitHub "owner/repo#42", milestone "RELEASE:10012") so the
-- deliveries list can show what each row affected. Identifiers only — never
-- payload content (names, descriptions).
ALTER TABLE "WebhookDelivery" ADD COLUMN "subjectRef" TEXT;
