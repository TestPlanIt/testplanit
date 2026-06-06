# @testplanit/playwright-reporter

Playwright reporter for [TestPlanIt](https://github.com/testplanit/testplanit) - report test results directly to your TestPlanIt instance.

This is the Playwright counterpart to [`@testplanit/wdio-reporter`](https://github.com/testplanit/testplanit/tree/main/packages/wdio-testplanit-reporter). Because Playwright runs the reporter in a single main process (and forwards events from every worker to it), there is **no separate launcher service** and no `oneReport` coordination to configure — one reporter instance sees every result and reports it to a single test run.

## Installation

```bash
npm install --save-dev @testplanit/playwright-reporter
# or
pnpm add -D @testplanit/playwright-reporter
# or
yarn add -D @testplanit/playwright-reporter
```

## Quick Start

### 1. Generate an API Token

1. Log into your TestPlanIt instance
2. Go to **Settings** > **API Tokens**
3. Click **Generate New Token**
4. Copy the token (it starts with `tpi_`)

### 2. Add the reporter to your Playwright config

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'], // keep your existing reporters
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date} {time}',
    }],
  ],
});
```

Playwright supports multiple reporters at once, so you can keep `list`, `html`, or `junit` alongside this one.

## Linking Test Cases

Embed TestPlanIt case IDs in your test titles using brackets (configurable via `caseIdPattern`):

```typescript
import { test } from '@playwright/test';

test.describe('Authentication', () => {
  test('[12345] should login with valid credentials', async ({ page }) => {
    // Linked to case ID 12345
  });

  test('[12346] [12347] should show an error for invalid password', async ({ page }) => {
    // Linked to multiple cases: 12346 and 12347
  });

  test('should redirect to the dashboard', async ({ page }) => {
    // No case ID — skipped unless autoCreateTestCases is enabled
  });
});
```

### Custom Case ID Patterns

The `caseIdPattern` option accepts a regex with a capturing group for the numeric ID:

```typescript
caseIdPattern: /\[(\d+)\]/g  // Default — brackets:  "[12345] should work"
caseIdPattern: /C(\d+)/g      // C-prefix:           "C12345 should work"
caseIdPattern: /TC-(\d+)/g    // TC- prefix:         "TC-12345 should work"
caseIdPattern: /TEST-(\d+)/g  // JIRA-style:         "TEST-12345 should work"
```

## Reporter Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `domain` | `string` | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | Yes | - | API token for authentication |
| `projectId` | `number` | Yes | - | Project ID to report results to |
| `testRunId` | `number \| string` | No | - | Existing test run ID or name to append results to |
| `runName` | `string` | No | `'{suite} - {date} {time}'` | Name for new test runs. Placeholders: `{date}`, `{time}`, `{browser}` (project name), `{platform}`, `{spec}`, `{suite}` |
| `testRunType` | `string` | No | `'JUNIT'` | Test framework type stored on the run |
| `configId` | `number \| string` | No | - | Configuration ID or name for the test run |
| `milestoneId` | `number \| string` | No | - | Milestone ID or name for the test run |
| `stateId` | `number \| string` | No | - | Workflow state ID or name for the test run |
| `tagIds` | `(number \| string)[]` | No | - | Tags to apply (IDs or names). Non-existent tags are created automatically |
| `caseIdPattern` | `RegExp \| string` | No | `/\[(\d+)\]/g` | Regex to extract case IDs from test titles. Must include a capturing group |
| `autoCreateTestCases` | `boolean` | No | `false` | Auto-create test cases matched by describe path + test title |
| `createFolderHierarchy` | `boolean` | No | `false` | Create nested folders from `test.describe` structure. Requires `autoCreateTestCases` and `parentFolderId` |
| `parentFolderId` | `number \| string` | No | - | Parent folder for auto-created cases (ID or name) |
| `templateId` | `number \| string` | No | - | Template for auto-created cases (ID or name) |
| `uploadAttachments` | `boolean` | No | `true` | Upload Playwright attachments (screenshots, videos, traces) to the result |
| `attachmentTypes` | `string[]` | No | all | Restrict which attachments upload. Matches the attachment `name` or a `contentType` prefix, e.g. `['image/']` for screenshots only |
| `includeStackTrace` | `boolean` | No | `true` | Include stack traces in results |
| `completeRunOnFinish` | `boolean` | No | `true` | Mark the test run as completed when the run finishes |
| `timeout` | `number` | No | `30000` | API request timeout in ms |
| `maxRetries` | `number` | No | `3` | Number of retries for failed API requests |
| `verbose` | `boolean` | No | `false` | Enable verbose logging |

> **Tip:** Options like `configId`, `milestoneId`, `stateId`, `parentFolderId`, and `templateId` accept either numeric IDs or string names. When a string is provided, the resource is looked up by exact name match.

## Attachments

Playwright collects screenshots, videos, and traces automatically based on your `use` settings:

```typescript
export default defineConfig({
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
});
```

Every attachment on a test result — including anything you add with `testInfo.attach()` — is uploaded to the corresponding JUnit result. To limit uploads, set `attachmentTypes`:

```typescript
// Screenshots only (matches the WebdriverIO reporter's behaviour)
attachmentTypes: ['image/']

// Screenshots and videos, but not traces
attachmentTypes: ['image/', 'video/']
```

## Retries

Playwright calls the reporter once per retry attempt. **Each attempt is reported as its own result**, so a test that fails and then passes on retry produces both a `FAILURE` and a `PASSED` result against the same case — giving you the full attempt history. The case is added to the run only once.

## Examples

### Auto-Create Test Cases with Folder Hierarchy

```typescript
['@testplanit/playwright-reporter', {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: 1,
  autoCreateTestCases: true,
  createFolderHierarchy: true,
  parentFolderId: 'Automated Tests',
  templateId: 'Default Template',
}]
```

With `createFolderHierarchy`, nested `test.describe` blocks create matching folders:

```typescript
test.describe('Authentication', () => {        // Folder: Automated Tests > Authentication
  test.describe('Login', () => {               // Folder: Automated Tests > Authentication > Login
    test('should accept valid credentials');   // Case placed in the Login folder
  });
});
```

### Append to an Existing Test Run

```typescript
['@testplanit/playwright-reporter', {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: 1,
  testRunId: 123,            // by ID
  // testRunId: 'Nightly',   // …or by name
}]
```

### Environment-Based Configuration

```typescript
['@testplanit/playwright-reporter', {
  domain: process.env.TESTPLANIT_URL,
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: Number(process.env.TESTPLANIT_PROJECT_ID),
  runName: `CI Build ${process.env.GITHUB_RUN_NUMBER} - ${process.env.GITHUB_REF_NAME}`,
  milestoneId: process.env.TESTPLANIT_MILESTONE_ID,
}]
```

## Output

When the run completes, the reporter prints a summary:

```console
[TestPlanIt] ═══════════════════════════════════════════════════════
[TestPlanIt] Results Summary
[TestPlanIt] ═══════════════════════════════════════════════════════
[TestPlanIt]   Test Run ID: 456
[TestPlanIt]   Duration: 12.4s
[TestPlanIt]
[TestPlanIt]   Test Results:
[TestPlanIt]     ✓ Passed:  18
[TestPlanIt]     ✗ Failed:  2
[TestPlanIt]     ○ Skipped: 1
[TestPlanIt]     Total:     21
[TestPlanIt]
[TestPlanIt]   View results: https://testplanit.example.com/projects/runs/1/456
[TestPlanIt] ═══════════════════════════════════════════════════════
```

## Error Handling

- Reporter errors are logged but never fail your test suite
- Failed API requests are retried (configurable via `maxRetries`)
- A failure on one result doesn't stop other results from being reported
- Tests without a case ID are skipped with a warning unless `autoCreateTestCases` is enabled

## Compatibility

| Playwright Version | Supported |
| ------------------ | --------- |
| 1.44+ | Yes |

Requires `@playwright/test` 1.44 or later (the reporter uses the `Suite.type` API) and Node.js 20 or later.

## Related Packages

- [@testplanit/api](https://github.com/TestPlanIt/testplanit/tree/main/packages/api) - The underlying API client used by this reporter
- [@testplanit/wdio-reporter](https://github.com/TestPlanIt/testplanit/tree/main/packages/wdio-testplanit-reporter) - The WebdriverIO equivalent

## License

MIT
