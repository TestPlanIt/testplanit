-- Notification type for OAuth integrations whose token can no longer be refreshed
ALTER TYPE "NotificationType" ADD VALUE 'INTEGRATION_AUTH_EXPIRED';

-- Marks a UserIntegrationAuth whose access token expired with no usable refresh
-- token (or whose refresh was rejected by the provider). Cleared on re-auth.
ALTER TABLE "UserIntegrationAuth" ADD COLUMN "needsReauthAt" TIMESTAMP(3);
