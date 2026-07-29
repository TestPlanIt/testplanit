---
"@testplanit/api": patch
---

Remove the `testplanit` bin, which collided with `@testplanit/cli`

0.9.0 added a `testplanit` command to this package, but `@testplanit/cli`
already publishes a binary of that name. Installing both as direct dependencies
left the resolved command up to bin linking.

The run-lifecycle commands now live in `@testplanit/cli` as `testplanit run
create` and `testplanit run complete`, alongside `import` and `config`, where
they also pick up stored credentials. This package goes back to being a library
only; `TestPlanItClient.createTestRun` and `completeTestRun` are unchanged.
