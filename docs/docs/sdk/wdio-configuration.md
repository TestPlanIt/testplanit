---
title: Configuration Options
---

# Configuration Options

These options apply to the **reporter**. If you're using the [Launcher Service](./wdio-launcher-service.md), see [Choosing Your Setup](./wdio-overview.md#choosing-your-setup) for which options apply where.

## Required

| Option | Type                     | Description |
| -------- | -------------------------- | ------------- |
| `domain` | `string` | Base URL of your TestPlanIt instance |
| `apiToken` | `string` | API token for authentication (starts with `tpi_`) |
| `projectId` | `number` | Project ID where results will be reported (find this on the [Project Overview](../user-guide/project-overview.md) page) |

## Optional

| Option | Type                     | Default | Description |
| -------- | -------------------------- | --------- | ------------- |
| `testRunId` | `number \| string` | - | Existing test run to add results to (ID or name). If set, `runName` is ignored |
| `runName` | `string` | `'{suite} - {date} {time}'` | Name for new test runs (ignored if `testRunId` is set). Supports placeholders |
| `testRunType` | `string` | Auto-detected | Test framework type. Auto-detected from WebdriverIO config (`mocha` → `'MOCHA'`, `cucumber` → `'CUCUMBER'`, others → `'REGULAR'`). Override manually if needed. |
| `configId` | `number \| string` | - | Configuration for the test run (ID or name) |
| `milestoneId` | `number \| string` | - | Milestone for the test run (ID or name) |
| `stateId` | `number \| string` | - | Workflow state for the test run (ID or name) |
| `caseIdPattern` | `RegExp \| string` | `/\[(\d+)\]/g` | Regex pattern for extracting case IDs from test titles |
| `autoCreateTestCases` | `boolean` | `false` | Auto-create test cases if they don't exist |
| `captureSteps` | `boolean` | `true` | Capture a Cucumber scenario's Given/When/Then as the case's Steps (Cucumber only; silent no-op for Mocha/Jasmine) |
| `overwriteSteps` | `boolean` | `false` | Replace an existing Cucumber case's steps each run — destructive, discards manual edits (Cucumber only) |
| `createFolderHierarchy` | `boolean` | `false` | Create folder hierarchy based on Mocha suite structure (requires `autoCreateTestCases` and `parentFolderId`) |
| `parentFolderId` | `number \| string` | - | Folder for auto-created test cases (ID or name) |
| `templateId` | `number \| string` | - | Template for auto-created test cases (ID or name) |
| `tagIds` | `(number \| string)[]` | - | Tags to apply to the test run (IDs or names). Tags that don't exist are created automatically |
| `uploadScreenshots` | `boolean` | `true` | Upload intercepted screenshots to TestPlanIt (requires screenshot capture — see [Screenshot Uploads](./wdio-screenshots.md)) |
| `includeStackTrace` | `boolean` | `true` | Include stack traces for failures |
| `completeRunOnFinish` | `boolean` | `true` | Mark run as complete when tests finish |
| `oneReport` | `boolean` | `true` | Combine parallel workers from the same spec file into a single test run. Does not persist across spec file batches — use the [Launcher Service](./wdio-launcher-service.md) for that |
| `timeout` | `number` | `30000` | API request timeout in ms |
| `maxRetries` | `number` | `3` | Retry attempts for failed requests |
| `verbose` | `boolean` | `false` | Enable debug logging |

## Run Name Placeholders

Customize your test run names with these placeholders:

| Placeholder | Description | Example |
| ------------- | ------------- | --------- |
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
