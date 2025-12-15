---
sidebar_position: 3
title: WebdriverIO Reporter (@testplanit/wdio-reporter)
---

# WebdriverIO Reporter

`@testplanit/wdio-reporter` is an official WebdriverIO reporter that automatically sends test results to your TestPlanIt instance. It supports linking tests to existing test cases, automatic test case creation, screenshot uploads, and more.

## Installation

```bash
npm install @testplanit/wdio-reporter @testplanit/api
# or
pnpm add @testplanit/wdio-reporter @testplanit/api
# or
yarn add @testplanit/wdio-reporter @testplanit/api
```

## Quick Start

Add the reporter to your WebdriverIO configuration:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
    }]
  ],
};
```

Run your tests:

```bash
npx wdio run wdio.conf.js
```

After your tests complete, you'll see a summary:

```text
[TestPlanIt] Results Summary
[TestPlanIt] ═══════════════════════════════════════════════════════
[TestPlanIt]   Test Run ID: 123
[TestPlanIt]   Duration: 45.2s
[TestPlanIt]
[TestPlanIt]   Test Results:
[TestPlanIt]     ✓ Passed:  15
[TestPlanIt]     ✗ Failed:  2
[TestPlanIt]     ○ Skipped: 1
[TestPlanIt]     Total:     18
[TestPlanIt]
[TestPlanIt]   View results: https://testplanit.example.com/projects/runs/1/123
[TestPlanIt] ═══════════════════════════════════════════════════════
```

When `autoCreateTestCases` is enabled, additional stats are shown:

```text
[TestPlanIt]   Test Cases:
[TestPlanIt]     Found (existing): 12
[TestPlanIt]     Created (new):    6
```

Screenshot upload stats appear when screenshots are captured:

```text
[TestPlanIt]   Screenshots:
[TestPlanIt]     Uploaded: 2
```

## Configuration Options

### Required

| Option | Type                     | Description |
|--------|--------------------------|-------------|
| `domain` | `string` | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | API token for authentication (starts with `tpi_`) |
| `projectId` | `number` | Project ID where results will be reported (find this on the [Project Overview](../user-guide/project-overview.md) page) |

### Optional

| Option | Type                     | Default | Description |
|--------|--------------------------|---------|-------------|
| `testRunId` | `number \| string` | - | Existing test run to add results to (ID or name). If set, `runName` is ignored |
| `runName` | `string` | `'{suite} - {date} {time}'` | Name for new test runs (ignored if `testRunId` is set). Supports placeholders |
| `testRunType` | `string` | Auto-detected | Test framework type. Auto-detected from WebdriverIO config (`mocha` → `'MOCHA'`, `cucumber` → `'CUCUMBER'`, others → `'REGULAR'`). Override manually if needed. |
| `configId` | `number \| string` | - | Configuration for the test run (ID or name) |
| `milestoneId` | `number \| string` | - | Milestone for the test run (ID or name) |
| `stateId` | `number \| string` | - | Workflow state for the test run (ID or name) |
| `caseIdPattern` | `RegExp \| string` | `/\[(\d+)\]/g` | Regex pattern for extracting case IDs from test titles |
| `autoCreateTestCases` | `boolean` | `false` | Auto-create test cases if they don't exist |
| `createFolderHierarchy` | `boolean` | `false` | Create folder hierarchy based on Mocha suite structure (requires `autoCreateTestCases` and `parentFolderId`) |
| `parentFolderId` | `number \| string` | - | Folder for auto-created test cases (ID or name) |
| `templateId` | `number \| string` | - | Template for auto-created test cases (ID or name) |
| `tagIds` | `(number \| string)[]` | - | Tags to apply to the test run (IDs or names). Tags that don't exist are created automatically |
| `uploadScreenshots` | `boolean` | `true` | Upload intercepted screenshots to TestPlanIt (requires `afterTest` hook to capture them) |
| `includeStackTrace` | `boolean` | `true` | Include stack traces for failures |
| `completeRunOnFinish` | `boolean` | `true` | Mark run as complete when tests finish |
| `oneReport` | `boolean` | `true` | Use single test run for all specs |
| `timeout` | `number` | `30000` | API request timeout in ms |
| `maxRetries` | `number` | `3` | Retry attempts for failed requests |
| `verbose` | `boolean` | `false` | Enable debug logging |

## Linking Tests to Test Cases

Link your automated tests to existing TestPlanIt test cases by including case IDs in your test titles. By default, the reporter looks for case IDs in square brackets like `[1234]`:

```javascript
describe('User Authentication', () => {
  it('[12345] should login with valid credentials', async () => {
    // This test links to TestPlanIt case #12345
    await LoginPage.login('user@example.com', 'password');
    await expect(DashboardPage.heading).toBeDisplayed();
  });

  it('[12346] [12347] should show error for invalid password', async () => {
    // This test links to BOTH case #12346 and #12347
    await LoginPage.login('user@example.com', 'wrongpassword');
    await expect(LoginPage.errorMessage).toHaveText('Invalid credentials');
  });

  it('should logout successfully', async () => {
    // No case ID - will be skipped unless autoCreateTestCases is enabled
    // With autoCreateTestCases: true, this links to or creates a case named "should logout successfully"
    await DashboardPage.logout();
  });
});
```

### Custom Case ID Patterns

The `caseIdPattern` option accepts a regular expression to match case IDs in your test titles. The pattern **must include a capturing group** `(\d+)` to extract the numeric ID.

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      // Choose a pattern that matches your test naming convention:
      caseIdPattern: /C(\d+)/g,  // Matches: C12345
    }]
  ],
};
```

#### When No Case ID Is Found

If the pattern doesn't match any case ID in a test title, the behavior depends on the `autoCreateTestCases` setting:

| `autoCreateTestCases` | Behavior |
|-----------------------|----------|
| `false` (default) | The test result is **skipped** and not reported to TestPlanIt. A warning is logged if `verbose` is enabled. |
| `true` | The reporter looks up or creates a test case by matching on the test name and suite (className). See [Auto-Creating Test Cases](#auto-creating-test-cases). |

This means if you're using case IDs exclusively (without auto-creation), tests without valid case IDs in their titles won't appear in your TestPlanIt results.

#### Common Pattern Examples

| Pattern | Matches | Example Test Title |
|---------|---------|-------------------|
| `/\[(\d+)\]/g` (default) | `[1234]` | `[1234] should load the page` |
| `/C(\d+)/g` | `C1234` | `C1234 should load the page` |
| `/TC-(\d+)/g` | `TC-1234` | `TC-1234 should load the page` |
| `/TEST-(\d+)/g` | `TEST-1234` | `TEST-1234 should load the page` |
| `/CASE-(\d+)/g` | `CASE-1234` | `CASE-1234 should load the page` |
| `/^(\d+)\s/g` | Plain number at start | `1234 should load the page` |
| `/#(\d+)/g` | `#1234` | `#1234 should load the page` |

#### Using Pattern as String

You can also pass the pattern as a string (useful for JSON config files):

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      caseIdPattern: 'TC-(\\d+)',  // Note: double backslash in strings
    }]
  ],
};
```

## Run Name Placeholders

Customize your test run names with these placeholders:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{suite}` | Root suite name (first describe block) | `Login Tests` |
| `{spec}` | Spec file name (without extension) | `login` |
| `{date}` | Current date in ISO format | `2024-01-15` |
| `{time}` | Current time | `14:30:00` |
| `{browser}` | Browser name from capabilities | `chrome` |
| `{platform}` | Platform/OS name | `darwin`, `linux`, `win32` |

The default run name is `'{suite} - {date} {time}'`, which uses the root describe block name to identify your test runs.

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      // Default: '{suite} - {date} {time}'
      // Custom example:
      runName: 'E2E Tests - {browser} - {date} {time}',
    }]
  ],
};
```

## Auto-Creating Test Cases

Automatically create test cases in TestPlanIt for tests without case IDs:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,     // Required: folder for new cases
      templateId: 1,          // Required: template for new cases
    }]
  ],
};
```

When `autoCreateTestCases` is enabled:
- Tests with case IDs still link to existing cases
- Tests without case IDs are looked up by name and suite (className)
- If a matching case is found, results are linked to it
- If no match is found, a new case is created in TestPlanIt
- The test title becomes the case name
- The suite name becomes the case's `className` for grouping

This means on first run, test cases are created automatically. On subsequent runs, the same test cases are reused based on matching name and suite.

### Creating Folder Hierarchies

When you have nested Mocha suites (describe blocks), you can automatically create a matching folder structure in TestPlanIt:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,          // Root folder for created hierarchy
      templateId: 1,
      createFolderHierarchy: true, // Enable folder hierarchy creation
    }]
  ],
};
```

With `createFolderHierarchy` enabled, nested describe blocks create nested folders:

```javascript
// test/specs/login.spec.js
describe('Authentication', () => {           // Creates folder: "Authentication"
  describe('Login', () => {                  // Creates folder: "Authentication > Login"
    describe('@smoke', () => {               // Creates folder: "Authentication > Login > @smoke"
      it('should login with valid credentials', async () => {
        // Test case placed in "Authentication > Login > @smoke" folder
      });
    });
  });
});
```

This creates:

```text
parentFolderId (e.g., "Automated Tests")
└── Authentication
    └── Login
        └── @smoke
            └── "should login with valid credentials" (test case)
```

**Requirements:**

- `autoCreateTestCases` must be `true`
- `parentFolderId` must be set (this becomes the root of the hierarchy)
- `templateId` must be set for new test cases

Folder paths are cached during the test run to avoid redundant API calls, making large test suites efficient.

## Appending to Existing Test Runs

Add results to an existing test run instead of creating a new one:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      testRunId: 456,  // Add results to this existing run
    }]
  ],
};
```

This is useful for:
- Aggregating results from multiple CI jobs
- Running tests in parallel across machines
- Re-running failed tests without creating new runs

## Screenshot Uploads

The reporter can upload screenshots to TestPlanIt when `uploadScreenshots` is enabled (the default). However, **the reporter does not automatically capture screenshots** - it intercepts screenshots taken by your WebdriverIO configuration and uploads them.

You must configure WebdriverIO to capture screenshots on failure using the `afterTest` hook:

```javascript
// wdio.conf.js
export const config = {
  afterTest: async function(test, context, { error, result, duration, passed }) {
    if (!passed) {
      // Take a screenshot - the reporter will intercept and upload it
      await browser.takeScreenshot();
    }
  },
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      uploadScreenshots: true, // Upload intercepted screenshots to TestPlanIt
    }]
  ],
};
```

**How it works:**

1. Your `afterTest` hook calls `browser.takeScreenshot()` when a test fails
2. The reporter intercepts the screenshot data from the WebdriverIO command
3. When the test result is reported, the screenshot is uploaded as an attachment

**Note:** Using `browser.saveScreenshot('./path/to/file.png')` also works - the reporter intercepts the screenshot data before it's saved to disk.

## Associating with Configurations and Milestones

Track test results against specific configurations (browser/OS combinations) and milestones:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      configId: 5,      // e.g., "Chrome / macOS"
      milestoneId: 10,  // e.g., "Sprint 15"
      stateId: 2,       // e.g., "In Progress" workflow state
    }]
  ],
};
```

## CI/CD Integration

### GitHub Actions

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run E2E tests
        env:
          TESTPLANIT_API_TOKEN: ${{ secrets.TESTPLANIT_API_TOKEN }}
        run: npx wdio run wdio.conf.js
```

### GitLab CI

```yaml
e2e-tests:
  image: node:20
  script:
    - npm ci
    - npx wdio run wdio.conf.js
  variables:
    TESTPLANIT_API_TOKEN: $TESTPLANIT_API_TOKEN
```

### Jenkins

```groovy
pipeline {
    agent any
    environment {
        TESTPLANIT_API_TOKEN = credentials('testplanit-api-token')
    }
    stages {
        stage('E2E Tests') {
            steps {
                sh 'npm ci'
                sh 'npx wdio run wdio.conf.js'
            }
        }
    }
}
```

### Dynamic Run Names with Build Info

Include CI build information in your test run names:

```javascript
// wdio.conf.js
const buildNumber = process.env.GITHUB_RUN_NUMBER
  || process.env.CI_PIPELINE_ID
  || process.env.BUILD_NUMBER
  || 'local';

const branch = process.env.GITHUB_REF_NAME
  || process.env.CI_COMMIT_REF_NAME
  || process.env.GIT_BRANCH
  || 'unknown';

export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: `Build #${buildNumber} - ${branch} - {browser}`,
    }]
  ],
};
```

## Handling Test Retries

The reporter tracks retry attempts and reports them to TestPlanIt:

```javascript
// wdio.conf.js
export const config = {
  specFileRetries: 1,      // Retry failed spec files
  specFileRetriesDelay: 0,
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
    }]
  ],
};
```

Each retry attempt is recorded with its attempt number, so you can see the full history of a flaky test.

## Debugging

Enable verbose logging to troubleshoot issues:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      verbose: true,  // Enables detailed logging
    }]
  ],
};
```

You'll see detailed output:

```
[TestPlanIt] Initializing reporter...
[TestPlanIt] Status mapping: passed -> 1
[TestPlanIt] Status mapping: failed -> 2
[TestPlanIt] Status mapping: skipped -> 3
[TestPlanIt] Creating test run: E2E Tests - 2024-01-15 14:30:00
[TestPlanIt] Created test run with ID: 123
[TestPlanIt] Test passed: should login successfully (Case IDs: 12345)
[TestPlanIt] Added case to run: 456
[TestPlanIt] Created test result: 789
```

## Complete Example

Here's a complete configuration with all features:

```javascript
// wdio.conf.js
export const config = {
  specs: ['./test/specs/**/*.js'],

  capabilities: [{
    browserName: 'chrome',
    'goog:chromeOptions': {
      args: ['--headless', '--disable-gpu']
    }
  }],

  framework: 'mocha',

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  },

  reporters: [
    'spec',  // Keep the spec reporter for console output
    ['@testplanit/wdio-reporter', {
      // Required
      domain: process.env.TESTPLANIT_URL || 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: parseInt(process.env.TESTPLANIT_PROJECT_ID || '1'),

      // Test run configuration
      runName: `E2E Tests - Build #${process.env.BUILD_NUMBER || 'local'} - {browser}`,
      configId: 5,        // Chrome configuration
      milestoneId: 10,    // Current sprint

      // Case ID parsing (default matches [1234] format)
      caseIdPattern: /\[(\d+)\]/g,

      // Auto-create cases (optional)
      autoCreateTestCases: false,
      parentFolderId: 100,
      templateId: 1,

      // Result options
      uploadScreenshots: true,
      includeStackTrace: true,

      // Behavior
      completeRunOnFinish: true,
      oneReport: true,

      // API options
      timeout: 30000,
      maxRetries: 3,

      // Debugging
      verbose: process.env.DEBUG === 'true',
    }]
  ],

  // Capture screenshots on failure
  afterTest: async function(test, context, { passed }) {
    if (!passed) {
      const timestamp = Date.now();
      await browser.saveScreenshot(`./screenshots/failure-${timestamp}.png`);
    }
  },
};
```

## TypeScript Support

The package includes full TypeScript definitions:

```typescript
import type { TestPlanItReporterOptions } from '@testplanit/wdio-reporter';

const reporterOptions: TestPlanItReporterOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
  runName: 'TypeScript Tests - {date}',
  verbose: true,
};
```

## Compatibility

| WebdriverIO Version | Supported |
|--------------------|-----------|
| 9.x | ✅ |
| 8.x | ✅ |

Requires Node.js 18 or later.

## Related Resources

- [API Client](./api-client.md) - Direct API access for custom integrations
- [SDK Overview](./index.md) - Architecture and package overview
- [API Tokens](../api-tokens.md) - Creating and managing API tokens
