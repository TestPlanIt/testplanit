-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WHATS_NEW';

-- AlterTable
ALTER TABLE "UserPreferences" DROP COLUMN "emailNotifications",
DROP COLUMN "inAppNotifications",
ADD COLUMN     "mutedNotificationTypes" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];

-- `dcl_unprocessed_seq` is deliberately NOT recreated here. Migration
-- 20260629020000_datachangelog_partial_poll_index replaced the plain btree
-- with a PARTIAL index (`WHERE "processed" = false`) for the CDC poll. Prisma's
-- schema language cannot express a partial index, so every `migrate dev` diff
-- reports the index as missing and emits a plain `CREATE INDEX` for it. Left in,
-- that statement aborts the migration on any real database (42P07).
