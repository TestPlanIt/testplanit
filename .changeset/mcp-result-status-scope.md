---
"@testplanit/mcp-server": patch
---

Record results like the web UI's result dialog

`test_run_results_create` accepted any status enabled for the project,
including automation-only ones the web UI never offers for a manual result;
it now accepts only test-run statuses. It also moves the run to its In
Progress state with the first result, as the web UI does, so runs worked
only through the MCP server no longer stay in their initial state. A new
`issueIds` input links issues to the result, which a project that requires an
issue on failure needs before it accepts a failed result.
