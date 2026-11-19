---
"@testplanit/api": patch
"@testplanit/playwright-reporter": patch
---

Copy Playwright tags onto test cases

- **playwright-reporter**: a test's Playwright tags are copied onto the test
  case the reporter creates for it (`@smoke` becomes a `smoke` tag; tags that
  do not exist yet are created). On by default with `autoCreateTestCases`;
  set `captureTags: false` to turn it off. The new `overwriteTags` option makes
  an existing case's tags match the test's tags on every run, for cases linked
  by ID and cases matched by auto-create. It removes tags added to the case by
  hand, and a test with no tags clears the case's tags. A tag that matches
  `caseIdPattern` links the test to a case and is never copied.
- **api**: `setTestCaseTags(caseId, tagIds, { replace })` adds tags to a case,
  or with `replace` makes the case have exactly those tags.
