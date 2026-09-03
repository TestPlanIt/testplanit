-- Device-bound magic-link + OTP sign-in (PASSWORDLESS_DEVICE_BOUND).
--
-- PendingAuth backs the scanner-proof passwordless flow: each sign-in request
-- stores only hashes of its three secrets (browser-bound verifier, emailed
-- link token, human relay code — the code as bcrypt over the HMAC, the two
-- 256-bit tokens as keyed HMAC-SHA256). Rows are consumed exactly once via a
-- conditional status transition at completion; the emailed link's GET never
-- mutates this table, which is what defeats mail-scanner link prefetch
-- (Microsoft Safe Links, Mimecast, Proofpoint, Barracuda).
--
-- Purely additive: new enum + table + indexes, no existing data touched.
-- Guarded: 0.x releases created these same objects via db push, so upgraded
-- databases already have them.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "PendingAuthStatus" AS ENUM ('PENDING', 'CONSUMED', 'SUPERSEDED', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PendingAuth" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "verifierHash" TEXT NOT NULL,
    "linkTokenHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" "PendingAuthStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "callbackUrl" TEXT,
    "requestIp" TEXT,
    "requestUserAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "PendingAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PendingAuth_linkTokenHash_key" ON "PendingAuth"("linkTokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PendingAuth_email_status_idx" ON "PendingAuth"("email", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PendingAuth_expiresAt_idx" ON "PendingAuth"("expiresAt");
