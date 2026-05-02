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
import { TestPlanItService } from '@testplanit/wdio-reporter';

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

  services: [
    [TestPlanItService, {
      // Required
      domain: process.env.TESTPLANIT_URL || 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: parseInt(process.env.TESTPLANIT_PROJECT_ID || '1'),

      // Test run configuration
      runName: `E2E Tests - Build #${process.env.BUILD_NUMBER || 'local'} - {date}`,
      configId: 5,        // Chrome configuration
      milestoneId: 10,    // Current sprint

      // Screenshots
      captureScreenshots: true,

      // Debugging
      verbose: process.env.DEBUG === 'true',
    }]
  ],

  reporters: [
    'spec',  // Keep the spec reporter for console output
    ['@testplanit/wdio-reporter', {
      // Required
      domain: process.env.TESTPLANIT_URL || 'https://testplanit.example.com',
      apiToken: process.env.TESTPLANIT_API_TOKEN,
      projectId: parseInt(process.env.TESTPLANIT_PROJECT_ID || '1'),

      // Case ID parsing (default matches [1234] format)
      caseIdPattern: /\[(\d+)\]/g,

      // Auto-create cases (optional)
      autoCreateTestCases: true,
      parentFolderId: 100,
      templateId: 1,

      // Result options
      uploadScreenshots: true,
      includeStackTrace: true,

      // Debugging
      verbose: process.env.DEBUG === 'true',
    }]
  ],
};
```

## TypeScript Support

The package includes full TypeScript definitions:

```typescript
import type {
  TestPlanItReporterOptions,
  TestPlanItServiceOptions,
} from '@testplanit/wdio-reporter';

const serviceOptions: TestPlanItServiceOptions = {
  domain: 'https://testplanit.example.com',
  apiToken: process.env.TESTPLANIT_API_TOKEN!,
  projectId: 1,
  runName: 'TypeScript Tests - {date}',
  captureScreenshots: true,
};

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

| WebdriverIO Version | Supported |
| -------------------- | ----------- |
| 9.x | Yes |
| 8.x | Yes |

Requires Node.js 24 or later.

## Related Resources

- [API Client](./api-client.md) - Direct API access for custom integrations
- [SDK Overview](./index.md) - Architecture and package overview
- [API Tokens](../api-tokens.md) - Creating and managing API tokens
