---
"@testplanit/mcp-server": patch
"@testplanit/api": patch
---

Default to the workflow state marked Default when none is named

Creating a case, run or session without a state name picked the enabled
state with the lowest order, so an admin's Default state was ignored and new
items landed in a different state than the web UI puts them in. The MCP
`cases_create`, `cases_create_many`, `runs_create` and `sessions_create`
tools, and `createTestCase` / `createTestCases` in the API client, now prefer
the state marked Default and fall back to the first by order.

The API client's published build also catches up with `getAutomationPlan`
and `finishExecution`, which were in the source but missing from `dist`.
