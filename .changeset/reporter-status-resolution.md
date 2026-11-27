---
"@testplanit/api": patch
"@testplanit/playwright-reporter": patch
"@testplanit/wdio-reporter": patch
---

Respect Playwright's expected status, and stop depending on status names

- **playwright-reporter**: a `test.fail()` test that passes is now recorded as
  failed, with the message `Expected to fail, but passed.`. Playwright fails
  the run for it, but the reporter recorded it as passed.
- **playwright-reporter**: the new `expectedFailureStatus` option sets the
  status recorded for a `test.fail()` test that fails as expected, which
  Playwright counts as passing. It takes the ID or name of any status in the
  project, and the result counts as passed, failed or neither according to
  that status's own settings. Without the option these results are recorded as
  failed, as before.
- **playwright-reporter**, **wdio-reporter**: a project with no status for
  passed or failed results no longer stops the run from being reported, and a
  skipped test is no longer recorded as failed when the project has no status
  for skipped results. A result with no matching status is recorded without
  one, with a warning, and TestPlanIt counts it from the result itself.
- **api**: `getStatusId` falls back to a status's Success, Failure and
  Completed settings when no status matches `passed`, `failed` or `skipped` by
  name or alias, so projects with their own statuses resolve. A status whose
  system name, name or alias is the word now wins over one whose alias only
  contains it, and `getStatuses` returns statuses in the order set by the
  administrator.
