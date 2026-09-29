---
"@testplanit/mcp-server": patch
---

Move a run or session to its Done state when `runs_update` or `sessions_update` completes it

Completing a run or session with `isCompleted: true` only set the completed
flag, so it showed as completed while its workflow state still read "In
Progress". Without a `stateName`, completion now moves it to the project's
first Done state, as the web UI's Complete dialog does. A state named in the
same call is kept.
