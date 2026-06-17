---
"@testplanit/playwright-reporter": minor
"@testplanit/api": minor
---

Capture Playwright `test.step()` calls as authored steps on test cases.

- **`captureSteps`** (default `true`): when the reporter creates a new test case (via `autoCreateTestCases`), it seeds the case's steps from the test's `test.step()` calls. Nested steps are flattened in execution order and prefixed by depth; auto-instrumented actions (`expect`, `pw:api`, hooks, fixtures) are ignored.
- **`overwriteSteps`** (default `false`): keep an existing case's steps in sync with the script — on every run, the steps of cases linked by ID or matched by auto-create are replaced with the current `test.step()` calls. This is destructive (existing steps are soft-deleted), so a test with no `test.step()` calls never clears an existing case's steps.

The `@testplanit/api` client gains `createStep()` and `softDeleteCaseSteps()` to support this.
