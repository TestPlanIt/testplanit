---
"@testplanit/mcp-server": patch
---

`testplanit_test_run_results_create` now accepts an optional `fieldValues: [{ name, value }]` input to record custom Result Field entries alongside the result. Resolution is by display name (case-insensitive) or system name, scoped to the case's template; unknown names are rejected with the available field list in the error message. This unblocks result submission against templates that mark any Result Field required — previously the server rejected those submissions with `REQUIRED_FIELDS_MISSING` because the tool surface couldn't construct a valid payload.
