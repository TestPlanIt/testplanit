# @testplanit/api

## 0.4.0

### Minor Changes

- [#444](https://github.com/TestPlanIt/testplanit/pull/444) [`ea8f7cd`](https://github.com/TestPlanIt/testplanit/commit/ea8f7cd199dc239bb105cb876bc4120dff43827e) Thanks [@therealbrad](https://github.com/therealbrad)! - Capture Playwright `test.step()` calls as authored steps on test cases.
  - **`captureSteps`** (default `true`): when the reporter creates a new test case (via `autoCreateTestCases`), it seeds the case's steps from the test's `test.step()` calls. Nested steps are flattened in execution order and prefixed by depth; auto-instrumented actions (`expect`, `pw:api`, hooks, fixtures) are ignored.
  - **`overwriteSteps`** (default `false`): keep an existing case's steps in sync with the script — on every run, the steps of cases linked by ID or matched by auto-create are replaced with the current `test.step()` calls. This is destructive (existing steps are soft-deleted), so a test with no `test.step()` calls never clears an existing case's steps.

  The `@testplanit/api` client gains `createStep()`, `createSteps()` (batched), and `softDeleteCaseSteps()` to support this. Steps are written in a single batched `createMany` per case (instead of one request per step), and the client now honors `429 Retry-After` backoff — keeping API call volume and rate-limit pressure low when reporting large suites.

## 0.3.1

### Patch Changes

- [#389](https://github.com/TestPlanIt/testplanit/pull/389) [`28121cd`](https://github.com/TestPlanIt/testplanit/commit/28121cd565165135f38c032c073fe5964efbdab7) Thanks [@therealbrad](https://github.com/therealbrad)! - Lower minimum Node.js requirement to 20

  Relaxes `engines.node` from `>=24` to `>=20` so the packages can be installed on projects that have not yet upgraded to Node 24. The client code only relies on APIs available since Node 18 (`fetch`, `FormData`, `Blob`, `AbortSignal.timeout`, and Web Streams); the previous `>=24` pin came from a workspace-wide standardization rather than an actual code requirement.

## 0.3.0

### Minor Changes

- [#262](https://github.com/TestPlanIt/testplanit/pull/262) [`478e170`](https://github.com/TestPlanIt/testplanit/commit/478e170e5d395c18ce4a9593f765f4a2db26cc33) Thanks [@therealbrad](https://github.com/therealbrad)! - Require Node.js 24 LTS or later
  - Bumps `engines.node` to `>=24` (was `>=18`) to align with the rest of the workspace, which is now standardized on Node 24 LTS
  - `@testplanit/wdio-reporter` also refreshes `@types/node` from `^20` to `^25` to match

## 0.2.0

### Minor Changes

- [#25](https://github.com/TestPlanIt/testplanit/pull/25) [`0baed0a`](https://github.com/TestPlanIt/testplanit/commit/0baed0a9145d95994a1a12b068a38016340c1b7d) Thanks [@therealbrad](https://github.com/therealbrad)! - Initial release of TestPlanIt npm packages
  - `@testplanit/api`: Official JavaScript/TypeScript API client for TestPlanIt
  - `@testplanit/wdio-reporter`: WebdriverIO reporter for TestPlanIt test management

## 0.1.0

### Minor Changes

- Initial release of the TestPlanIt API client
- Added `TestPlanItClient` class with methods for:
  - Projects: `getProject`, `listProjects`
  - Test Runs: `createTestRun`, `getTestRun`, `updateTestRun`, `completeTestRun`, `listTestRuns`
  - Test Cases: `createTestCase`, `getTestCase`, `findTestCases`, `findOrCreateTestCase`
  - Test Run Cases: `addTestCaseToRun`, `getTestRunCases`, `findOrAddTestCaseToRun`
  - Test Results: `createTestResult`, `getTestResults`
  - Attachments: `uploadAttachment`
  - Status mappings: `getStatuses`, `getStatusId`
  - Bulk import: `importTestResults`
- Full TypeScript support with exported types
- Automatic retry logic for failed requests
- Status caching for improved performance
