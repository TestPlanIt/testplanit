---
"@testplanit/mcp-server": patch
---

Accept the same tag twice in one call

Tag names match case-insensitively, so `["Smoke", "smoke"]`, or a tag's id
together with its name, resolved to the same tag twice; `cases_create` then
failed and rolled the new case back, and `cases_update` errored. Each tag is
now linked once. On a host with the matching fix, new tag names are also
trimmed and cleaned the way the web UI does, so " smoke" joins "Smoke".
