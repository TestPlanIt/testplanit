---
"@testplanit/mcp-server": patch
---

Record session version history from `sessions_create` and `sessions_update`

The web UI writes a version snapshot when a session is created, edited or
completed; sessions written through the MCP server had no history. On a
host that includes the matching versions route, `sessions_create` now
records version 1 and `sessions_update` records the next version, reported
as `version` in the result. On an older host the session is still written
and `version` says why no snapshot was taken.
