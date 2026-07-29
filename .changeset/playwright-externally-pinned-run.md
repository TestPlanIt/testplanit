---
"@testplanit/playwright-reporter": minor
---

Attach every execution to one externally managed test run

Each Playwright execution runs its own reporter process, so `--shard=1/5` across
five machines — or a rerun of the failures afterwards — created five or six
separate runs, all named the same thing.

Set `TESTPLANIT_RUN_ID` (or pass `testRunId`) and the reporter attaches to that
run instead. Such a run is externally managed: the reporter never creates it,
never completes it regardless of `completeRunOnFinish`, leaves its
configuration, milestone, state and tags alone, and does not apply `runLinks` or
`runMetadata` — those describe the run as a whole and every shard would
duplicate them. The pipeline owns the lifecycle via `testplanit create-run` and
`testplanit complete-run`.

Each execution records its own JUnit suite under the shared run, named
`{suite} - {browser}/{platform} - {spec}` by default; results roll up at the run
level. The new `testSuiteName` option overrides that, and the new `{shard}`
placeholder resolves to Playwright's own `--shard` value (`2/5`, or `1/1` when
unsharded) — the precise label for a sharded pipeline.

An existing run that cannot be read no longer fails initialization; the failure
is logged and results are still attached to the given ID, rather than a
replacement run being created.

With no run supplied, behaviour is unchanged.
