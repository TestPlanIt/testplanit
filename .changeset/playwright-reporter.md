---
'@testplanit/playwright-reporter': minor
---

Add `@testplanit/playwright-reporter`, a Playwright reporter that mirrors the behaviour of `@testplanit/wdio-reporter`.

It links results to test cases by parsing case IDs from test titles (configurable `caseIdPattern`), optionally auto-creates cases and a folder hierarchy from the `test.describe` structure, creates a JUnit-style test run/suite/result for every attempt, and uploads Playwright attachments (screenshots, videos, traces — filterable via `attachmentTypes`) to each result. Because Playwright runs reporters in a single process, no launcher service or worker coordination is required.
