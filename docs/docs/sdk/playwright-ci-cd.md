---
title: CI/CD & Advanced Usage
---

# CI/CD & Advanced Usage

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

      - name: Install Playwright browsers
        run: npx playwright install --with-deps

      - name: Run E2E tests
        env:
          TESTPLANIT_API_TOKEN: ${{ secrets.TESTPLANIT_API_TOKEN }}
        run: npx playwright test
```

### GitLab CI

```yaml
e2e-tests:
  image: mcr.microsoft.com/playwright:v1.60.0-noble
  script:
    - npm ci
    - npx playwright test
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
                sh 'npx playwright install --with-deps'
                sh 'npx playwright test'
            }
        }
    }
}
```

### Dynamic Run Names with Build Info

Include CI build information in your test run names:

```typescript
// playwright.config.ts
const buildNumber = process.env.GITHUB_RUN_NUMBER
  || process.env.CI_PIPELINE_ID
  || process.env.BUILD_NUMBER
  || 'local';

const branch = process.env.GITHUB_REF_NAME
  || process.env.CI_COMMIT_REF_NAME
  || process.env.GIT_BRANCH
  || 'unknown';

export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      runName: `Build #${buildNumber} - ${branch} - {browser}`,
    }],
  ],
});
```

## Handling Test Retries

Playwright calls the reporter once per retry attempt, and **each attempt is reported as its own result**. A test that fails and then passes on retry produces both a `FAILURE` and a `PASSED` result against the same case, giving you the full attempt history. The case is added to the run only once.

```typescript
// playwright.config.ts
export default defineConfig({
  retries: 2, // Each attempt is reported
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
    }],
  ],
});
```

## Debugging

Enable verbose logging to troubleshoot issues:

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@testplanit/playwright-reporter', {
      domain: 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: 1,
      verbose: true,  // Enables detailed logging
    }],
  ],
});
```

You'll see detailed output:

```text
[TestPlanIt] Initializing reporter...
[TestPlanIt] Status mapping: passed -> 1
[TestPlanIt] Status mapping: failed -> 2
[TestPlanIt] Status mapping: skipped -> 3
[TestPlanIt] Creating test run: E2E Tests - 2024-01-15 14:30:00 (chromium) (type: JUNIT)
[TestPlanIt] Created test run with ID: 123
[TestPlanIt] Created JUnit test suite with ID: 456
[TestPlanIt] Added case to run: 789
[TestPlanIt] Created JUnit test result: 1011 (type: PASSED)
[TestPlanIt] Uploaded attachment login_failed_screenshot.png for login
```

## Complete Example

Here's a complete configuration with all features:

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: process.env.CI ? 2 : 0,

  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },

  reporter: [
    ['list'], // Keep a console reporter for local output
    ['@testplanit/playwright-reporter', {
      // Required
      domain: process.env.TESTPLANIT_URL || 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: Number(process.env.TESTPLANIT_PROJECT_ID || '1'),

      // Test run configuration
      runName: `E2E Tests - Build #${process.env.BUILD_NUMBER || 'local'} - {browser} - {date}`,
      configId: 5,        // Chromium configuration
      milestoneId: 10,    // Current sprint

      // Case ID parsing (default matches [1234] format)
      caseIdPattern: /\[(\d+)\]/g,

      // Auto-create cases (optional)
      autoCreateTestCases: true,
      createFolderHierarchy: true,
      parentFolderId: 'Automated Tests',
      templateId: 'Default Template',

      // Attachments
      uploadAttachments: true,
      attachmentTypes: ['image/', 'video/'],
      includeStackTrace: true,

      // Debugging
      verbose: process.env.DEBUG === 'true',
    }],
  ],

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

## TypeScript Support

The package includes full TypeScript definitions:

```typescript
import type { TestPlanItReporterOptions } from '@testplanit/playwright-reporter';

const reporterOptions: TestPlanItReporterOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
  autoCreateTestCases: true,
  parentFolderId: 10,
  templateId: 1,
};
```

## Compatibility

| Playwright Version | Supported |
| ------------------ | --------- |
| 1.44+ | Yes |

Requires `@playwright/test` 1.44 or later (the reporter uses the `Suite.type` API) and Node.js 20 or later.

## Related Resources

- [API Client](./api-client.md) - Direct API access for custom integrations
- [SDK Overview](./index.md) - Architecture and package overview
- [API Tokens](../api-tokens.md) - Creating and managing API tokens
