---
"@testplanit/mcp-server": patch
---

Keep the host's error code in tool errors

A host error with a code the MCP server has no friendly message for lost the
code, so a completion refused for lack of permission read only "HTTP 403".
The code is now kept in the text, e.g. `(HTTP 403, COMPLETE_NOT_PERMITTED)`.
