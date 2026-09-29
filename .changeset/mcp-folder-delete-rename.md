---
"@testplanit/mcp-server": patch
---

Rename a folder aside when `folders_delete` deletes it

The web UI appends `_deleted_<timestamp>` to a folder's name when it deletes
it, because folder names are unique among siblings together with the deleted
flag. `folders_delete` only set the flag, so deleting a folder, creating a new
one with the same name and deleting that too failed on the unique index.
It now renames the folder the same way.
