-- The tracker's own priority, written only by the sync path — the priority
-- analogue of "externalStatus", so a detached requirement's locally edited
-- priority and the tracker's value can coexist and resolve lock-aware.
ALTER TABLE "Issue" ADD COLUMN "externalPriority" TEXT;
