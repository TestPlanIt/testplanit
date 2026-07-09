-- AlterTable
ALTER TABLE "Milestones" ADD COLUMN     "detachedAt" TIMESTAMPTZ(6),
ADD COLUMN     "mergedToExternalId" TEXT;
