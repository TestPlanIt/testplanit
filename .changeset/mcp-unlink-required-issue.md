---
"@testplanit/mcp-server": patch
---

Keep the issue a failed result requires when unlinking

`issues_unlink` could remove the last issue from a failed result in a project
that requires an issue on failure, which the web UI refuses. Unlinking from a
result or step result now fails with ISSUE_REQUIRED_ON_FAILURE when it would
leave such a result with no issue, counting issues on its steps too.
