---
title: Launcher Service
---

# Launcher Service

If you run multiple spec files and want all of them to report to a **single test run**, use the `TestPlanItService` launcher service. It creates the test run once before any workers start and completes it after all workers finish — regardless of `maxInstances` or how many batches your specs run in.

:::info Why not `oneReport`?
The `oneReport` option only combines parallel workers that overlap in execution time (e.g., workers from the same spec file). When you have more spec files than `maxInstances`, workers run in batches — once the first batch finishes, `oneReport` completes the run before the next batch starts. The launcher service solves this by managing the run lifecycle in the main process, outside of any worker.
:::

## Setup

Add `TestPlanItService` to the `services` array alongside the reporter in `reporters`:

```javascript
// wdio.conf.js
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  services: [
    [TestPlanItService, {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date}',
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      // Reporter-specific options (case linking, screenshots, etc.)
      autoCreateTestCases: true,
      parentFolderId: 10,
      templateId: 1,
      // Do NOT set runName or testRunId here — the service handles it
    }]
  ],
};
```

The service creates the test run and writes a shared state file. Each reporter worker detects this file on startup and reports results to the pre-created run instead of creating its own.

## Service Configuration Options

The service requires the same `domain`, `apiToken`, and `projectId` as the reporter. Additional options:

| Option | Type | Default | Description |
| -------- | ------ | --------- | ------------- |
| `runName` | `string` | `'Automated Tests - {date} {time}'` | Name for the test run. Supports `{date}`, `{time}`, and `{platform}` placeholders |
| `testRunType` | `string` | `'MOCHA'` | Test framework type (`REGULAR`, `JUNIT`, `MOCHA`, `CUCUMBER`, etc.) |
| `configId` | `number \| string` | - | Configuration for the test run (ID or name) |
| `milestoneId` | `number \| string` | - | Milestone for the test run (ID or name) |
| `stateId` | `number \| string` | - | Workflow state for the test run (ID or name) |
| `tagIds` | `(number \| string)[]` | - | Tags to apply to the test run (IDs or names) |
| `completeRunOnFinish` | `boolean` | `true` | Mark run as completed when all workers finish |
| `captureScreenshots` | `boolean` | `false` | Automatically capture a screenshot when a test fails (uploaded by the reporter — see [Screenshot Uploads](./wdio-screenshots.md)) |
| `runLinks` | `RunLinkInput[]` | - | Links to attach to the run, e.g. a CI build URL (see [Run Attachments & Metadata](./wdio-run-attachments.md)) |
| `runAttachments` | `RunAttachmentInput[]` | - | Files to attach to the run — logs, reports, videos (see [Run Attachments & Metadata](./wdio-run-attachments.md)) |
| `runMetadata` | `Record<string, string \| number \| boolean>` | - | Key/value metadata rendered into the run's documentation (see [Run Attachments & Metadata](./wdio-run-attachments.md)) |
| `timeout` | `number` | `30000` | API request timeout in ms |
| `maxRetries` | `number` | `3` | Retry attempts for failed requests |
| `verbose` | `boolean` | `false` | Enable debug logging |

:::note
The `{browser}`, `{spec}`, and `{suite}` placeholders are **not available** in the service context because the service runs before any workers start. Use `{date}`, `{time}`, and `{platform}` instead.
:::

## How It Works

1. **`onPrepare`** (before workers): The service creates a test run and JUnit test suite via the API, then writes a shared state file to the system temp directory.
2. **Workers run**: Each reporter worker reads the shared state file, finds the pre-created test run ID, and reports results to it. Workers skip creating or completing their own runs.
3. **`onComplete`** (after all workers): The service completes the test run (if `completeRunOnFinish` is `true`) and deletes the shared state file.

If the service fails during `onPrepare`, the error is thrown and the WDIO session is aborted. If it fails during `onComplete`, the error is logged but does not affect the test exit code.

## What the Service Overrides

When both the service and reporter are used, the service takes over the test run lifecycle. See [Choosing Your Setup](./wdio-overview.md#choosing-your-setup) for the full breakdown of which reporter options are ignored vs. still apply.
