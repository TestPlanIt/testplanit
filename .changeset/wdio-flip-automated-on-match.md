---
"@testplanit/api": minor
"@testplanit/mcp-server": minor
"@testplanit/wdio-reporter": patch
---

Mark a case as automated once it starts receiving automated results.

- **`@testplanit/api`**: new `client.updateTestCase(caseId, { automated? })` — a minimal, forward-compatible partial update (only the fields you pass are written, so more can be added later without a breaking change). `findOrCreateTestCase` now also flips an existing **found** case to `automated: true` when the caller wants an automated case (the default) and the case isn't already automated; the write is skipped when it already is.
- **`@testplanit/wdio-reporter`**: when `matchByCustomField` attaches a result to an existing case (typically a migrated `MANUAL` case), the reporter now flips that case to `automated: true` if it isn't already — so a case that started manual but now runs under automation stops showing as "not automated". The write is skipped when the case is already automated (no redundant call per run) and, like the rest of the `matchByCustomField` path, a failure here never aborts result reporting.
- **`@testplanit/mcp-server`**: `testplanit_cases_update` accepts an `automated` boolean, for one-off cleanup of cases that should be flagged automated.
