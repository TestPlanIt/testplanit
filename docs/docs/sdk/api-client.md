---
sidebar_position: 2
title: API Client (@testplanit/api)
---

# API Client

`@testplanit/api` is the official JavaScript/TypeScript API client for TestPlanIt. It provides a type-safe interface for interacting with the TestPlanIt API.

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

// Create a test run (find your project ID on the [Project Overview](../user-guide/project-overview.md) page)
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
  statusId: passedStatusId,
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

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `baseUrl` | string | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | string | Yes | - | API token for authentication (starts with `tpi_`) |
| `timeout` | number | No | 30000 | Request timeout in milliseconds |
| `maxRetries` | number | No | 3 | Number of retries for failed requests |
| `retryDelay` | number | No | 1000 | Delay between retries in milliseconds |
| `headers` | object | No | {} | Custom headers to include in all requests |

## Authentication

Generate an API token from your TestPlanIt instance:

1. Go to **Settings** > **API Tokens**
2. Click **Generate New Token**
3. Copy the token (it starts with `tpi_`)

Store the token securely using environment variables:

```typescript
const client = new TestPlanItClient({
  baseUrl: process.env.TESTPLANIT_URL,
  apiToken: process.env.TESTPLANIT_API_TOKEN,
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
  testRunType: 'REGULAR',  // Optional: 'REGULAR', 'JUNIT', 'TESTNG', etc.
  configId: 1,             // Optional: Configuration ID
  milestoneId: 1,          // Optional: Milestone ID
  stateId: 1,              // Optional: Workflow state ID
});

// Get a test run by ID
const testRun = await client.getTestRun(123);

// Update a test run
await client.updateTestRun(123, {
  name: 'Updated Name',
  isCompleted: true,
});

// Complete a test run (mark as finished)
await client.completeTestRun(123);

// List test runs with pagination
const { data, totalCount, pageCount } = await client.listTestRuns({
  projectId: 1,
  page: 1,
  pageSize: 25,
  search: 'smoke',           // Optional: search term
  runType: 'automated',      // Optional: 'manual', 'automated', or 'both'
});
```

### Test Cases

```typescript
// Create a test case
const testCase = await client.createTestCase({
  projectId: 1,
  folderId: 1,
  templateId: 1,
  name: 'Login should work',
  className: 'AuthTests',     // Optional: suite/class name
  source: 'API',              // Optional: 'MANUAL', 'JUNIT', 'API', etc.
  automated: true,            // Optional: whether case is automated
});

// Get a test case by ID
const testCase = await client.getTestCase(456);

// Find test cases by criteria
const cases = await client.findTestCases({
  projectId: 1,
  name: 'Login',              // Optional: filter by name
  className: 'AuthTests',     // Optional: filter by class name
  source: 'API',              // Optional: filter by source
});

// Find or create a test case (useful for auto-creating cases)
const testCase = await client.findOrCreateTestCase({
  projectId: 1,
  folderId: 1,
  templateId: 1,
  name: 'Login should work',
  className: 'AuthTests',
});
```

### Test Run Cases

Link test cases to test runs:

```typescript
// Add a test case to a run
const testRunCase = await client.addTestCaseToRun({
  testRunId: 123,
  repositoryCaseId: 456,
  assignedToId: 'user-id',    // Optional: assign to user
});

// Get all test cases in a run
const cases = await client.getTestRunCases(123);

// Find a specific test run case
const testRunCase = await client.findTestRunCase(123, 456);

// Find or add a test case to a run (avoids duplicates)
const testRunCase = await client.findOrAddTestCaseToRun({
  testRunId: 123,
  repositoryCaseId: 456,
});
```

### Test Results

```typescript
// Create a test result
const result = await client.createTestResult({
  testRunId: 123,
  testRunCaseId: 456,
  statusId: 1,                // Use getStatusId() to get the correct ID
  elapsed: 1500,              // Optional: duration in milliseconds
  notes: {                    // Optional: additional notes
    comment: 'Test passed successfully'
  },
  evidence: {                 // Optional: test evidence/logs
    logs: ['Step 1 completed', 'Step 2 completed']
  },
  attempt: 1,                 // Optional: retry attempt number
});

// Get all results for a test run
const results = await client.getTestResults(123);
```

### Status Mappings

TestPlanIt has configurable statuses per project. Use these methods to work with statuses:

```typescript
// Get all statuses for a project
const statuses = await client.getStatuses(projectId);

// Get status ID by normalized name
// Supports: 'passed', 'failed', 'skipped', 'blocked', 'pending'
const passedId = await client.getStatusId(projectId, 'passed');
const failedId = await client.getStatusId(projectId, 'failed');
const skippedId = await client.getStatusId(projectId, 'skipped');

// Clear status cache (if statuses are updated)
client.clearStatusCache();
```

The `getStatusId` method automatically matches:
- System names (e.g., `passed`, `failed`)
- Display names (e.g., `Passed`, `Failed`)
- Aliases configured in TestPlanIt

### Attachments

```typescript
// Upload an attachment to a test result
const attachment = await client.uploadAttachment(
  testRunResultId,     // Test result ID
  fileBuffer,          // Buffer or Blob
  'screenshot.png',    // File name
  'image/png'          // MIME type (optional)
);
```

### Bulk Import

Import test results from JUnit, TestNG, xUnit, NUnit, MSTest, Mocha, or Cucumber format:

```typescript
const { testRunId } = await client.importTestResults(
  {
    projectId: 1,
    files: [junitXmlFile],           // File[] or Blob[]
    format: 'auto',                  // 'auto', 'junit', 'testng', etc.
    name: 'CI Build #123',           // Optional: run name
    testRunId: 456,                  // Optional: existing run to append to
    configId: 1,                     // Optional
    milestoneId: 2,                  // Optional
    stateId: 3,                      // Optional
    parentFolderId: 10,              // Optional
    templateId: 1,                   // Optional
    tagIds: [1, 2],                  // Optional
  },
  (event) => {
    // Progress callback
    console.log(`${event.progress}%: ${event.status}`);
    if (event.complete) {
      console.log('Import complete! Test run ID:', event.testRunId);
    }
  }
);
```

### Connection Testing

```typescript
// Test the API connection
const isConnected = await client.testConnection();
if (!isConnected) {
  console.error('Failed to connect to TestPlanIt');
}

// Get the configured base URL
const baseUrl = client.getBaseUrl();
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
    console.error('Error Code:', error.code);
    console.error('Details:', error.details);
  }
}
```

### Common Error Codes

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid or missing API token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

## Retry Logic

The client automatically retries failed requests:

- **Retries on**: 5xx server errors, 429 rate limiting, network errors
- **Does not retry on**: 4xx client errors (except 429)
- **Default**: 3 retries with exponential backoff

Configure retry behavior:

```typescript
const client = new TestPlanItClient({
  baseUrl: 'https://testplanit.example.com',
  apiToken: 'tpi_your_token',
  maxRetries: 5,       // More retries
  retryDelay: 2000,    // Longer delay between retries
});
```

## TypeScript Support

The package includes full TypeScript definitions. All types are exported:

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

## Complete Example

Here's a complete example of creating a test run and reporting results:

```typescript
import { TestPlanItClient, TestPlanItError } from '@testplanit/api';

async function reportTestResults() {
  const client = new TestPlanItClient({
    baseUrl: process.env.TESTPLANIT_URL,
    apiToken: process.env.TESTPLANIT_API_TOKEN,
  });

  try {
    // Create a new test run
    const testRun = await client.createTestRun({
      projectId: 1,
      name: `CI Build #${process.env.CI_BUILD_NUMBER}`,
      configId: 2,      // e.g., "Chrome/macOS"
      milestoneId: 5,   // e.g., "Sprint 10"
    });

    console.log(`Created test run: ${testRun.id}`);

    // Get status IDs
    const passedStatus = await client.getStatusId(1, 'passed');
    const failedStatus = await client.getStatusId(1, 'failed');

    // Example test results
    const results = [
      { caseId: 101, status: 'passed', duration: 1200 },
      { caseId: 102, status: 'failed', duration: 3500, error: 'Assertion failed' },
      { caseId: 103, status: 'passed', duration: 800 },
    ];

    // Report each result
    for (const result of results) {
      // Add test case to run
      const testRunCase = await client.findOrAddTestCaseToRun({
        testRunId: testRun.id,
        repositoryCaseId: result.caseId,
      });

      // Create the result
      await client.createTestResult({
        testRunId: testRun.id,
        testRunCaseId: testRunCase.id,
        statusId: result.status === 'passed' ? passedStatus : failedStatus,
        elapsed: result.duration,
        notes: result.error ? { error: result.error } : undefined,
      });
    }

    // Complete the test run
    await client.completeTestRun(testRun.id);

    console.log(`Test run completed: ${client.getBaseUrl()}/test-runs/${testRun.id}`);
  } catch (error) {
    if (error instanceof TestPlanItError) {
      console.error(`TestPlanIt error: ${error.message} (${error.statusCode})`);
    } else {
      throw error;
    }
  }
}

reportTestResults();
```

## Related Resources

- [WebdriverIO Reporter](./webdriverio-reporter.md) - Automatic reporting for WebdriverIO tests
- [API Tokens](../api-tokens.md) - Managing API tokens
- [API Reference](../api-reference.md) - Full REST API documentation
