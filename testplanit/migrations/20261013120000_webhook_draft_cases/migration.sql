-- Draft test cases with AI: the notification its recipients get, and the
-- folder a rule's drafts landed in.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CASES_DRAFTED';

-- AlterTable
ALTER TABLE "WebhookActionLog" ADD COLUMN "folderId" INTEGER;
