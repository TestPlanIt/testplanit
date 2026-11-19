-- Marks the seeded sample project so the app no longer finds it by its English
-- name, and records whether an administrator dismissed the setup checklist.

-- AlterTable
ALTER TABLE "Projects" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN "hasDismissedSetupChecklist" BOOLEAN NOT NULL DEFAULT false;

-- Existing installs: the seeded project was only identifiable by its name.
UPDATE "Projects" SET "isDemo" = true WHERE "name" = 'Demo Project';
