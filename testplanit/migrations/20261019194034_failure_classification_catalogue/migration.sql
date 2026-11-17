-- Failure classifications become a configurable catalogue. The four seeded
-- entries replace the FailureClassification enum; existing signatures keep
-- their classification through the key → id mapping below.

-- AlterEnum
ALTER TYPE "AlertMetric" ADD VALUE 'NEW_FAILURE_SIGNATURES';

-- The table takes the enum's name; move the enum aside until its values are
-- carried over.
ALTER TYPE "FailureClassification" RENAME TO "FailureClassification_enum";

-- CreateTable
CREATE TABLE "FailureClassification" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT,
    "description" TEXT,
    "colorId" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureClassification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FailureClassification_name_key" ON "FailureClassification"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FailureClassification_key_key" ON "FailureClassification"("key");

-- AddForeignKey
ALTER TABLE "FailureClassification" ADD CONSTRAINT "FailureClassification_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the default catalogue. Colors come from the seeded palette when it
-- exists (mid shade of the family); db/seed.ts fills them in otherwise.
INSERT INTO "FailureClassification" ("name", "key", "description", "colorId", "order", "updatedAt")
VALUES
  ('Product bug', 'PRODUCT_BUG',
   'The application under test misbehaves: a wrong value, a server error, a broken flow. The same assertion fails consistently across runs.',
   (SELECT c.id FROM "Color" c JOIN "ColorFamily" f ON f.id = c."colorFamilyId" WHERE f.name = 'Red' AND c."order" = 3),
   1, CURRENT_TIMESTAMP),
  ('Test bug', 'TEST_BUG',
   'The test or its page objects are wrong or stale: a selector that no longer exists, hard-coded data, an assertion that can never pass, a missing wait that always fails.',
   (SELECT c.id FROM "Color" c JOIN "ColorFamily" f ON f.id = c."colorFamilyId" WHERE f.name = 'Orange' AND c."order" = 3),
   2, CURRENT_TIMESTAMP),
  ('Environment', 'ENVIRONMENT',
   'Infrastructure or configuration rather than code: connection refused, DNS, timeouts to every service, missing credentials, disk, browser or driver start-up, CI runner problems.',
   (SELECT c.id FROM "Color" c JOIN "ColorFamily" f ON f.id = c."colorFamilyId" WHERE f.name = 'Blue' AND c."order" = 3),
   3, CURRENT_TIMESTAMP),
  ('Flaky', 'FLAKY',
   'Intermittent: the same cases pass and fail without a code change (race conditions, timing-dependent waits, shared state). A pass/fail history that flips often is strong evidence.',
   (SELECT c.id FROM "Color" c JOIN "ColorFamily" f ON f.id = c."colorFamilyId" WHERE f.name = 'Yellow' AND c."order" = 3),
   4, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "FailureSignature"
ADD COLUMN     "aiClassificationId" INTEGER,
ADD COLUMN     "classificationId" INTEGER;

-- Carry the enum values over to the catalogue rows.
UPDATE "FailureSignature" s
SET "classificationId" = fc.id
FROM "FailureClassification" fc
WHERE fc.key = s."classification"::text;

UPDATE "FailureSignature" s
SET "aiClassificationId" = fc.id
FROM "FailureClassification" fc
WHERE s."aiClassification" IS NOT NULL
  AND fc.key = s."aiClassification"::text;

-- DropIndex
DROP INDEX "FailureSignature_projectId_classification_idx";

-- AlterTable
ALTER TABLE "FailureSignature" DROP COLUMN "aiClassification",
DROP COLUMN "classification";

-- DropEnum
DROP TYPE "FailureClassification_enum";

-- CreateIndex
CREATE INDEX "FailureSignature_projectId_classificationId_idx" ON "FailureSignature"("projectId", "classificationId");

-- CreateIndex
CREATE INDEX "FailureSignature_aiClassificationId_idx" ON "FailureSignature"("aiClassificationId");

-- AddForeignKey
ALTER TABLE "FailureSignature" ADD CONSTRAINT "FailureSignature_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "FailureClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailureSignature" ADD CONSTRAINT "FailureSignature_aiClassificationId_fkey" FOREIGN KEY ("aiClassificationId") REFERENCES "FailureClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
