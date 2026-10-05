-- CreateEnum
CREATE TYPE "DetailsDisplayMode" AS ENUM ('DOCKED', 'NEW_WINDOW');

-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN "detailsDisplayMode" "DetailsDisplayMode" NOT NULL DEFAULT 'DOCKED';
