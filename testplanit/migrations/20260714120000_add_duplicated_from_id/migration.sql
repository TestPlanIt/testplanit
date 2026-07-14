-- Provenance marker for duplicated runs/sessions. `duplicatedFromId` holds the
-- source row's id when a Session or TestRun was created by duplicating another,
-- letting the sideEffectsPlugin emit the session.duplicated / test_run.duplicated
-- webhook events instead of the generic .created. Additive + nullable — a NULL
-- means "not a duplicate", so it cannot conflict with existing rows.
ALTER TABLE "Sessions" ADD COLUMN "duplicatedFromId" INTEGER;
ALTER TABLE "TestRuns" ADD COLUMN "duplicatedFromId" INTEGER;
