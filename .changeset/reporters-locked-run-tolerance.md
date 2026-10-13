---
"@testplanit/playwright-reporter": patch
"@testplanit/wdio-reporter": patch
---

Keep reporting into a pinned run whose composition is locked

A run pinned with `TESTPLANIT_RUN_ID` may have its case list frozen (the
team locked the composition before dispatching to CI). Adding a case to such
a run is refused by TestPlanIt, and the reporters used to drop that test's
result with it. They now log the refusal and still record the result, which
TestPlanIt shows against the run as a case that is not part of it.
