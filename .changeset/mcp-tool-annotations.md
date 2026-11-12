---
"@testplanit/mcp-server": patch
---

Tools describe whether they read or change data

Every tool now carries MCP annotations. List, get and count tools are marked
read-only, so a client can run them without asking. Tools that create records
are marked as additive, and tools that update, remove, unlink, delete or record
a review decision are marked destructive, so a client can ask before running
them. The four tools that reach outside TestPlanIt (issue resolution and
linking by key, script generation, and run execution) are marked open-world.
