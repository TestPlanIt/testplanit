---
"@testplanit/mcp-server": patch
"@testplanit/api": patch
---

Result attempt numbers are assigned by the server

The MCP server counted a run case's live results to number the next
attempt, so a removed result's number was reused; the web UI's quick status
buttons always sent 1 and `@testplanit/api` defaulted to 1. The server now
numbers every new result per run case (and iteration): a missing number, or
one an existing result already carries, becomes the next free one. The MCP
tool no longer sends an attempt and the API client only sends one you give
it.
