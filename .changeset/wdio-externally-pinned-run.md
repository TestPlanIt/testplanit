---
"@testplanit/wdio-reporter": minor
---

Attach every invocation to one externally managed test run

A suite executed as several separate wdio invocations — shards across CI agents,
or sequential retry waves — created a run per invocation, since `oneReport`
coordinates through a file in the OS temp directory that cannot reach another
agent and resets once a run's workers have finished.

Set `TESTPLANIT_RUN_ID` (or pass `testRunId`) and the reporter attaches to that
run instead. Such a run is externally managed: the reporter never creates it,
never completes it regardless of `completeRunOnFinish`, never discards it
through the "start fresh" recovery paths, and leaves its configuration,
milestone, state and tags alone. The pipeline owns the lifecycle via the new
`testplanit create-run` / `testplanit complete-run` commands.

`TestPlanItService` honours the same variable and its own `testRunId` option, so
the recommended service + reporter setup needs no config change: the service
reports into the pinned run rather than creating one in `onPrepare`, and leaves
it open in `onComplete`. It applies `runLinks` and `runMetadata` only to runs it
created, since those describe the run as a whole; `runAttachments` still upload
from every execution.

Each execution records its own JUnit suite under the shared run, named
`{suite} - {browser}/{platform} - {spec}` by default; results roll up at the run
level. The new `testSuiteName` option overrides that on both the reporter and
the service, using the same placeholders as `runName` (plus `{env:VAR}` on the
service, whose launcher process has no browser or spec to name shards by).

Also fixes suite state being adopted across runs: the shared-state file is keyed
by project, so a suite recorded by an earlier invocation could capture results
belonging to a different run. Suite state is now only reused when it belongs to
the run being reported into.

With no run supplied, behaviour is unchanged.
