---
"@testplanit/api": patch
"@testplanit/mcp-server": patch
"@testplanit/playwright-reporter": patch
"@testplanit/wdio-reporter": patch
---

Correct the README examples and option tables

Documentation only; no code changes.

- **api**: `completeTestRun` examples pass the project ID, `findOrCreateTestCase`
  returns `{ testCase, action }`, and `listTestRuns` is noted as returning
  completed runs only.
- **mcp-server**: the `whoami` tool is listed under its real name,
  `testplanit_issues_resolve` is documented, and `TESTPLANIT_API_URL` is shown
  as optional with its default.
- **playwright-reporter**: the `caseIdAnnotation` option is documented, and
  `caseIdPattern` is described as applying to titles and tags.
- **wdio-reporter**: WebdriverIO 10 and Node.js 20 are listed as supported, and
  `captureSteps` / `overwriteSteps` describe AI-derived steps for Mocha and
  Jasmine.
- API tokens are created from your Profile under API Tokens, with the
  **Create Token** button.
