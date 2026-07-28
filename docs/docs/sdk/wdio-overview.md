---
sidebar_label: 'WebdriverIO Reporter'
title: WebdriverIO Reporter (@testplanit/wdio-reporter)
---

# WebdriverIO Reporter

`@testplanit/wdio-reporter` is an official WebdriverIO reporter that automatically sends test results to your TestPlanIt instance. It supports linking tests to existing test cases, automatic test case creation, screenshot uploads, run-level attachments and metadata, and more.

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

## Choosing Your Setup

This package provides two components: a **reporter** and a **launcher service**. Use them together or separately depending on your needs.

### Reporter Only

The simplest setup. Each worker creates its own test run, reports results, and completes the run when it finishes. Parallel workers running the same spec file are combined via the `oneReport` option.

**Best for:** Single spec files, small test suites, or setups where one run per spec file is acceptable.

```javascript
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

### Service + Reporter (recommended for multi-spec)

The service creates a single test run before any workers start and completes it after all workers finish. Each reporter worker detects the pre-created run and reports results to it. This guarantees all spec files — across all batches — land in one test run.

**Best for:** Multiple spec files, CI pipelines, any setup where you want a single consolidated test run for your entire test suite.

```javascript
import { TestPlanItService } from '@testplanit/wdio-reporter';

export const config = {
  services: [
    [TestPlanItService, {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: 'E2E Tests - {date}',
      captureScreenshots: true,
    }]
  ],
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      autoCreateTestCases: true,
      parentFolderId: 10,
      templateId: 1,
    }]
  ],
};
```

### What the service overrides

When both are used, the service takes over the test run lifecycle. The following reporter options are **ignored** because the service handles them:

| Reporter option | Ignored because |
| ----------------- | ----------------- |
| `runName` | Service creates the run with its own `runName` |
| `testRunId` | Service provides the test run ID automatically |
| `oneReport` | Not needed — the service already ensures a single run |
| `completeRunOnFinish` | Service controls when the run is completed |
| `configId`, `milestoneId`, `stateId`, `tagIds` | Set these on the service instead |
| `testRunType` | Set on the service instead |

The following reporter options **still apply** when using the service:

| Reporter option | Purpose |
| ----------------- | --------- |
| `autoCreateTestCases` | Find or create test cases by name |
| `parentFolderId`, `templateId` | Control where and how test cases are created |
| `createFolderHierarchy` | Mirror suite structure as folders |
| `caseIdPattern` | Parse case IDs from test titles |
| `uploadScreenshots` | Upload intercepted screenshots |
| `includeStackTrace` | Include stack traces for failures |
| `excludeSkipped` | Don't report skipped tests |
| `timeout`, `maxRetries`, `verbose` | API and logging behavior per worker |

:::tip
When using the service, set run-level options (`runName`, `configId`, `milestoneId`, etc.) on the **service** and test-level options (`autoCreateTestCases`, `caseIdPattern`, `uploadScreenshots`, etc.) on the **reporter**.
:::

## Next Steps

- [Configuration Options](./wdio-configuration.md) — Full reference for reporter options
- [Linking & Auto-Creating Test Cases](./wdio-test-cases.md) — Case ID patterns and auto-creation
- [Launcher Service](./wdio-launcher-service.md) — Single test run across all spec files
- [Run Attachments & Metadata](./wdio-run-attachments.md) — Attach CI links, files, and metadata to the run itself
- [Screenshot Uploads](./wdio-screenshots.md) — Capturing and uploading screenshots
- [CI/CD & Advanced Usage](./wdio-ci-cd.md) — CI integration, retries, debugging, complete examples
