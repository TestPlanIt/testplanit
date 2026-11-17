-- CreateEnum
CREATE TYPE "StepLayout" AS ENUM ('STACKED', 'SIDE_BY_SIDE');

-- AlterTable
ALTER TABLE "UserPreferences" ADD COLUMN "stepLayout" "StepLayout" NOT NULL DEFAULT 'STACKED';
