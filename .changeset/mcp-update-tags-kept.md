---
"@testplanit/mcp-server": patch
---

Keep the tags `cases_update` sets

`cases_update` with `tags` cleared the existing links and created the new
ones in one nested write, and the host ran the create first, so the call
removed every tag and the version it recorded had none. The update now
removes only the links that are no longer wanted and adds only the missing
ones, so the case ends up with exactly the requested tags.
