-- Snapshot of who an alert event notified, taken at fire time.
ALTER TABLE "AlertEvent" ADD COLUMN "recipientIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
