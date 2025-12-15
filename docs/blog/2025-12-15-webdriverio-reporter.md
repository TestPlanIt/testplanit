---
slug: webdriverio-reporter
title: "Announcing the WebdriverIO Reporter for TestPlanIt"
description: "Automatically send your WebdriverIO test results to TestPlanIt with our new official reporter package."
authors: [testplanit]
tags: [announcement, integration]
---

We're excited to announce `@testplanit/wdio-reporter`, an official WebdriverIO reporter that automatically sends your test results to TestPlanIt in real-time.

<!-- truncate -->

## Why a WebdriverIO Reporter?

[WebdriverIO](https://webdriver.io/) is one of the most popular browser automation frameworks, powering E2E tests for countless teams. Until now, getting your WebdriverIO results into TestPlanIt required exporting to JUnit XML and importing via the CLI. While that works, it adds extra steps and loses some context.

The new reporter eliminates that friction by pushing results directly to TestPlanIt as your tests run.

## Key Features

### Real-Time Reporting

Results are sent to TestPlanIt as each test completes, not just at the end of the run. You can watch your test run populate in real-time.

### Link Tests to Test Cases

Embed case IDs directly in your test titles to link automated tests to TestPlanIt test cases:

```javascript
describe('User Authentication', () => {
  it('[12345] should login with valid credentials', async () => {
    // Links to TestPlanIt case #12345
    await LoginPage.login('user@example.com', 'password');
  });
});
```

### Auto-Create Test Cases

Don't want to manually create test cases first? Enable `autoCreateTestCases` and the reporter will create them for you:

```javascript
['@testplanit/wdio-reporter', {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
  projectId: 1,
  autoCreateTestCases: true,
  parentFolderId: 10,
  templateId: 1,
}]
```

On first run, test cases are created automatically. On subsequent runs, results link to the existing cases.

### Screenshot Uploads

Failed tests often need screenshots for debugging. Configure WebdriverIO to capture screenshots on failure, and the reporter automatically uploads them as attachments:

```javascript
afterTest: async function(test, context, { passed }) {
  if (!passed) {
    await browser.takeScreenshot();
  }
},
```

### Folder Hierarchy from Suites

When using `createFolderHierarchy`, your nested describe blocks become folders in TestPlanIt:

```javascript
describe('Authentication', () => {
  describe('Login', () => {
    it('should login successfully', async () => {
      // Creates: Authentication > Login > "should login successfully"
    });
  });
});
```

## Quick Start

Install the package:

```bash
npm install @testplanit/wdio-reporter @testplanit/api
```

Add it to your WebdriverIO config:

```javascript
// wdio.conf.js
export const config = {
  reporters: [
    ['@testplanit/wdio-reporter', {
      domain: 'https://your-instance.testplanit.com',
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
  run: npx wdio run wdio.conf.js
```

Include build information in your run names:

```javascript
runName: `Build #${process.env.GITHUB_RUN_NUMBER} - {browser} - {date}`,
```

## Documentation

For complete configuration options, examples, and advanced features like custom case ID patterns, milestone/configuration associations, and retry handling, see the [WebdriverIO Reporter documentation](/docs/sdk/webdriverio-reporter).

## Get Started

The `@testplanit/wdio-reporter` package is available on npm:

```bash
npm install @testplanit/wdio-reporter @testplanit/api
```

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Happy testing!
