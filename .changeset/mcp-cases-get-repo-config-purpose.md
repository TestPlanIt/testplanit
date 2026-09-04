---
"@testplanit/mcp-server": patch
---

`cases_get` reads the project's QuickScript repository through the new
`codeRepositoryConfigs` relation (a project can now bind one repository per
purpose), so the inline `codeRepository` block keeps resolving after the
server upgrade.
