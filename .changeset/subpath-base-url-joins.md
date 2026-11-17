---
"@testplanit/api": patch
"@testplanit/mcp-server": patch
---

Join API paths onto the configured base URL as strings, so an instance served under a path prefix (for example `https://example.com/testplanit`) is reached when its full URL is given as the base URL. Previously the prefix was dropped from every request.
