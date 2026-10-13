---
"@testplanit/mcp-server": patch
---

Link issues to test cases with `issues_link`, `issues_unlink` and `issues_list_links`

Test cases reach issues through a join model, but these tools addressed a
direct relation that does not exist, so linking or unlinking a test case was
rejected and listing the cases linked to an issue (or the issues linked to a
case) failed. Case links are now created and removed through the join model,
the same way the web UI does it, and a repeated link is a no-op.

Delete operations now send their filter where the host reads it. None of the
existing tools used one, but a filter sent the old way would have been ignored
and the delete applied to every row the caller could reach; a delete with no
filter is now refused outright.
