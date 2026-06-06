---
slug: playwright-reporter
title: "Announcing the Playwright Reporter for TestPlanIt"
description: "Automatically send your Playwright test results to TestPlanIt with our new official reporter package."
authors: [testplanit]
tags: [announcement, integration]
image: /img/blog/playwright-reporter.png
---

<figure>
  <img src="/img/blog/playwright-reporter.png" alt="The TestPlanIt Playwright Reporter — an official reporter that sends Playwright test results straight to TestPlanIt, installed with npm i -D @testplanit/playwright-reporter." />
  <figcaption>@testplanit/playwright-reporter — report your Playwright results straight to TestPlanIt.</figcaption>
</figure>

We're excited to announce `@testplanit/playwright-reporter`, an official [Playwright](https://playwright.dev/) reporter that automatically sends your test results to TestPlanIt in real-time.

<!-- truncate -->

## Why a Playwright Reporter?

Playwright is one of the fastest-growing browser automation frameworks, and it's the engine behind countless teams' E2E suites. Until now, getting Playwright results into TestPlanIt meant exporting JUnit XML and importing it via the CLI. That works, but it adds steps and loses context.

The new reporter pushes results directly to TestPlanIt as your tests run — and because Playwright runs reporters in a single main process, there's nothing extra to wire up. One reporter sees every worker, project, and spec, and reports them all to a single test run. No launcher service, no worker-coordination flags.

## Key Features

### Real-Time Reporting

Results are sent to TestPlanIt as each test completes. You can watch your test run populate live.

### Link Tests to Test Cases

Embed case IDs directly in your test titles to link automated tests to TestPlanIt test cases:

```typescript
import { test, expect } from '@playwright/test';

test.describe('User Authentication', () => {
  test('[12345] should login with valid credentials', async ({ page }) => {
    // Links to TestPlanIt case #12345
    await page.goto('/login');
    // ...
  });
});
```

### Auto-Create Test Cases

Don't want to create test cases manually first? Enable `autoCreateTestCases` and the reporter will create them for you:

```typescript
['@testplanit/playwright-reporter', {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: 1,
  autoCreateTestCases: true,
  parentFolderId: 'Automated Tests',
  templateId: 'Default Template',
}]
```

On first run, test cases are created automatically. On subsequent runs, results link to the existing cases.

### Attachment Uploads

Playwright already captures rich evidence — screenshots, videos, and traces. The reporter uploads all of it to the matching result, including anything you add with `testInfo.attach()`:

```typescript
// playwright.config.ts
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
  trace: 'on-first-retry',
},
```

Want to keep uploads lean? Filter with `attachmentTypes: ['image/']` to upload screenshots only.

### Folder Hierarchy from Describe Blocks

With `createFolderHierarchy`, your nested `test.describe` blocks become folders in TestPlanIt:

```typescript
test.describe('Authentication', () => {
  test.describe('Login', () => {
    test('should login successfully', async ({ page }) => {
      // Creates: Authentication > Login > "should login successfully"
    });
  });
});
```

### Full Retry History

Playwright reports each retry attempt, and so does the reporter — a flaky test that fails then passes records both results against the same case, so you keep the full attempt history.

## Quick Start

Install the package:

```bash
npm install --save-dev @testplanit/playwright-reporter
```

Add it to your Playwright config alongside your existing reporters:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@testplanit/playwright-reporter', {
      domain: 'https://your-instance.testplanit.com',
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

After completion, you'll see a summary:

```text
[TestPlanIt] Results Summary
[TestPlanIt] ═══════════════════════════════════════════════════════════
[TestPlanIt]   Test Run ID: 123
[TestPlanIt]   Duration: 45.2s
[TestPlanIt]
[TestPlanIt]   Test Results:
[TestPlanIt]     ✓ Passed:  15
[TestPlanIt]     ✗ Failed:  2
[TestPlanIt]     ○ Skipped: 1
[TestPlanIt]
[TestPlanIt]   View results: https://your-instance.testplanit.com/projects/runs/1/123
[TestPlanIt] ═══════════════════════════════════════════════════════════
```

## CI/CD Ready

The reporter works seamlessly in CI/CD pipelines:

**GitHub Actions:**

```yaml
- name: Run E2E tests
  env:
    TESTPLANIT_API_TOKEN: ${{ secrets.TESTPLANIT_API_TOKEN }}
  run: npx playwright test
```

Include build information in your run names:

```typescript
runName: `Build #${process.env.GITHUB_RUN_NUMBER} - {browser} - {date}`,
```

## Documentation

For complete configuration options, examples, and advanced features like custom case ID patterns, attachment filtering, and milestone/configuration associations, see the [Playwright Reporter documentation](/docs/sdk/playwright-overview).

## Get Started

The `@testplanit/playwright-reporter` package is available on npm:

```bash
npm install --save-dev @testplanit/playwright-reporter
```

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Happy testing!
