---
"@testplanit/mcp-server": patch
---

Convert Markdown in step text written by `cases_create` and `cases_update`

Steps were wrapped in a single plain paragraph before they reached the host,
so `Open the **New leads** board` was stored with the asterisks in it and the
editor showed them literally. Step text and expected results are now sent as
written, and the host converts Markdown, HTML or plain text into a rich-text
document the same way the bulk-create route and CSV import do.

`Text Long` custom field values are converted by the host as well, on a host
that includes the matching fix; an older host stores them as written.
