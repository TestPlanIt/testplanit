---
"@testplanit/mcp-server": patch
"@testplanit/api": patch
---

Result `elapsed` is documented as seconds everywhere (the unit the database, UI, exports and `/api/test-runs/submit-result` use — the MCP tool described it as milliseconds and stored the value unchanged, so 95000 showed as "1 day 2 h"), and plain-text result `notes` are stored as a rich-text document (one paragraph per line) so they render in the Test Result History panel instead of an empty editor. `@testplanit/api`'s `createTestResult` now accepts a plain string for `notes` and wraps it the same way.
