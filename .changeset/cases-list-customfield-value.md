---
"@testplanit/mcp-server": patch
---

Honor the `customField` value filter in `cases_list`. Passing `{ name, value }` now filters by value (resolving Dropdown/Multi-Select option names to the stored option ids), unknown keys are rejected by a strict schema, and an unknown field name or invalid option returns a validation error instead of silently returning unfiltered results. Fixes #333.
