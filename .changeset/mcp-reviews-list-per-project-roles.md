---
"@testplanit/mcp-server": patch
---

`reviews_list` scopes role assignments per project

Requests assigned to a role were matched against every role the caller held
in any project, so the list showed rows the caller could not decide and
missed rows a group-provisioned role entitled them to. The tool now reads
the caller's assignee scope from the server, which resolves the role they
hold in each project and the entity types that role may approve — the same
rule the decide route applies. The web app's inbox and badges use the same
scope.
