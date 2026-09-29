---
"@testplanit/mcp-server": patch
---

Place new cases and folders after their siblings

`cases_create` and `folders_create` wrote no order, so every case or folder
created through them got 0 and sorted to the top of its folder, tied with the
first item there. New cases now go after the folder's last case and new
folders after their last sibling, as in the web UI, and a folder moved with
`folders_update` goes after its new siblings.
