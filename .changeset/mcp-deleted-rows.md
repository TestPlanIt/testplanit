---
"@testplanit/mcp-server": patch
---

Stop returning trashed sessions and counting removed rows

`sessions_get` and `session_results_get` returned sessions and results that
were in the Trash, and `session_results_list` listed the results of trashed
sessions. Those now read as not found, or are left out. Milestone status
counts in `milestones_list` and `milestones_get` counted cases removed from
their runs, and `commentCount` counted deleted comments; both now count only
live rows.
