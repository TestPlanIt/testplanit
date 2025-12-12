# @testplanit/wdio-reporter

WebdriverIO reporter for [TestPlanIt](https://github.com/testplanit/testplanit) - report test results directly to your TestPlanIt instance.

Similar to the [TestRail Reporter](https://webdriver.io/docs/wdio-testrail-reporter), this reporter pushes your WebdriverIO test results to TestPlanIt in real-time.

## Installation

```bash
npm install @testplanit/wdio-reporter
# or
pnpm add @testplanit/wdio-reporter
# or
yarn add @testplanit/wdio-reporter
```

## Setup

### 1. Generate an API Token

1. Log into your TestPlanIt instance
2. Go to **Settings** > **API Tokens**
3. Click **Generate New Token**
4. Copy the token (it starts with `tpi_`)

### 2. Configure the Reporter

Add the reporter to your `wdio.conf.js` or `wdio.conf.ts`:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'WebdriverIO Tests - {date} {time}',
    }]
  ],
  // ... rest of config
}
```

## Linking Test Cases

Embed TestPlanIt case IDs in your test titles using the `C` prefix (configurable):

```javascript
describe('Authentication', () => {
  it('C12345 should login with valid credentials', async () => {
    // This test will be linked to case ID 12345
  });

  it('C12346 C12347 should show error for invalid password', async () => {
    // This test will be linked to multiple cases: 12346 and 12347
  });

  it('should redirect to dashboard after login', async () => {
    // No case ID - will be skipped unless autoCreateTestCases is enabled
  });
});
```

## Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `domain` | string | Yes | - | Base URL of your TestPlanIt instance |
| `apiToken` | string | Yes | - | API token for authentication |
| `projectId` | number | Yes | - | Project ID to report results to |
| `testRunId` | number | No | - | Existing test run ID to append results to |
| `runName` | string | No | `'WebdriverIO Test Run - {date} {time}'` | Name for new test runs. Supports placeholders: `{date}`, `{time}`, `{browser}`, `{platform}` |
| `configId` | number | No | - | Configuration ID for the test run |
| `milestoneId` | number | No | - | Milestone ID for the test run |
| `stateId` | number | No | - | Workflow state ID for the test run |
| `caseIdPrefix` | string | No | `'C'` | Prefix for case IDs in test titles |
| `autoCreateTestCases` | boolean | No | `false` | Auto-create test cases if not found |
| `repositoryId` | number | No* | - | Repository ID for auto-created cases (*required if autoCreateTestCases is true) |
| `parentFolderId` | number | No* | - | Folder ID for auto-created cases (*required if autoCreateTestCases is true) |
| `templateId` | number | No* | - | Template ID for auto-created cases (*required if autoCreateTestCases is true) |
| `uploadScreenshots` | boolean | No | `true` | Upload screenshots on test failure |
| `includeStackTrace` | boolean | No | `true` | Include stack traces in results |
| `includeConsoleLogs` | boolean | No | `false` | Include console logs in results |
| `completeRunOnFinish` | boolean | No | `true` | Mark test run as completed when done |
| `oneReport` | boolean | No | `true` | Consolidate all results into one run |
| `timeout` | number | No | `30000` | API request timeout in ms |
| `maxRetries` | number | No | `3` | Number of retries for failed requests |
| `verbose` | boolean | No | `false` | Enable verbose logging |

## Examples

### Create a New Test Run

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    runName: 'E2E Tests - {browser} - {date}',
    configId: 1,
    milestoneId: 2,
  }]
]
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

### Auto-Create Test Cases

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    runName: 'Automated Tests',
    autoCreateTestCases: true,
    repositoryId: 1,
    parentFolderId: 10,
    templateId: 1,
  }]
]
```

### Custom Case ID Prefix

```javascript
// Use TC- prefix: "TC-12345 should work"
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: 'https://testplanit.example.com',
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: 1,
    caseIdPrefix: 'TC-',
  }]
]
```

### Environment-Based Configuration

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    domain: process.env.TESTPLANIT_URL,
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: process.env.CI_PROJECT_ID === 'frontend' ? 1 : 2,
    runName: `CI Build ${process.env.CI_BUILD_NUMBER} - ${process.env.CI_BRANCH}`,
    milestoneId: process.env.CI_MILESTONE_ID,
  }]
]
```

## Output

When tests complete, the reporter outputs a summary:

```
[TestPlanIt] Results Summary:
  Test Run ID: 456
  Passed: 15
  Failed: 2
  Skipped: 3
  URL: https://testplanit.example.com/projects/1/test-runs/456
```

## Verbose Mode

Enable verbose logging for debugging:

```javascript
reporters: [
  ['@testplanit/wdio-reporter', {
    // ... other options
    verbose: true,
  }]
]
```

This will log:
- Reporter initialization
- Test run creation
- Status mappings
- Each test result submission
- Screenshot uploads
- API errors

## Error Handling

The reporter handles errors gracefully:
- Failed API requests are retried (configurable)
- Individual test result failures don't stop other results
- Errors are logged but don't fail the test suite

## TypeScript Support

Full TypeScript support is included:

```typescript
import type { TestPlanItReporterOptions } from '@testplanit/wdio-reporter';

const reporterOptions: TestPlanItReporterOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
};
```

## Related Packages

- [@testplanit/api](../api) - The underlying API client used by this reporter

## License

MIT
