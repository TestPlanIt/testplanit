---
"@testplanit/api": minor
"@testplanit/playwright-reporter": minor
"@testplanit/wdio-reporter": minor
---

Report the worker/thread each test ran on. The Playwright reporter sends the attempt's `parallelIndex` (the stable 0-based worker lane) and the WebdriverIO reporter sends the runner `cid` (e.g. `0-1`) with every result, so TestPlanIt can show exact parallelization and a per-worker execution timeline instead of inferring lanes from timestamps. Servers that don't know the field yet are handled gracefully: the API client retries the result without it and stops sending it for the rest of the run, so no results are lost either way.
