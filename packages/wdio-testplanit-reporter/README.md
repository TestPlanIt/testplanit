# @testplanit/wdio-reporter

WebdriverIO reporter and service for [TestPlanIt](https://github.com/testplanit/testplanit) - report test results directly to your TestPlanIt instance.

This package includes:

- **Reporter** - Tracks test execution in worker processes and reports results to TestPlanIt
- **Service** - Manages the test run lifecycle in the main process, ensuring all workers report to a single test run

## Installation

```bash
npm install @testplanit/wdio-reporter
# or
pnpm add @testplanit/wdio-reporter
# or
yarn add @testplanit/wdio-reporter
```

## Quick Start

### 1. Generate an API Token

1. Log into your TestPlanIt instance
2. Go to **Settings** > **API Tokens**
3. Click **Generate New Token**
4. Copy the token (it starts with `tpi_`)

### 2. Configure the Reporter and Service

Add both the service and reporter to your `wdio.conf.js` or `wdio.conf.ts`:

```javascript
// wdio.conf.js
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  services: [
    [TestPlanItService, {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date} {time}',
      captureScreenshots: true,
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
    }]
  ],
  // ... rest of config
}
```

> **Note:** The service is recommended when running with `maxInstances > 1`. It creates a single test run before workers start, eliminating race conditions. Without the service, the reporter can still manage test runs on its own using file-based coordination (`oneReport: true`).

## Service vs Reporter

| Aspect | Service | Reporter |
| -------- | --------- | --------- |
| **Process** | Main WDIO process | Each worker process |
| **Timing** | Runs once before/after all workers | Runs in each worker |
| **Test run creation** | Creates in `onPrepare` | Fallback: creates if no service |
| **Result reporting** | - | Reports each test result |
| **Screenshot capture** | Optional (`captureScreenshots`) | - |
| **Screenshot upload** | - | Uploads in `onRunnerEnd` |
| **Run completion** | Completes in `onComplete` | Skips if service-managed |

## Linking Test Cases

Embed TestPlanIt case IDs in your test titles using brackets (configurable via `caseIdPattern`):

```javascript
describe('Authentication', () => {
  it('[12345] should login with valid credentials', async () => {
    // This test will be linked to case ID 12345
  });

  it('[12346] [12347] should show error for invalid password', async () => {
    // This test will be linked to multiple cases: 12346 and 12347
  });

  it('should redirect to dashboard after login', async () => {
    // No case ID - will be skipped unless autoCreateTestCases is enabled
  });
});
```

### Custom Case ID Patterns

The `caseIdPattern` option accepts a regex with a capturing group for the numeric ID:

```javascript
// Default: brackets - "[12345] should work"
caseIdPattern: /\[(\d+)\]/g

// C-prefix: "C12345 should work"
caseIdPattern: /C(\d+)/g

// TC- prefix: "TC-12345 should work"
caseIdPattern: /TC-(\d+)/g

// JIRA-style: "TEST-12345 should work"
caseIdPattern: /TEST-(\d+)/g
```

## Reporter Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `domain` | `string` | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | Yes | - | API token for authentication |
| `projectId` | `number` | Yes | - | Project ID to report results to |
| `testRunId` | `number \| string` | No | - | Existing test run ID or name to append results to |
| `runName` | `string` | No | `'{suite} - {date} {time}'` | Name for new test runs. Supports placeholders: `{date}`, `{time}`, `{browser}`, `{platform}`, `{spec}`, `{suite}` |
| `testRunType` | `string` | No | Auto-detected | Test framework type: `'REGULAR'`, `'MOCHA'`, `'CUCUMBER'`, etc. Auto-detected from WDIO config |
| `configId` | `number \| string` | No | - | Configuration ID or name for the test run |
| `milestoneId` | `number \| string` | No | - | Milestone ID or name for the test run |
| `stateId` | `number \| string` | No | - | Workflow state ID or name for the test run |
| `tagIds` | `(number \| string)[]` | No | - | Tags to apply (IDs or names). Non-existent tags are created automatically |
| `caseIdPattern` | `RegExp \| string` | No | `/\[(\d+)\]/g` | Regex to extract case IDs from test titles. Must include a capturing group |
| `autoCreateTestCases` | `boolean` | No | `false` | Auto-create test cases matched by suite name + test title |
| `captureSteps` | `boolean` | No | `true` | Capture a Cucumber scenario's Given/When/Then as the case's Steps. Cucumber only; silent no-op for Mocha/Jasmine |
| `overwriteSteps` | `boolean` | No | `false` | Replace an existing Cucumber case's steps on each run (destructive: discards manual edits). Cucumber only |
| `createFolderHierarchy` | `boolean` | No | `false` | Create nested folders based on suite structure. Requires `autoCreateTestCases` and `parentFolderId` |
| `parentFolderId` | `number \| string` | No | - | Parent folder for auto-created cases (ID or name) |
| `templateId` | `number \| string` | No | - | Template for auto-created cases (ID or name) |
| `uploadScreenshots` | `boolean` | No | `true` | Upload intercepted screenshots |
| `includeStackTrace` | `boolean` | No | `true` | Include stack traces in results |
| `completeRunOnFinish` | `boolean` | No | `true` | Mark test run as completed when done |
| `oneReport` | `boolean` | No | `true` | Combine parallel workers from the same spec file into a single test run. Does not persist across spec file batches — use the service for that |
| `timeout` | `number` | No | `30000` | API request timeout in ms |
| `maxRetries` | `number` | No | `3` | Number of retries for failed requests |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |

> **Tip:** Options like `configId`, `milestoneId`, `stateId`, `parentFolderId`, and `templateId` accept either numeric IDs or string names. When a string is provided, the system looks up the resource by exact name match.

## Capturing Gherkin Steps as Case Steps

When you run with [`@wdio/cucumber-framework`](https://webdriver.io/docs/frameworks/#using-cucumber) and `autoCreateTestCases: true`, the reporter creates **one case per scenario** and (with `captureSteps: true`, the default) writes the scenario's Gherkin steps as the case's **Steps**:

- **`Given`** → a Precondition (leading step, no expected result)
- **`When`** → a Step (action)
- **`Then`** → the **Expected Result** of the preceding `When` step
- **`And` / `But` / `*`** inherit the role of the nearest preceding primary keyword

This uses the same mapping as the TestPlanIt result importer, so a Cucumber scenario yields the **same** case Steps whether it is imported or reported via WDIO.

```javascript
// wdio.conf.js
export const config = {
  framework: 'cucumber', // scenarioLevelReporter must be false (the default)
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,
      templateId: 1,
      captureSteps: true,      // default — capture Given/When/Then as Steps
      overwriteSteps: false,   // set true to re-sync steps every run (destructive)
    }]
  ]
}
```

`overwriteSteps: true` soft-deletes a case's existing steps and rewrites them from the scenario every run — **destructive**: any manual edits are discarded. As a safeguard, a scenario with no steps never clears existing steps. Leave it `false` (the default) to never overwrite human-edited steps.

### Limitations

- **Mocha and Jasmine produce no deterministic steps.** They have no native step structure, so `captureSteps`/`overwriteSteps` are silent no-ops for those frameworks (the reporter logs a one-time notice). If an LLM provider is configured for the project, TestPlanIt's LLM enrichment can derive steps for these cases automatically — configuring a provider is the opt-in; no extra reporter option is needed.
- **`scenarioLevelReporter: true` is not supported for step capture.** In that Cucumber mode the framework suppresses per-step events, so the reporter cannot see the individual Gherkin steps. Use the default `scenarioLevelReporter: false` to capture steps.

## Service Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `domain` | `string` | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | Yes | - | API token for authentication |
| `projectId` | `number` | Yes | - | Project ID to report results to |
| `runName` | `string` | No | `'Automated Tests - {date} {time}'` | Name for the test run. Supports `{date}`, `{time}`, `{platform}` |
| `testRunType` | `string` | No | `'MOCHA'` | Test framework type |
| `configId` | `number \| string` | No | - | Configuration ID or name |
| `milestoneId` | `number \| string` | No | - | Milestone ID or name |
| `stateId` | `number \| string` | No | - | Workflow state ID or name |
| `tagIds` | `(number \| string)[]` | No | - | Tags to apply (IDs or names) |
| `captureScreenshots` | `boolean` | No | `false` | Auto-capture screenshots on test failure via `afterTest` hook |
| `completeRunOnFinish` | `boolean` | No | `true` | Mark test run as completed when all workers finish |
| `timeout` | `number` | No | `30000` | API request timeout in ms |
| `maxRetries` | `number` | No | `3` | Number of retries for failed requests |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |

> **Note:** The service's `runName` does not support `{browser}`, `{spec}`, or `{suite}` placeholders since it runs before any workers start.

## Examples

### Recommended: Service + Reporter (Multi-Worker)

```javascript
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  maxInstances: 5,
  services: [
    [TestPlanItService, {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date} {time}',
      captureScreenshots: true,
      milestoneId: 'Sprint 42',
      tagIds: ['regression', 'automated'],
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      createFolderHierarchy: true,
      parentFolderId: 'Automated Tests',
      templateId: 1,
    }]
  ],
}
```

### Reporter Only (Single Worker)

```javascript
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {browser} - {date}',
      configId: 1,
      milestoneId: 2,
    }]
  ],
}
```

### Append to Existing Test Run

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    testRunId: 123, // Existing run ID
  }]
]
```

You can also reference a test run by name:

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    testRunId: 'Nightly Regression', // Looked up by name
  }]
]
```

### Auto-Create Test Cases with Folder Hierarchy

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    autoCreateTestCases: true,
    createFolderHierarchy: true,
    parentFolderId: 'Automated Tests',
    templateId: 'Default Template',
  }]
]
```

With `createFolderHierarchy`, nested `describe` blocks create matching folders:

```javascript
describe('Authentication', () => {         // Creates folder: Automated Tests > Authentication
  describe('Login', () => {                // Creates folder: Automated Tests > Authentication > Login
    it('should accept valid credentials');  // Test case placed in Login folder
  });
});
```

### Environment-Based Configuration

```javascript
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  services: [
    [TestPlanItService, {
      domain: process.env.TESTPLANIT_URL,
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: Number(process.env.TESTPLANIT_PROJECT_ID),
      runName: `CI Build ${process.env.CI_BUILD_NUMBER} - ${process.env.CI_BRANCH}`,
      milestoneId: process.env.CI_MILESTONE_ID,
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: process.env.TESTPLANIT_URL,
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: Number(process.env.TESTPLANIT_PROJECT_ID),
      autoCreateTestCases: true,
      parentFolderId: 10,
      templateId: 1,
    }]
  ],
}
```

## Output

When tests complete, the service outputs a summary:

```console
[TestPlanIt Service] Test run created: "E2E Tests - 2025-01-15 10:30:00" (ID: 456)

[TestPlanIt Service] ══════════════════════════════════════════
[TestPlanIt Service]   Test Run ID: 456
[TestPlanIt Service]   Status: Completed
[TestPlanIt Service]   View: https://testplanit.example.com/projects/runs/1/456
[TestPlanIt Service] ══════════════════════════════════════════
```

## Verbose Mode

Enable verbose logging for debugging on both the service and reporter:

```javascript
services: [
  [TestPlanItService, {
    // ... other options
    verbose: true,
  }]
],
reporters: [
  ['@testplanit/wdio-reporter', {
    // ... other options
    verbose: true,
  }]
]
```

This will log:

- Reporter/service initialization
- Test run and suite creation
- ID resolution (name lookups)
- Status mappings
- Each test result submission
- Screenshot captures and uploads
- API errors and retries

## Error Handling

- **Service errors** in `onPrepare` will throw and stop the test suite
- **Service errors** in `onComplete` are logged but don't throw (to avoid hiding test results)
- **Reporter errors** are logged but don't fail the test suite
- Failed API requests are retried (configurable via `maxRetries`)
- Individual test result failures don't stop other results from being reported

## TypeScript Support

Full TypeScript support is included:

```typescript
import { TestPlanItService } from '@testplanit/wdio-reporter';
import type { TestPlanItReporterOptions, TestPlanItServiceOptions } from '@testplanit/wdio-reporter';

const serviceOptions: TestPlanItServiceOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
  captureScreenshots: true,
};

const reporterOptions: TestPlanItReporterOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
  autoCreateTestCases: true,
  parentFolderId: 10,
  templateId: 1,
};
```

## Compatibility

| WebdriverIO Version | Supported |
| -------------------- | ----------- |
| 9.x | Yes |
| 8.x | Yes |

Requires Node.js 24 or later.

## Related Packages

- [@testplanit/api](https://github.com/TestPlanIt/testplanit/tree/main/packages/api) - The underlying API client used by this reporter

## License

MIT
