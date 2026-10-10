---
"@testplanit/mcp-server": patch
---

`repository_case_links_list` accepts `linkType: "DUPLICATED_FROM"`

The provenance link a within-project copy records (`DUPLICATED_FROM`) was
missing from the tool's `linkType` filter, although unfiltered listings
already returned it. The accepted values are now derived from the schema's
enum, so a new link type cannot be left out again.
