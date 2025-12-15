# @testplanit/api

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
