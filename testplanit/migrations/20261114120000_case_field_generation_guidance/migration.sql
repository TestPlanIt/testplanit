-- CaseFields.generationGuidance: text an administrator writes for the model that generates test
-- cases, printed under the field's line in the generation prompt.
ALTER TABLE "CaseFields" ADD COLUMN "generationGuidance" TEXT;

-- The generation prompt used to carry this advice itself, addressed to fields by name. It now
-- lives on the fields, so existing fields with those names keep the same instruction.
UPDATE "CaseFields"
SET "generationGuidance" = 'Say in one or two sentences what the test validates.'
WHERE "generationGuidance" IS NULL
  AND "isDeleted" = false
  AND lower("displayName") LIKE '%description%';

UPDATE "CaseFields"
SET "generationGuidance" = 'A short list of the state, test data, and permissions needed before the first step, one item per line.'
WHERE "generationGuidance" IS NULL
  AND "isDeleted" = false
  AND lower("displayName") SIMILAR TO '%pre[- ]?condition%';

UPDATE "CaseFields"
SET "generationGuidance" = 'Note only system state that matters after the test, such as data to clean up.'
WHERE "generationGuidance" IS NULL
  AND "isDeleted" = false
  AND lower("displayName") SIMILAR TO '%post[- ]?condition%';

-- The built-in Priority field, while it still has its Critical and Low options.
UPDATE "CaseFields" cf
SET "generationGuidance" = 'Critical is the highest priority and Low is the lowest. Start from the source issue''s priority: give the case for the core happy path the highest value, and edge and negative cases one or two levels lower.'
WHERE cf."generationGuidance" IS NULL
  AND cf."isDeleted" = false
  AND cf."systemName" = 'priority'
  AND EXISTS (
    SELECT 1 FROM "CaseFieldAssignment" a
    JOIN "FieldOptions" o ON o."id" = a."fieldOptionId"
    WHERE a."caseFieldId" = cf."id" AND o."isDeleted" = false AND o."name" = 'Critical'
  )
  AND EXISTS (
    SELECT 1 FROM "CaseFieldAssignment" a
    JOIN "FieldOptions" o ON o."id" = a."fieldOptionId"
    WHERE a."caseFieldId" = cf."id" AND o."isDeleted" = false AND o."name" = 'Low'
  );
