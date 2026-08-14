---
sidebar_label: 'Playwright Reporter'
title: Playwright Reporter (@testplanit/playwright-reporter)
---

# Playwright Reporter

`@testplanit/playwright-reporter` is an official [Playwright](https://playwright.dev/) reporter that automatically sends test results to your TestPlanIt instance. It supports linking tests to existing test cases, automatic test case creation, capturing `test.step()` calls as case steps, attachment uploads (screenshots, videos, traces), run-level attachments and metadata, and more.

Every attempt is reported individually — including retries, so fail-then-pass sequences surface as flaky in TestPlanIt — along with the Playwright worker lane it ran on, which powers the run's execution timeline and parallelization metrics.

It's the Playwright counterpart to the [WebdriverIO Reporter](./wdio-overview.md). Because Playwright runs reporters in a single main process — and forwards events from every worker to it — there is **no separate launcher service** to configure and no worker-coordination option. One reporter instance sees every result and reports it to a single test run.

## Installation

```bash
npm install --save-dev @testplanit/playwright-reporter
# or
pnpm add -D @testplanit/playwright-reporter
# or
yarn add -D @testplanit/playwright-reporter
```

## Quick Start

Add the reporter to your Playwright configuration. Playwright supports multiple reporters at once, so you can keep `list`, `html`, or `junit` alongside it:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
    }],
  ],
});
```

Run your tests:

```bash
npx playwright test
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
[TestPlanIt]     Steps created:    18
```

Steps captured from `test.step()` calls are counted here — see [Capturing test.step() as case steps](./playwright-test-cases.md#capturing-teststep-as-case-steps).

Attachment upload stats appear when attachments are uploaded:

```text
[TestPlanIt]   Attachments:
[TestPlanIt]     Uploaded: 2
```

## How It Differs From the WebdriverIO Reporter

The two reporters share the same option surface and behavior, with a few Playwright-specific differences:

| Aspect | Playwright Reporter | WebdriverIO Reporter |
| ------ | ------------------- | -------------------- |
| Process model | Single main process sees all workers | One reporter per worker process |
| Launcher service | Not needed — folded into the reporter | Separate `TestPlanItService` for one run across specs |
| Worker coordination | None (`oneReport` doesn't exist) | `oneReport` + file-based state |
| Attachments | All Playwright attachments (`uploadAttachments` + `attachmentTypes`) | Intercepted screenshots (`uploadScreenshots`) |
| Default `testRunType` | `JUNIT` | Auto-detected (`MOCHA` / `CUCUMBER` / `REGULAR`) |

Because there's a single reporter instance and a single test run by default, no extra setup is required to consolidate results — every spec, project, and worker lands in the same run.

## Next Steps

- [Configuration Options](./playwright-configuration.md) — Full reference for reporter options
- [Linking & Auto-Creating Test Cases](./playwright-test-cases.md) — Case ID patterns and auto-creation
- [Attachment Uploads](./playwright-attachments.md) — Screenshots, videos, traces, and filtering
- [Run Attachments & Metadata](./playwright-run-attachments.md) — Attach CI links, files, and metadata to the run itself
- [CI/CD & Advanced Usage](./playwright-ci-cd.md) — CI integration, retries, debugging, complete examples
