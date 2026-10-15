---
"@testplanit/mcp-server": patch
---

`testplanit_issues_list` and `testplanit_issues_find_by_key` now return every issue the project can reach, not only the ones it imported first. A tracker ticket is one TestPlanIt issue per integration, shared by every project that imported it, resolved it by key, or linked it to a case, run, session, or milestone. Before this change a second project sharing an integration could not see or link a ticket another project had already imported.
