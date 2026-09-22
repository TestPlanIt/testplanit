-- Execution targets declare the parameters a dispatcher fills in at execute
-- time (select / multiselect / text); the chosen values travel as
-- per-execution inputs, which TestRunExecution.inputs already stores.
ALTER TABLE "ExecutionTarget" ADD COLUMN "paramSchema" JSONB NOT NULL DEFAULT '[]';
