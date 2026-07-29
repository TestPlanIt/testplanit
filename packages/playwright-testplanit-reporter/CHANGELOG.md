# @testplanit/playwright-reporter

## 0.4.1

### Patch Changes

- Updated dependencies [[`9f838ab`](https://github.com/TestPlanIt/testplanit/commit/9f838ab3ff546166b25d96db6d944da2c9d3465d)]:
  - @testplanit/api@0.9.0

## 0.4.0

### Minor Changes

- [#550](https://github.com/TestPlanIt/testplanit/pull/550) [`5145332`](https://github.com/TestPlanIt/testplanit/commit/51453327f9750da7bee8eea4c7a663936f2e8474) Thanks [@therealbrad](https://github.com/therealbrad)! - Add an `excludeSkipped` option to both reporters. When enabled, skipped results are not reported to TestPlanIt at all — they don't appear on the run and don't count toward its totals. The check runs before any API work, so a spec whose tests were all skipped never creates a test run. For the WebdriverIO reporter this also covers `pending` results and Cucumber scenarios whose steps were skipped. Default is disabled: skipped results keep being reported exactly as before.

## 0.3.0

### Minor Changes

- [#548](https://github.com/TestPlanIt/testplanit/pull/548) [`65a5452`](https://github.com/TestPlanIt/testplanit/commit/65a545262b02a39bf31b73cfcd9439b4d5c258f7) Thanks [@therealbrad](https://github.com/therealbrad)! - Add first-class run-level attachments — links, files, and key/value metadata on the test run itself (not on individual results) — so consumers no longer need to import `@testplanit/api` or call private client internals.

  - **`@testplanit/wdio-reporter`**: new declarative `TestPlanItService` options applied exactly once (in the launcher) right after the run is created: `runLinks` (clickable link attachments, e.g. a CI build URL), `runAttachments` (file attachments; a `path` that doesn't exist yet is retried once after all workers finish), and `runMetadata` (rendered as `**key:** value` lines in the run's documentation). All string values support `{env:VAR}` placeholders; entries referencing unset environment variables are skipped instead of producing broken values. New runtime API installed on the WebdriverIO browser in every worker — `browser.testplanit.attachToRun({ url | path | buffer, ... })`, `browser.testplanit.setRunMetadata({...})`, and `browser.testplanit.getRunId()` — always resolving to the single service-managed run regardless of which worker calls it. All run-level operations log and swallow failures; they can never fail the test run.
  - **`@testplanit/playwright-reporter`**: the same declarative `runLinks` / `runAttachments` / `runMetadata` options on the reporter, applied once right after the reporter creates the run (skipped when appending to an existing run via `testRunId`, so re-runs don't attach duplicates); unreadable `runAttachments` paths are retried once in `onEnd`. New runtime helpers `attachToRun(testInfo, { url | path | buffer, ... })` and `setRunMetadata(testInfo, {...})` — they ride Playwright's own attachment transport under reserved `testplanit:run-*` names, which the reporter intercepts in the main process and routes to run-level API calls (never uploaded to the result; identical operations are deduped so retried tests don't create duplicates).
  - **`@testplanit/api`**: new public `TestPlanItClient` methods `addTestRunLink(testRunId, url, name?, note?)` (creates a `text/uri-list` link attachment on the run), `uploadTestRunAttachment(testRunId, file, fileName, mimeType?)` (uploads and attaches a file to the run), and `setTestRunMetadata` / `getTestRunMetadata` (merge/read key-value metadata in the run's `docs` field, preserving hand-written content). Also exports the pure `mergeRunMetadataIntoDoc` / `parseRunMetadataFromDoc` helpers and `RunMetadata` types, and `createTestRun` now honors its previously declared-but-ignored `note`/`docs` options.

### Patch Changes

- Updated dependencies [[`65a5452`](https://github.com/TestPlanIt/testplanit/commit/65a545262b02a39bf31b73cfcd9439b4d5c258f7)]:
  - @testplanit/api@0.8.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`9c2fc5c`](https://github.com/TestPlanIt/testplanit/commit/9c2fc5c5df41393cb29996d4233b5a86d14f3128)]:
  - @testplanit/api@0.7.0

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
