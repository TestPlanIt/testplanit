-- Cross-IdP provenance for SCIM-provisioned rows (V2-MULTI-IDP-01).
--
-- Records which SCIM token last claimed a User or Groups row so two identity
-- providers pointed at the same tenant can no longer silently overwrite each
-- other's directory. Ownership is enforced by the owning token's IdP rather
-- than its id (see lib/scim/ownership.ts), so the documented revoke + mint
-- rotation keeps a directory's rows writable.
--
-- Existing rows stay NULL = unowned, which is what keeps this migration safe
-- for a live single-IdP deployment: every row remains readable and writable
-- by the current token, and each is claimed by the first write that touches
-- it. ON DELETE SET NULL returns rows to unowned if a token row is ever hard-
-- deleted, rather than leaving them permanently unwritable.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "scimTokenId" TEXT;

-- AlterTable
ALTER TABLE "Groups" ADD COLUMN     "scimTokenId" TEXT;

-- CreateIndex
CREATE INDEX "User_scimTokenId_idx" ON "User"("scimTokenId");

-- CreateIndex
CREATE INDEX "Groups_scimTokenId_idx" ON "Groups"("scimTokenId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_scimTokenId_fkey" FOREIGN KEY ("scimTokenId") REFERENCES "ScimToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Groups" ADD CONSTRAINT "Groups_scimTokenId_fkey" FOREIGN KEY ("scimTokenId") REFERENCES "ScimToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
