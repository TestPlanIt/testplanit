-- Overlap-window SCIM token rotation (v0.24.0 D-08).
--
-- v1 shipped revoke + mint as the rotation pattern, which means a
-- provisioning outage between revoking the old bearer and pasting the new one
-- into the IdP. Rotation now happens in place: the row keeps its id, name,
-- IdP, rate-limit bucket, and every scimTokenId provenance link pointing at
-- it, and only the secret moves. The superseded bearer stays valid until
-- previousTokenExpiresAt.
--
-- Only one overlap can be open at a time — a second rotation overwrites these
-- columns, immediately invalidating the older bearer.

-- AlterTable
ALTER TABLE "ScimToken" ADD COLUMN     "previousToken" TEXT,
ADD COLUMN     "previousSecret" TEXT,
ADD COLUMN     "previousTokenPrefix" TEXT,
ADD COLUMN     "previousTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "rotatedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScimToken_previousToken_key" ON "ScimToken"("previousToken");

-- CreateIndex
CREATE INDEX "ScimToken_previousToken_idx" ON "ScimToken"("previousToken");

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_rotatedById_fkey" FOREIGN KEY ("rotatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
