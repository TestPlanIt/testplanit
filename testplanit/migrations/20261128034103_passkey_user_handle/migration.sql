-- Each passkey keeps the account id its device was given when it was created,
-- so sign-in checks the stored value and the way the id is built can change
-- without invalidating existing passkeys.

-- AlterTable
ALTER TABLE "Passkey" ADD COLUMN     "userHandle" TEXT;

-- Passkeys created before this column existed were given the user's id itself
-- (its UTF-8 bytes, base64url-encoded without padding).
UPDATE "Passkey"
SET "userHandle" = translate(
  rtrim(replace(encode(convert_to("userId", 'UTF8'), 'base64'), E'\n', ''), '='),
  '+/',
  '-_'
)
WHERE "userHandle" IS NULL;

ALTER TABLE "Passkey" ALTER COLUMN "userHandle" SET NOT NULL;

-- NOTE: `migrate dev` also emitted `CREATE INDEX "dcl_unprocessed_seq" ON
-- "DataChangeLog"("seq")` here. Deliberately dropped: that index is a PARTIAL
-- index created by 20260629020000_datachangelog_partial_poll_index, which
-- Prisma cannot express, so it re-emits a plain copy on every migration.
