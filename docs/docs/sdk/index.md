---
sidebar_position: 1
title: SDK & Integrations
id: sdk-overview
---

# SDK & Integrations

TestPlanIt provides official npm packages to integrate with your test automation frameworks and CI/CD pipelines. These packages make it easy to report test results directly to TestPlanIt from your automated tests.

## Available Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@testplanit/api`](./api-client.md) | Official JavaScript/TypeScript API client | [![npm](https://img.shields.io/npm/v/@testplanit/api)](https://www.npmjs.com/package/@testplanit/api) |
| [`@testplanit/wdio-reporter`](./webdriverio-reporter.md) | WebdriverIO reporter | [![npm](https://img.shields.io/npm/v/@testplanit/wdio-reporter)](https://www.npmjs.com/package/@testplanit/wdio-reporter) |

## Architecture

The TestPlanIt SDK packages are designed with a layered architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Frameworks                          │
│  (WebdriverIO, Playwright, Jest, Mocha, Cypress, etc.)     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Framework Reporters                        │
│   @testplanit/wdio-reporter (and future reporters)         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 @testplanit/api                             │
│        Official API Client (core SDK)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 TestPlanIt API                              │
│           (your TestPlanIt instance)                        │
└─────────────────────────────────────────────────────────────┘
```

- **@testplanit/api** - The core API client that handles all communication with TestPlanIt. Use this directly for custom integrations or when a framework-specific reporter isn't available.

- **Framework Reporters** - Built on top of `@testplanit/api`, these reporters automatically capture test results from your test framework and send them to TestPlanIt.

## Quick Start

### Using the API Client Directly

```bash
npm install @testplanit/api
```

```typescript
import { TestPlanItClient } from '@testplanit/api';

const client = new TestPlanItClient({
  baseUrl: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN,
});

// Create a test run
const testRun = await client.createTestRun({
  projectId: 1,
  name: 'CI Build #123',
});

// Report results
const statusId = await client.getStatusId(1, 'passed');
await client.createTestResult({
  testRunId: testRun.id,
  testRunCaseId: 456,
  statusId,
  elapsed: 1500,
});
```

### Using a Framework Reporter

```bash
npm install @testplanit/wdio-reporter
```

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

## Authentication

All SDK packages use API tokens for authentication. To create an API token:

1. Log into your TestPlanIt instance
2. Go to **Settings** > **API Tokens**
3. Click **Generate New Token**
4. Copy the token (starts with `tpi_`)

Store your token securely using environment variables:

```bash
export TESTPLANIT_API_TOKEN=tpi_your_token_here
```

See the [API Tokens documentation](../api-tokens.md) for more details on token management.

## Linking Test Cases

The SDK reporters support linking automated tests to existing test cases in TestPlanIt by embedding case IDs in your test titles. By default, case IDs are matched using brackets like `[1234]`:

```javascript
// WebdriverIO/Mocha example
describe('Authentication', () => {
  it('[12345] should login with valid credentials', async () => {
    // This test will be linked to TestPlanIt case #12345
  });

  it('[12346] [12347] should show error for invalid password', async () => {
    // This test will be linked to cases #12346 and #12347
  });
});
```

The pattern is fully configurable via the `caseIdPattern` option. You can use any regex pattern like `/C(\d+)/g`, `/TC-(\d+)/g`, or even `/^(\d+)\s/g` for plain numbers at the start of test titles.

## CI/CD Integration

The SDK packages are designed for CI/CD pipelines. Here's an example GitHub Actions workflow:

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
        run: npm run test:e2e
```

## Error Handling

All SDK packages include built-in retry logic and consistent error handling:

```typescript
import { TestPlanItClient, TestPlanItError } from '@testplanit/api';

try {
  await client.createTestRun({ projectId: 999, name: 'Test' });
} catch (error) {
  if (error instanceof TestPlanItError) {
    console.error('API Error:', error.message);
    console.error('Status Code:', error.statusCode);
  }
}
```

## Coming Soon

We're working on additional reporters for popular test frameworks:

- Playwright Reporter
- Jest Reporter
- Cypress Plugin
- pytest Plugin

Want to contribute? Check out our [GitHub repository](https://github.com/testplanit/testplanit).

## Further Resources

- [API Reference](../api-reference.md) - Full REST API documentation
- [API Tokens](../api-tokens.md) - Managing programmatic access
- [CLI Tool](../cli.md) - Command-line interface for TestPlanIt
- [JUnit Import](../api-reference.md#junit-import-api) - Importing JUnit XML results
