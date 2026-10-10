---
"@testplanit/mcp-server": patch
---

`runs_create` and `runs_cases_add` honour the project's Not Started rule

Projects that keep Not Started cases out of runs enforced that only in the
browser; the tools added such cases anyway. The server now leaves them out
of every run write, and both tools report the ones left out as
`skippedNotStartedCaseIds`. Restoring a removed case now also brings it back
untested for every client, and a run case or session assigned through the
API notifies its assignee like an assignment made in the app.
