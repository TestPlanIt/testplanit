---
"@testplanit/wdio-reporter": minor
"@testplanit/playwright-reporter": minor
---

Add an `excludeSkipped` option to both reporters. When enabled, skipped results are not reported to TestPlanIt at all — they don't appear on the run and don't count toward its totals. The check runs before any API work, so a spec whose tests were all skipped never creates a test run. For the WebdriverIO reporter this also covers `pending` results and Cucumber scenarios whose steps were skipped. Default is disabled: skipped results keep being reported exactly as before.
