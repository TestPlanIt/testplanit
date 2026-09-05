---
"@testplanit/mcp-server": patch
---

Record a case version whenever `cases_create` or `cases_update` changes a case

Creating or editing a case through this server left no version history: the
case sat at `currentVersion: 1` with no snapshot row, while the same edit made
in the web UI produced a version per save. That is not only an audit gap — a
run result records the case version it executed against and links back to it,
so a case maintained over the API could never be read back as it was when it
ran.

`cases_create` now writes the version 1 snapshot last, once steps, tags and
custom fields are attached, and a failure there rolls the new case back the
same way any other post-create failure does. `cases_update` bumps the case's
version and snapshots it after the edit lands, and skips both when the call
carried no writable field.

Requires a TestPlanIt host that accepts API tokens on
`POST /api/repository/cases/{caseId}/versions`; on an older host the version
call fails and the tool reports it rather than silently leaving no history.
