---
"@testplanit/mcp-server": patch
---

Date filters accept a calendar day

Every `from` / `to` / `updatedAfter` / `updatedBefore` / `automatedResultSince`
/ `noAutomatedResultSince` filter now takes `YYYY-MM-DD` as well as a full
ISO 8601 timestamp. A date-only start bound begins at the start of that UTC
day and a date-only end bound runs through the end of it, the way the web
app's report and audit-log date ranges read a day; previously a bare date
failed validation and a timestamp at midnight excluded the named day.
