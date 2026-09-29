---
"@testplanit/mcp-server": minor
---

Return rich text as Markdown so it survives a read, edit and write back

Rich-text fields were flattened to plain text on read: case steps and
expected results, `Text Long` custom fields, session missions and notes,
milestone notes and docs, issue notes, result notes and review notes. An
agent that read a case with `cases_get`, changed one step and sent the steps
back with `cases_update` erased every step's bold, lists, links and code, and
multi-line text came back joined. These values are now returned as Markdown
(paragraphs separated by a blank line, a line break as a newline), which the
host converts back into the same document on write.
