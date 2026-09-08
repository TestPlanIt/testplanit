-- Notification raised when every case in a test run has been executed and the
-- run is ready to be marked completed.
ALTER TYPE "NotificationType" ADD VALUE 'RUN_READY_TO_COMPLETE';

-- One-shot marker so the notification fires once per "became ready"
-- transition. Cleared when the run stops being fully executed, which re-arms
-- it for the next time.
ALTER TABLE "TestRuns" ADD COLUMN "readyToCompleteNotifiedAt" TIMESTAMPTZ(6);
