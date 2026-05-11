---
"@testplanit/mcp-server": minor
---

Add new read tools — three new milestones-domain tools and three new `cases_list` filter dimensions:

- `testplanit_milestones_list` — list milestones scoped to a project, with **pooled `statusCounts` rollup** (merged across linked test runs AND linked sessions in a single response) inline on every row, plus `untested + total` (counts SUM to total). Filters: `isCompleted`, `isStarted`, `milestoneTypeId`, `createdById`, `from`/`to` (createdAt range), `parentId` (`null` = root-only, `number` = direct children of, omitted = all). Each row also carries `directChildrenCount`, `commentCount`, and `totalDescendants` (computed via a single batched recursive CTE per page through a new host endpoint). Cost model: at most 5 backend round trips per page — never per-row.
- `testplanit_milestones_get` — fetch a single milestone with denormalized header, plain-text `note` and `docs` (ProseMirror), pooled `statusCounts`, and three inlined linked arrays — `linkedTestRuns` (cap **250** — wider than the standard 100 to cover the dominant fan-out), `linkedSessions` (cap 100), `children` (cap 100, 1-level deep with each child carrying `totalDescendants`). Per-array `truncated.<key>: true` overflow stamps.
- `testplanit_milestone_types_list` — list milestone types assigned to a project via the `MilestoneTypesAssignment` junction. Returns `{items: [{id, name, isDefault}]}` ordered by name; no cursor pagination.
- `testplanit_cases_list` (extended) — adds `creatorIds: string[]` (array — deliberately wider than `runs_list` / `sessions_list` single-string `createdById`), and `from` / `to` (ISO 8601 createdAt range). Closes the gap *"How many test cases did I write last month?"*.

Total registered tools: **31** (up from 28). All tools are read-only; existing `mode:read` token enforcement covers them without modification. New host endpoint `GET /api/mcp/milestones-descendants` (recursive CTE) is required for the `totalDescendants` denorm — ZenStack RPC has no `$queryRaw` passthrough.
