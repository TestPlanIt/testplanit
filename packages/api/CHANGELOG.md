# @testplanit/api

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
