---
"@testplanit/wdio-reporter": patch
---

Report failing attempts of Mocha/Jasmine per-test retries

WebdriverIO routes a failing attempt that will be retried to `test:retry`
instead of `test:fail`, so the reporter never saw it and a fail-then-pass
test appeared in TestPlanIt as a single clean pass. The reporter now
implements `onTestRetry` and reports the attempt as failed, making
within-run flaky sequences (fail, retry, pass) visible. Cucumber is
unaffected: scenario results still aggregate per-step events at suite end.
