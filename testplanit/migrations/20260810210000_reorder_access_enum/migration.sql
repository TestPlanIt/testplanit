-- Rebuild the "Access" enum in the order schema.zmodel already declares
-- (NONE, USER, PROJECTADMIN, ADMIN) so ascending sorts read least-to-most
-- privilege. "NONE" was appended to the live type after the original values,
-- leaving the database order (USER, PROJECTADMIN, ADMIN, NONE) out of line
-- with the schema; Postgres cannot reorder enum values in place, so the type
-- is recreated and every dependent column re-pointed. Values in the data are
-- unchanged — only the type's sort order moves.
ALTER TYPE "Access" RENAME TO "Access_old";
CREATE TYPE "Access" AS ENUM ('NONE', 'USER', 'PROJECTADMIN', 'ADMIN');

-- Defaults reference the old type and must be dropped before the column swap
-- and restored after ("Groups"."mappedAccess" has no default).
ALTER TABLE "User" ALTER COLUMN "access" DROP DEFAULT;
ALTER TABLE "RegistrationSettings" ALTER COLUMN "defaultAccess" DROP DEFAULT;
ALTER TABLE "SamlConfiguration" ALTER COLUMN "defaultAccess" DROP DEFAULT;

ALTER TABLE "User" ALTER COLUMN "access" TYPE "Access" USING ("access"::text::"Access");
ALTER TABLE "Groups" ALTER COLUMN "mappedAccess" TYPE "Access" USING ("mappedAccess"::text::"Access");
ALTER TABLE "RegistrationSettings" ALTER COLUMN "defaultAccess" TYPE "Access" USING ("defaultAccess"::text::"Access");
ALTER TABLE "SamlConfiguration" ALTER COLUMN "defaultAccess" TYPE "Access" USING ("defaultAccess"::text::"Access");

ALTER TABLE "User" ALTER COLUMN "access" SET DEFAULT 'NONE'::"Access";
ALTER TABLE "RegistrationSettings" ALTER COLUMN "defaultAccess" SET DEFAULT 'NONE'::"Access";
ALTER TABLE "SamlConfiguration" ALTER COLUMN "defaultAccess" SET DEFAULT 'USER'::"Access";

DROP TYPE "Access_old";
