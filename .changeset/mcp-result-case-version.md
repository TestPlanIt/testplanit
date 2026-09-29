---
"@testplanit/mcp-server": patch
---

Record the case's current version on results from `test_run_results_create`

Every result submitted through `test_run_results_create` claimed it ran
against version 1 of the case, whatever version the case was at, so opening an
agent-written result showed the steps of the case's first version. The tool
now records the case's current version at submission, the same value the web
UI sends.
