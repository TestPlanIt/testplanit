# @testplanit/playwright-reporter

## 0.2.2

### Patch Changes

- Updated dependencies [[`53f406b`](https://github.com/TestPlanIt/testplanit/commit/53f406b78f60766e07b6f2c4783b33aa020d32b2)]:
  - @testplanit/api@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`79c4db0`](https://github.com/TestPlanIt/testplanit/commit/79c4db008dc0d021844a1aaf60c6e790f750582f)]:
  - @testplanit/api@0.5.0

## 0.2.0

### Minor Changes

- [#444](https://github.com/TestPlanIt/testplanit/pull/444) [`ea8f7cd`](https://github.com/TestPlanIt/testplanit/commit/ea8f7cd199dc239bb105cb876bc4120dff43827e) Thanks [@therealbrad](https://github.com/therealbrad)! - Capture Playwright `test.step()` calls as authored steps on test cases.
  - **`captureSteps`** (default `true`): when the reporter creates a new test case (via `autoCreateTestCases`), it seeds the case's steps from the test's `test.step()` calls. Nested steps are flattened in execution order and prefixed by depth; auto-instrumented actions (`expect`, `pw:api`, hooks, fixtures) are ignored.
  - **`overwriteSteps`** (default `false`): keep an existing case's steps in sync with the script — on every run, the steps of cases linked by ID or matched by auto-create are replaced with the current `test.step()` calls. This is destructive (existing steps are soft-deleted), so a test with no `test.step()` calls never clears an existing case's steps.

  The `@testplanit/api` client gains `createStep()`, `createSteps()` (batched), and `softDeleteCaseSteps()` to support this. Steps are written in a single batched `createMany` per case (instead of one request per step), and the client now honors `429 Retry-After` backoff — keeping API call volume and rate-limit pressure low when reporting large suites.

### Patch Changes

- Updated dependencies [[`ea8f7cd`](https://github.com/TestPlanIt/testplanit/commit/ea8f7cd199dc239bb105cb876bc4120dff43827e)]:
  - @testplanit/api@0.4.0

## 0.1.0

### Minor Changes

- [#408](https://github.com/TestPlanIt/testplanit/pull/408) [`a5af9c3`](https://github.com/TestPlanIt/testplanit/commit/a5af9c3be63dd5e3e2fec6d51f04860cc697a7c0) Thanks [@therealbrad](https://github.com/therealbrad)! - Add `@testplanit/playwright-reporter`, a Playwright reporter that mirrors the behaviour of `@testplanit/wdio-reporter`.

  It links results to test cases three ways — a Playwright annotation (`caseIdAnnotation`, default `testplanit`, the no-rename approach), tags, or case IDs in the test title (`caseIdPattern`) — and de-duplicates across them. It optionally auto-creates cases and a folder hierarchy from the `test.describe` structure, creates a JUnit-style test run/suite/result for every attempt, and uploads Playwright attachments (screenshots, videos, traces — filterable via `attachmentTypes`) to each result. Because Playwright runs reporters in a single process, no launcher service or worker coordination is required.
