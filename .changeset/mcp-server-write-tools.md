---
"@testplanit/mcp-server": minor
---

Add write tools for the runs, sessions, and milestones domains (Phase 9):

- `testplanit_runs_create` — create a test run with optional initial case list
- `testplanit_runs_update` — update name, state, milestone, tags, and completion status
- `testplanit_runs_cases_add` — add cases to an existing run
- `testplanit_test_run_results_create` — submit a pass/fail/blocked result for a run case
- `testplanit_sessions_create` — create an exploratory test session
- `testplanit_sessions_update` — update session name, mission, state, milestone, and tags
- `testplanit_milestones_create` — create a milestone with optional parent nesting
- `testplanit_milestones_update` — update milestone name, type, note, parent, and completion status
