---
"@testplanit/mcp-server": patch
---

`cases_update` can clear a custom field, and clearing rich text works

Passing `null` for a custom field (or `""` for a non-text field) removes the
stored value, as Add Case stores nothing for an empty field; a required field
refuses. Passing `null` for a session mission, a milestone note or a step's
expected result used to fail with a 422; the host now stores the empty
document the web editors store, so a clear succeeds everywhere. Replacing a
case's steps now creates the new steps before retiring the old ones, so a
rejected step leaves the case's steps intact instead of half-replaced.
