---
"@testplanit/wdio-reporter": patch
---

Export the service-created run ID so forked workers report into it

`TestPlanItService.onPrepare` now sets `TESTPLANIT_RUN_ID` to the run it just
created. Workers are forked from the launcher, so they inherit the variable and
their reporters take the same externally managed path a pipeline-pinned run
uses: they attach results only, and never create a run, discover one through the
`oneReport` shared-state file, or complete one. Previously workers could only
find the service's run by reading that shared-state file, which requires
`oneReport` and a temp directory every worker can reach — neither holds for
workers on separate agents or in separate containers, and those workers created
a run of their own.

The service still owns the lifecycle and completes the run in `onComplete`, so
no external sweep is needed. Exporting the ID does not make the service treat
its own run as externally managed.

A run pinned by the pipeline is untouched: the variable is already set, nothing
is created, and the original value is left alone. The export is reverted in
`onComplete` — and if `onPrepare` fails — so a completed run's ID cannot leak
into a later launcher in the same process.
