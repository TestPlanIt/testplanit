---
"@testplanit/mcp-server": patch
---

Return plain text for rich-text fields no matter which client saved the record

The web UI stores rich text as a JSON string while this server stores the
document object, so `cases_get` returned step text as plain text right after
an MCP write but as a raw Tiptap JSON string once the case had been saved from
the UI. Reading a serialized document now yields the same plain text either
way, so an agent no longer has to detect and parse both shapes. This applies
everywhere rich text is read — case steps and expected results, `Text Long`
custom fields, session missions and notes, milestone notes and docs, issue
notes, run and result notes, and review comments.

A string that is not a serialized document still passes through untouched, so
plain-text values that merely look like JSON are never flattened.
