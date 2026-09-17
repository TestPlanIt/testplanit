-- A role permission that gates starting, retrying, and cancelling automated
-- executions, separately from recording results.
ALTER TYPE "ApplicationArea" ADD VALUE 'AutomatedExecution' AFTER 'TestRunResultRestrictedFields';
