---
"@testplanit/mcp-server": minor
---

Add execution + session read tools (Phase 7):

- 5 new test-run tools: `testplanit_test_runs_list` (with `statusCounts` inline on every row — D7-06), `testplanit_test_runs_get` (with status rollup), `testplanit_test_runs_cases_list`, `testplanit_test_run_results_list`, `testplanit_test_run_results_get` (with step-level drill-down).
- 5 new session tools: `testplanit_sessions_list`, `testplanit_sessions_get` (up to 100 sessionResults inline + truncated marker), `testplanit_session_results_list`, `testplanit_session_results_get`, `testplanit_sessions_findings_list` (sessionId / issueId modes).
- Extend `testplanit_cases_list` with an additive `issueId` filter — enables the killer-app chain `cases_list({issueId}) → test_run_results_list({caseIds})` in two MCP calls (no aggregate helper needed).
- Total registered tools after Phase 7: 22 (12 from Phase 6 + 10 new).
- Read-only domain — no write paths added; existing `mode:read` token enforcement (Phase 5) covers all new tools without modification.
