-- Passkey (WebAuthn) sign-in: the credential table, the admin switch and the
-- two audit actions for registering and removing a passkey.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PASSKEY_REGISTERED';
ALTER TYPE "AuditAction" ADD VALUE 'PASSKEY_REMOVED';

-- AlterTable
ALTER TABLE "RegistrationSettings" ADD COLUMN     "allowPasskeys" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "aaguid" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- NOTE: `migrate dev` also emitted `CREATE INDEX "dcl_unprocessed_seq" ON
-- "DataChangeLog"("seq")` here. Deliberately dropped: that index is a PARTIAL
-- index created by 20260629020000_datachangelog_partial_poll_index, which
-- Prisma cannot express, so it re-emits a plain copy on every migration.

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
