# @testplanit/api

Official JavaScript/TypeScript API client for [TestPlanIt](https://github.com/testplanit/testplanit) - the open-source test management platform.

## Installation

```bash
npm install @testplanit/api
# or
pnpm add @testplanit/api
# or
yarn add @testplanit/api
```

## Quick Start

```typescript
import { TestPlanItClient } from '@testplanit/api';

const client = new TestPlanItClient({
  baseUrl: 'https://testplanit.example.com',
  apiToken: 'tpi_your_token_here',
});

// Create a test run
const testRun = await client.createTestRun({
  projectId: 1,
  name: 'Automated Test Run',
});

// Get status ID for "passed"
const passedStatusId = await client.getStatusId(1, 'passed');

// Add a test result
await client.createTestResult({
  testRunId: testRun.id,
  testRunCaseId: 123,
  statusId: passedStatusId!,
  elapsed: 1500, // milliseconds
});

// Complete the test run
await client.completeTestRun(testRun.id);
```

## Configuration

```typescript
const client = new TestPlanItClient({
  // Required
  baseUrl: 'https://testplanit.example.com',
  apiToken: 'tpi_your_token_here',

  // Optional
  timeout: 30000,      // Request timeout in ms (default: 30000)
  maxRetries: 3,       // Number of retries for failed requests (default: 3)
  retryDelay: 1000,    // Delay between retries in ms (default: 1000)
  headers: {},         // Custom headers to include in all requests
});
```

## API Token

Generate an API token from your TestPlanIt instance:

1. Go to **Settings** > **API Tokens**
2. Click **Generate New Token**
3. Copy the token (it starts with `tpi_`)

Store the token securely (e.g., environment variable):

```typescript
const client = new TestPlanItClient({
  baseUrl: process.env.TESTPLANIT_URL!,
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
});
```

## API Reference

### Projects

```typescript
// Get a project by ID
const project = await client.getProject(1);

// List all accessible projects
const projects = await client.listProjects();
```

### Test Runs

```typescript
// Create a new test run
const testRun = await client.createTestRun({
  projectId: 1,
  name: 'My Test Run',
  testRunType: 'REGULAR', // or 'JUNIT', 'TESTNG', etc.
  configId: 1,            // optional
  milestoneId: 1,         // optional
  stateId: 1,             // optional
});

// Get a test run
const testRun = await client.getTestRun(123);

// Update a test run
await client.updateTestRun(123, {
  name: 'Updated Name',
  isCompleted: true,
});

// Complete a test run
await client.completeTestRun(123);

// List test runs
const { data, totalCount, pageCount } = await client.listTestRuns({
  projectId: 1,
  page: 1,
  pageSize: 25,
  search: 'smoke',
  runType: 'automated', // 'manual', 'automated', or 'both'
});
```

### Test Cases

```typescript
// Create a test case
const testCase = await client.createTestCase({
  projectId: 1,
  repositoryId: 1,
  folderId: 1,
  templateId: 1,
  name: 'Login should work',
  className: 'AuthTests',
  source: 'API',
  automated: true,
});

// Find test cases
const cases = await client.findTestCases({
  projectId: 1,
  name: 'Login',
  className: 'AuthTests',
});

// Find or create a test case
const testCase = await client.findOrCreateTestCase({
  projectId: 1,
  repositoryId: 1,
  folderId: 1,
  templateId: 1,
  name: 'Login should work',
  className: 'AuthTests',
});
```

### Test Results

```typescript
// Add a test case to a run
const testRunCase = await client.addTestCaseToRun({
  testRunId: 123,
  repositoryCaseId: 456,
});

// Create a test result
const result = await client.createTestResult({
  testRunId: 123,
  testRunCaseId: testRunCase.id,
  statusId: 1, // Use getStatusId() to get the correct ID
  elapsed: 1500,
  notes: { comment: 'Test passed' },
  evidence: { logs: ['Step 1 completed'] },
  attempt: 1,
});

// Get test results for a run
const results = await client.getTestResults(123);
```

### Status Mappings

```typescript
// Get all statuses for a project
const statuses = await client.getStatuses(1);

// Get status ID by normalized name
const passedId = await client.getStatusId(1, 'passed');
const failedId = await client.getStatusId(1, 'failed');
const skippedId = await client.getStatusId(1, 'skipped');
const blockedId = await client.getStatusId(1, 'blocked');

// Clear status cache (if statuses are updated)
client.clearStatusCache();
```

### Attachments

```typescript
// Upload an attachment to a test result
const attachment = await client.uploadAttachment(
  testResultId,
  fileBuffer,      // Buffer or Blob
  'screenshot.png',
  'image/png'
);
```

### Bulk Import

Import test results from JUnit, TestNG, xUnit, NUnit, MSTest, Mocha, or Cucumber format:

```typescript
const { testRunId } = await client.importTestResults(
  {
    projectId: 1,
    files: [junitXmlFile],
    format: 'junit', // or 'auto' for auto-detection
    name: 'CI Build #123',
  },
  (event) => {
    // Progress callback
    console.log(`${event.progress}%: ${event.status}`);
  }
);
```

## Error Handling

```typescript
import { TestPlanItClient, TestPlanItError } from '@testplanit/api';

try {
  await client.createTestRun({ projectId: 999, name: 'Test' });
} catch (error) {
  if (error instanceof TestPlanItError) {
    console.error('API Error:', error.message);
    console.error('Status Code:', error.statusCode);
    console.error('Details:', error.details);
  }
}
```

## TypeScript Support

This package includes full TypeScript definitions. All types are exported:

```typescript
import type {
  TestPlanItClientConfig,
  TestRun,
  TestRunType,
  RepositoryCase,
  RepositoryCaseSource,
  TestRunCase,
  TestRunResult,
  Status,
  NormalizedStatus,
  CreateTestRunOptions,
  CreateTestResultOptions,
  // ... and more
} from '@testplanit/api';
```

## Related Packages

- [@testplanit/wdio-reporter](../wdio-testplanit-reporter) - WebdriverIO reporter using this client

## License

MIT
