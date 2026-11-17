---
"@testplanit/mcp-server": patch
"@testplanit/api": patch
---

Cases and sessions created without a `templateId` now use the project's default template when the project sets one, then the template marked Default.
