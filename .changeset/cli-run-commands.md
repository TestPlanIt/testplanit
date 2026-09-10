---
"@testplanit/cli": minor
---

Add `testplanit run create`, `run plan`, `run complete` and `run finish` for CI jobs

TestPlanIt can now start a CI job for a run's automated cases. The job it
starts carries `TESTPLANIT_RUN_ID` and `TESTPLANIT_EXECUTION_ID`, and this
release gives it the three things it needs from the CLI:

- `run create` creates a run up front and prints only its id, so a pipeline
  can export it as `TESTPLANIT_RUN_ID` and let every shard, machine and retry
  attach to the same run (what `@testplanit/api`'s `create-run` did).
- `run plan` prints the run's automated cases — as JSON, or one selector per
  line (`--format lines`, `--selector-field fullName|title|className|id`) for a
  shell shim to turn into whatever filter its runner takes.
- `run complete` marks the run done once every job has reported.
- `run finish --conclusion success|failure|cancelled` reports the execution's
  outcome, which generic-webhook targets need because TestPlanIt cannot poll
  them.

`import -r` now defaults to `TESTPLANIT_RUN_ID`, so a dispatched job can
import its results without repeating the run id.
