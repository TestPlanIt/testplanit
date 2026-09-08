---
"@testplanit/api": minor
---

Add a `testplanit` CLI for pipeline-owned test runs

`testplanit create-run` creates a run and prints its ID to stdout (diagnostics
go to stderr, so the ID is safe to capture in a shell variable). Export it as
`TESTPLANIT_RUN_ID` and every reporter invocation attaches to that run instead
of creating its own. `testplanit complete-run --id <id>` closes it once all
invocations have finished, reading the project from the run when `--project` is
omitted.

Both commands read `TESTPLANIT_URL` (or `TESTPLANIT_API_URL`) and
`TESTPLANIT_API_TOKEN`.
