---
"@testplanit/cli": minor
---

Add `testplanit run plan`, `run complete` and `run finish` for jobs TestPlanIt dispatches

TestPlanIt can now start a CI job for a run's automated cases. The job it
starts carries `TESTPLANIT_RUN_ID` and `TESTPLANIT_EXECUTION_ID`, and this
release gives it the three things it needs from the CLI:

- `run plan` prints the run's automated cases — as JSON, or one selector per
  line (`--format lines`, `--selector-field fullName|title|className|id`) for a
  shell shim to turn into whatever filter its runner takes.
- `run complete` marks the run done once every job has reported.
- `run finish --conclusion success|failure|cancelled` reports the execution's
  outcome, which generic-webhook targets need because TestPlanIt cannot poll
  them.

`import -r` now defaults to `TESTPLANIT_RUN_ID`, so a dispatched job can
import its results without repeating the run id.
