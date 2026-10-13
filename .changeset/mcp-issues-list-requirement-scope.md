---
"@testplanit/mcp-server": patch
---

`testplanit_issues_list` used to return every issue row in a project, with no distinction between rows tracked as defects and rows tracked as requirements. TestPlanIt can now classify an issue as a requirement — a different kind of row from a defect, used to express what a project needs rather than what is broken. `testplanit_issues_list` now returns only non-requirement issues by default, matching the defect-focused view most agents expect. Pass `includeRequirements: true` to widen the result back to both kinds. Single-issue lookups by id or key are unaffected — an agent that fetched a specific issue before still gets it, requirement or not.
