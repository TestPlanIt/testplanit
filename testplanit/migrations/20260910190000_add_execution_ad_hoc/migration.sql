-- Ad-hoc executions ("Run automated test" on one case) create a run that
-- holds only that case; the run completes itself when the execution finishes.
ALTER TABLE "TestRunExecution" ADD COLUMN "adHoc" BOOLEAN NOT NULL DEFAULT false;

-- Two hours is a better default wait for a job than four; a target can still raise it.
ALTER TABLE "ExecutionTarget" ALTER COLUMN "timeoutMinutes" SET DEFAULT 120;
