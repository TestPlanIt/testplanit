-- SCIM `roles` core-attribute hybrid (HYBRID-01).
--
-- `User.scimRoles` is the flattened, lowercased projection of the `roles`
-- values the IdP last asserted; the full array still round-trips verbatim
-- through `scimExtensions`. `ScimRoleMapping` is the admin-configured
-- role-value -> access-tier table that resolveEffectiveAccess reads, and
-- whose tiers take precedence over group-derived ones.
--
-- Existing rows are backfilled to an empty array, which means "the IdP has
-- asserted no roles for this user" and leaves group mapping in charge. The
-- next SCIM write per user populates the column.

-- AlterTable
-- No column DEFAULT: Prisma models a String[] without one, and adding a
-- default here shows up forever as schema drift. Existing rows are backfilled
-- explicitly instead, so no row is left NULL.
ALTER TABLE "User" ADD COLUMN     "scimRoles" TEXT[];
UPDATE "User" SET "scimRoles" = ARRAY[]::TEXT[] WHERE "scimRoles" IS NULL;

-- CreateTable
CREATE TABLE "ScimRoleMapping" (
    "id" SERIAL NOT NULL,
    "roleValue" TEXT NOT NULL,
    "mappedAccess" "Access" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ScimRoleMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScimRoleMapping_roleValue_key" ON "ScimRoleMapping"("roleValue");

-- CreateIndex
CREATE INDEX "ScimRoleMapping_roleValue_idx" ON "ScimRoleMapping"("roleValue");
