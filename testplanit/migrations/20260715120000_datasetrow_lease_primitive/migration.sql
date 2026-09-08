-- Row-level lease primitive (999.12) for test-data reservation. Lets a
-- parallel CI orchestrator atomically check out one unlocked DataSetRow at a
-- time (acquire), renew it (extend), and hand it back (release) so two jobs
-- never provision the same external fixture. `leaseToken` is the per-acquire
-- fencing token the holder presents to renew/release; `leasedById` records the
-- authenticated actor for RBAC + audit; `leaseExpiresAt` is the TTL deadline
-- (a lease with `leaseExpiresAt < now()` is treated as free by the acquire
-- query, so a down sweep never blocks acquisition).
--
-- All four columns are additive + nullable — a NULL `leaseToken` means the row
-- is unleased, so this cannot conflict with existing rows.
ALTER TABLE "DataSetRow" ADD COLUMN "leasedById" TEXT;
ALTER TABLE "DataSetRow" ADD COLUMN "leasedAt" TIMESTAMPTZ(6);
ALTER TABLE "DataSetRow" ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(6);
ALTER TABLE "DataSetRow" ADD COLUMN "leaseToken" TEXT;

-- Sweep scan: reap rows whose lease has expired.
CREATE INDEX "DataSetRow_leaseExpiresAt_idx" ON "DataSetRow"("leaseExpiresAt");

-- Acquire scan: find the next free row within one dataset (pool) ordered by
-- rowIndex, skipping still-leased rows.
CREATE INDEX "DataSetRow_dataSetId_leaseExpiresAt_idx" ON "DataSetRow"("dataSetId", "leaseExpiresAt");
