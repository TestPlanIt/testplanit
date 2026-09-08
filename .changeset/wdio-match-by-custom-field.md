---
"@testplanit/api": minor
"@testplanit/wdio-reporter": minor
---

Add `matchByCustomField` case resolution to the WebdriverIO reporter — attach automated results to an existing case by a custom field value.

- **`@testplanit/wdio-reporter`**: new opt-in `matchByCustomField: { fieldName, idPattern? }` option. When a test title carries a legacy external identifier (default `idPattern: /^(\d+)/`, a bare leading number) that was backfilled onto migrated cases as a custom field, the reporter resolves the existing case by that field's value and attaches the result **directly** to it — regardless of the case's `source` (e.g. `MANUAL`), creating no new case, folder, or link. It runs before the name-matching / `autoCreateTestCases` fallback and is independent of `caseIdPattern`; on no match, or if the named field does not exist, it falls through to the existing behavior without error. Off by default, so existing configurations are unaffected.
- **`@testplanit/api`**: new `client.findTestCaseByCustomField({ projectId, fieldName, value })` that resolves a case by a custom field value (matched on the field's display name, in both its numeric and string forms) rather than by name/className/source.
