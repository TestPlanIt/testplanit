---
"@testplanit/mcp-server": patch
---

Use the template marked Default when `cases_create` omits `templateId`

With no `templateId`, `cases_create` picked the project's enabled template with
the lowest id, so a project whose admin had marked a different template as
Default got cases on the wrong template, and custom fields that exist only on
the Default template were rejected. The tool now prefers the Default template
when it is assigned to the project and falls back to the lowest id otherwise,
the same choice the web UI makes. `cases_create_many` gets the same behaviour
from the host's bulk-create route on a host that includes the matching fix.
