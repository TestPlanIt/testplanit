---
"@testplanit/mcp-server": minor
---

Add bulk test-case creation and template tools:

- `testplanit_cases_create_many` — create many test cases in one call, with a per-case results array so partial failures are visible. Each case takes the same fields as a single create plus optional per-case `folderId`/`stateName`.
- `testplanit_templates_list` — list a project's enabled templates with the case fields each defines (display name, system name, type, required).
- `testplanit_cases_create` and `testplanit_cases_create_many` accept an optional `templateId` (defaults to the project's first enabled template). Custom fields are resolved and validated against the chosen template — and the case's own template on update — so an out-of-template field returns a clear error instead of being silently dropped.

Requires a TestPlanIt instance (app v0.39.0+) exposing the `/api/projects/{projectId}/cases/bulk-create` endpoint.
