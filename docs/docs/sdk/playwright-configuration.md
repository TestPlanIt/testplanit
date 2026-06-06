---
title: Configuration Options
---

# Configuration Options

These options are passed in the reporter tuple in your `playwright.config.ts`:

```typescript
reporter: [
  ['@testplanit/playwright-reporter', { /* options */ }],
],
```

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
| `testRunType` | `string` | `'JUNIT'` | Test framework type stored on the run |
| `configId` | `number \| string` | - | Configuration for the test run (ID or name) |
| `milestoneId` | `number \| string` | - | Milestone for the test run (ID or name) |
| `stateId` | `number \| string` | - | Workflow state for the test run (ID or name) |
| `caseIdPattern` | `RegExp \| string` | `/\[(\d+)\]/g` | Regex pattern for extracting case IDs from test titles |
| `autoCreateTestCases` | `boolean` | `false` | Auto-create test cases if they don't exist |
| `createFolderHierarchy` | `boolean` | `false` | Create folder hierarchy based on `test.describe` structure (requires `autoCreateTestCases` and `parentFolderId`) |
| `parentFolderId` | `number \| string` | - | Folder for auto-created test cases (ID or name) |
| `templateId` | `number \| string` | - | Template for auto-created test cases (ID or name) |
| `tagIds` | `(number \| string)[]` | - | Tags to apply to the test run (IDs or names). Tags that don't exist are created automatically |
| `uploadAttachments` | `boolean` | `true` | Upload Playwright attachments (screenshots, videos, traces) to the result — see [Attachment Uploads](./playwright-attachments.md) |
| `attachmentTypes` | `string[]` | all | Restrict which attachments upload, by attachment name or content-type prefix (e.g. `['image/']`) |
| `includeStackTrace` | `boolean` | `true` | Include stack traces for failures |
| `completeRunOnFinish` | `boolean` | `true` | Mark run as complete when tests finish |
| `timeout` | `number` | `30000` | API request timeout in ms |
| `maxRetries` | `number` | `3` | Retry attempts for failed requests |
| `verbose` | `boolean` | `false` | Enable debug logging |

:::tip
Options like `configId`, `milestoneId`, `stateId`, `parentFolderId`, and `templateId` accept either a numeric ID or a string name. When a string is provided, the resource is looked up by exact name match.
:::

## Run Name Placeholders

Customize your test run names with these placeholders:

| Placeholder | Description | Example |
| ------------- | ------------- | --------- |
| `{suite}` | Root `describe` title of the first reported test | `Login Tests` |
| `{spec}` | Spec file name (without extension) of the first reported test | `login` |
| `{date}` | Current date in ISO format | `2024-01-15` |
| `{time}` | Current time | `14:30:00` |
| `{browser}` | Playwright project name | `chromium` |
| `{platform}` | Platform/OS name | `darwin`, `linux`, `win32` |

The default run name is `'{suite} - {date} {time}'`.

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      // Default: '{suite} - {date} {time}'
      // Custom example:
      runName: 'E2E Tests - {browser} - {date} {time}',
    }],
  ],
});
```

## Appending to Existing Test Runs

Add results to an existing test run instead of creating a new one:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      testRunId: 456,  // Add results to this existing run (ID or name)
    }],
  ],
});
```

This is useful for:
- Aggregating results from multiple CI jobs
- Running tests in parallel across machines
- Re-running failed tests without creating new runs

## Associating with Configurations and Milestones

Track test results against specific configurations (browser/OS combinations) and milestones:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      configId: 5,      // e.g., "Chromium / macOS"
      milestoneId: 10,  // e.g., "Sprint 15"
      stateId: 2,       // e.g., "In Progress" workflow state
      tagIds: ['regression', 'automated'],
    }],
  ],
});
```
