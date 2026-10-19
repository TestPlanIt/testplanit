-- Failure signature notes are Tiptap documents; convert the column in place.
-- Existing plain-text notes become JSON strings, which the rich-text readers
-- (normalizeTiptapInput) already accept and wrap as paragraphs.
ALTER TABLE "FailureSignature"
  ALTER COLUMN "notes" TYPE JSONB USING to_jsonb("notes");

-- NOTE: `migrate dev` also emitted `CREATE INDEX "dcl_unprocessed_seq" ON
-- "DataChangeLog"("seq")` here. Deliberately dropped: that index is a PARTIAL
-- index created by 20260629020000_datachangelog_partial_poll_index, which
-- Prisma cannot express, so it re-emits a plain copy on every migration.
