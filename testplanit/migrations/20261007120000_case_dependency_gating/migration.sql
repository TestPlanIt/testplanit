-- Opt-in per project: a run case whose DEPENDS_ON prerequisites in the same
-- run have not passed is blocked, and the server refuses a result for it.
ALTER TABLE "Projects" ADD COLUMN "enforceCaseDependencies" BOOLEAN NOT NULL DEFAULT false;

-- Notification raised for a run case's assignee when the last of its
-- prerequisites in the run passes and the case becomes executable.
ALTER TYPE "NotificationType" ADD VALUE 'RUN_CASE_UNBLOCKED';
