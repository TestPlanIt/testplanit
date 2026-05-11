---
"@testplanit/mcp-server": minor
---

Test-case domain (Phase 6): add 11 production MCP tools.

- **Cases:** `testplanit_cases_list`, `testplanit_cases_get`, `testplanit_cases_create`, `testplanit_cases_update`, `testplanit_cases_delete`. Cursor pagination, full denormalized detail (folder breadcrumb, custom-fields flat dict, plain-text steps from Tiptap, linked issues + automated tests inline).
- **Folders:** `testplanit_folders_list` (tree with case counts), `testplanit_folders_get` (breadcrumb + cases summary), `testplanit_folders_create`, `testplanit_folders_update` (rename + reparent), `testplanit_folders_delete` (MCP tool enforces "no cases, no sub-folders" before issuing soft-delete).
- **Tags + Context:** `testplanit_tags_list` with usage counts (project-scoped when projectId supplied), `testplanit_projects_list` for agent context disambiguation.
- **Soft-delete invariant:** all delete tools use PATCH update with `isDeleted: true`; never the ZenStack `delete` operation.
- **Read-only token enforcement:** all write tools inherit Phase 5's `WRITE_HTTP_METHODS` host gate — `mode:read` tokens receive HTTP 403 + `READ_ONLY_TOKEN` and the MCP error mapper surfaces a structured tool error naming the scope.
