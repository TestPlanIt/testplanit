---
"@testplanit/mcp-server": patch
---

`runs_update` no longer reopens a completed run

The web UI has no way to reopen a completed test run. `runs_update` now
refuses `isCompleted: false` with an error instead of clearing the run's
completion. The `cases_update` tool description and the README now note that
shared steps aren't supported: replacing a case's steps removes its shared
step groups.
