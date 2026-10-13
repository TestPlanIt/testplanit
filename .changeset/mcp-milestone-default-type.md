---
"@testplanit/mcp-server": patch
---

Offer the Default milestone type, and make it the default for `milestones_create`

`milestone_types_list` listed only the types assigned to the project, but the
type marked Default is available to every project and is the one the web UI
preselects, so an agent could miss the most common choice.
It is now included, and `milestones_create` uses it when `milestoneTypeId` is
omitted. `milestones_create` also works again on a host with the matching
fix, which fills in the creator the tool never sent.
