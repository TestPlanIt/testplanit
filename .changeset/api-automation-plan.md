---
"@testplanit/api": minor
---

Add `getAutomationPlan`, `finishExecution` and the `plan-run` pipeline helper

When TestPlanIt dispatches a run's automated cases to CI, the job reads the
plan of cases to execute. `client.getAutomationPlan(runId, executionId?)`
returns it (case ids, titles, class names, `selector.fullName` and the
`[123]` / `C123` / `TC123` id tokens the reporters match on);
`client.finishExecution(runId, executionId, conclusion)` reports the outcome
for targets TestPlanIt cannot poll. The `testplanit plan-run` bin command
prints the plan, defaulting to `TESTPLANIT_RUN_ID` / `TESTPLANIT_EXECUTION_ID`.

`TestRunType` gains `HYBRID`: a manual run that has also received automated
results. Reporters pinned to such a run keep working unchanged.
