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
  elapsed: 15, // seconds
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
| -------- | ------ | ---------- | --------- | ------------- |
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

// Resolve a run by name (undefined when nothing matches)
const nightly = await client.findTestRunByName(1, 'Nightly');
```

### Lookups by Name

Resolve the IDs the create calls take without hard-coding them. Each finder
returns `undefined` when nothing matches.

```typescript
const config = await client.findConfigurationByName(1, 'Chrome/macOS');
const milestone = await client.findMilestoneByName(1, 'Sprint 10');
const state = await client.findWorkflowStateByName(1, 'In Progress');

// The lists behind them
const configurations = await client.listConfigurations();
const milestones = await client.listMilestones(1);
const states = await client.listWorkflowStates(1);   // the run workflow's states

// The raw lookup endpoint the finders call. `createIfMissing` applies to tags
// and folders.
const { id } = await client.lookup({ projectId: 1, type: 'tag', name: 'regression', createIfMissing: true });
```

### Automation Plan

When a run is executed from TestPlanIt (an execution target, a repository
webhook, or **Execute** in the app), the CI job asks for the plan: the run's
automated cases with the identifiers a runner filter can match on. Read-only
tokens are accepted.

```typescript
// executionId narrows the plan to an execution's subset and ref
const plan = await client.getAutomationPlan(123, executionId);
for (const c of plan.cases) {
  console.log(c.selector.fullName, c.selector.idTokens.brackets, c.tags);
}

// Report the execution's outcome. Required for generic-webhook targets, which
// TestPlanIt cannot poll; harmless for the others.
await client.finishExecution(123, executionId, 'success'); // 'success' | 'failure' | 'cancelled'
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

// Create many test cases in one request (with steps, tags, and custom fields).
// Far faster than createTestCase per case; returns a per-case result so
// partial failures are visible. Requires a TestPlanIt instance (app v0.39.0+).
const bulk = await client.createTestCases({
  projectId: 1,
  folderId: 1,                // Batch default; each case may override folderId
  templateId: 1,              // Optional: defaults to the project's default template
  cases: [
    {
      name: 'Login with valid credentials',
      steps: [{ text: 'Open /login', expectedResult: 'Form renders' }],
      tags: ['regression', 5], // Tag names (created if missing) or IDs
      customFields: { Priority: 'High' }, // Validated against the template
    },
    { name: 'Login with invalid credentials' },
  ],
});
// bulk.results: [{ id, name, status: 'success', caseId } | { ..., status: 'error', error }]
console.log(`${bulk.importedCount} created, ${bulk.failedCount} failed`);

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

// Find a case by a custom field value, e.g. an external ID. The value is
// matched in both its string and number forms, so it works for Text and
// Integer fields alike. Returns undefined when nothing matches.
const byExternalId = await client.findTestCaseByCustomField({
  projectId: 1,
  fieldName: 'External ID',
  value: 'ADM-649',
});

// Flip a manually authored case to automated once it receives automated results
await client.updateTestCase(456, { automated: true });
```

### Folders

```typescript
// List a project's folders, or find one by name (undefined when missing)
const folders = await client.listFolders(1);
const smoke = await client.findFolderByName(1, 'Smoke');

// Create a folder (parentId optional)
const folder = await client.createFolder({ projectId: 1, name: 'Checkout', parentId: 10 });

// Walk a nested path, creating the folders that are missing; returns the last one.
// Concurrent calls for the same path share one create per folder.
const leaf = await client.findOrCreateFolderPath(1, ['Web', 'Checkout', '@smoke'], 10);
```

### Templates and Tags

```typescript
// Templates the token can see; names match case-insensitively
const templates = await client.listTemplates();
const template = await client.findTemplateByName(1, 'Default');

// Tags are global, not per project
const tags = await client.listTags();
const tag = await client.findTagByName(1, 'regression');       // undefined when missing
const ensured = await client.findOrCreateTag(1, 'regression');  // creates it when missing
const created = await client.createTag({ name: 'nightly' });

// Mixed IDs and names → IDs (names are created when missing)
const tagIds = await client.resolveTagIds(1, ['regression', 5]);
```

### Steps

```typescript
// Authored steps are stored as rich text, the same shape the in-app step
// editor writes. `order` is zero-based.
await client.createSteps({
  testCaseId: 456,
  steps: [
    { step: 'Open /login', expectedResult: 'The form renders', order: 0 },
    { step: 'Submit valid credentials', expectedResult: 'The dashboard loads', order: 1 },
  ],
});
await client.createStep({ testCaseId: 456, step: 'Sign out', order: 2 });

// Replace a case's steps: soft-delete the existing ones first.
// Returns how many steps were removed.
const removed = await client.softDeleteCaseSteps(456);

// Opt in to background AI step derivation for cases that have no steps
// (e.g. Mocha/Jasmine tests, which carry no step structure). Runs only when
// an AI provider is configured for the project; otherwise nothing is enqueued.
const { enqueued } = await client.requestStepDerivation({
  projectId: 1,
  testRunId: 123,            // the "steps ready" notification links here
  cases: [
    { testCaseId: 456, name: 'checkout > pays with a saved card', className: 'Checkout' },
  ],
  overwrite: false,          // true re-derives cases that already have steps (destructive)
});
```

### QuickScript Generation

Generate an AI-authored automation script from one or more stored test cases.
QuickScript must be enabled for the project (**Project Settings → QuickScript**),
and an AI provider must be configured. When a code repository is connected to
the project, generation follows the repo's existing framework, fixtures, and
page objects — this takes precedence over the export template's framework. When
no AI provider is configured or generation fails, each file falls back to the
deterministic template render (`generatedBy: 'template'`).

```typescript
const result = await client.generateQuickScript({
  projectId: 1,
  caseIds: [456, 457],
  templateId: 3,            // Optional: defaults to the project's default/assigned template
  outputMode: 'combined',   // 'combined' (default): one file for all cases; 'perCase': one file per case
});

console.log(result.framework, result.language, result.fileExtension);
for (const file of result.results) {
  // file.code — the generated script; file.generatedBy — 'ai' | 'template'
  // file.caseName — for naming; file.contextFiles — repo files used as context
  console.log(file.caseName, file.generatedBy);
}
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
  elapsed: 15,                // Optional: duration in seconds
  notes: 'Test passed successfully', // Optional: plain text, or a Tiptap document object
  evidence: {                 // Optional: test evidence/logs
    logs: ['Step 1 completed', 'Step 2 completed']
  },
  // attempt is numbered by the server per run case; pass one only to pick a free number
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

### Run-Level Attachments & Metadata

Attach links, files, and key/value metadata to the **test run itself** (not to an individual result) — they render on the run detail page:

```typescript
// Attach an external link (e.g. the CI build that produced the run).
// Rendered as a clickable link attachment.
await client.addTestRunLink(
  testRunId,
  'https://ci.example.com/job/42',   // URL
  'CI Build #42',                    // Display name (optional, defaults to URL)
);

// Attach a file to the run
await client.uploadTestRunAttachment(
  testRunId,
  reportBuffer,        // Buffer or Blob
  'report.html',       // File name
  'text/html'          // MIME type (optional)
);

// Set key/value metadata — rendered as "**key:** value" lines in the
// run's documentation field. Repeated calls merge: existing keys are
// updated, new keys appended, other documentation content is preserved.
await client.setTestRunMetadata(testRunId, {
  version: '1.2.3',
  triggeredBy: 'jenkins',
  retries: 2,
});

// Read the metadata back (values are always strings)
const metadata = await client.getTestRunMetadata(testRunId);
```

The attachment's creator is resolved server-side from the API token — no user ID needs to be supplied.

:::tip
Using a test framework reporter? Both expose all of this without importing the client — WebdriverIO declaratively and via `browser.testplanit` ([Run Attachments & Metadata](./wdio-run-attachments.md)), Playwright declaratively and via `attachToRun`/`setRunMetadata` helpers ([Run Attachments & Metadata](./playwright-run-attachments.md)).
:::

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

### JUnit Suites and Results

Automated runs store their results in JUnit suites rather than as manual
results. The reporters use these calls to write results directly instead of
uploading an XML report; `importTestResults` above is the file-based route.

```typescript
const suite = await client.createJUnitTestSuite({
  testRunId: 123,
  name: 'checkout.spec.ts',
  file: 'tests/checkout.spec.ts',  // Optional
});

const junitResult = await client.createJUnitTestResult({
  testSuiteId: suite.id,
  repositoryCaseId: 456,
  type: 'PASSED',            // 'PASSED' | 'FAILURE' | 'ERROR' | 'SKIPPED'
  time: 1.5,                 // Optional: seconds, as in a JUnit report
  message: undefined,        // Optional: failure message
  content: undefined,        // Optional: stack trace or details
  worker: '2',               // Optional: worker/thread id the test ran on
});

// Attach a file to a JUnit result
await client.uploadJUnitAttachment(junitResult.id, screenshot, 'checkout.png', 'image/png');

// Update the suite's totals once every result is in
await client.updateJUnitTestSuite(suite.id, { tests: 1, failures: 0, errors: 0, skipped: 0, time: 1.5 });

// Read them back
const suites = await client.getJUnitTestSuites(123);
const results = await client.getJUnitTestResults(suite.id);
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
| ------------- | ------------- |
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
        elapsed: Math.round(result.duration / 1000), // Playwright reports ms; TestPlanIt stores seconds
        notes: result.error ? String(result.error) : undefined,
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

- [WebdriverIO Reporter](./wdio-overview.md) - Automatic reporting for WebdriverIO tests
- [API Tokens](../api-tokens.md) - Managing API tokens
- [API Reference](../api-reference.md) - Full REST API documentation
