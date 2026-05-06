---
phase: 06-test-case-domain-read-write
plan: 05
subsystem: mcp-server/tools/tags+projects
tags: [mcp-server, tools, tags, projects, zenstack, tdd, vitest, typescript, read-only]

# Dependency graph
requires:
  - phase: 06-test-case-domain-read-write
    plan: 01
    provides: "zenstack<T> RPC dispatcher and EnvConfig"

provides:
  - "testplanit_tags_list — global tag list with per-tag usage counts (CASE-11)"
  - "testplanit_projects_list — minimal { id, name } project list for agent context disambiguation"
  - "registerTags(server, deps) — central registry for tag tools"
  - "registerProjects(server, deps) — central registry for project tools"

affects:
  - "06-06 (E2E: READ_ONLY_TOKEN tests cover both read tools)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tags global list with optional projectId-scoped _count (option 2 from PLAN interfaces)"
    - "Projects minimal select: { id, name } — prevents field leakage even if schema policy widens"
    - "No inputSchema fields on projects list (no parameters needed — host filters by token)"

key-files:
  created:
    - "packages/mcp-server/src/tools/tags/list.ts"
    - "packages/mcp-server/src/tools/tags/list.test.ts"
    - "packages/mcp-server/src/tools/tags/index.ts"
    - "packages/mcp-server/src/tools/projects/list.ts"
    - "packages/mcp-server/src/tools/projects/list.test.ts"
    - "packages/mcp-server/src/tools/projects/index.ts"
  modified:
    - "packages/mcp-server/src/tools/index.ts"
    - "packages/mcp-server/src/index.ts"

key-decisions:
  - "Tags list implements option 2: global tag list + projectId-scoped counts when projectId provided"
  - "Projects list uses select (not include) to enforce minimal { id, name } shape"
  - "CASE-12 needs no new error code: existing mapHttpErrorToToolResult 422 fallback covers tags/projects findMany errors"
  - "testplanit_projects_list included as Claude's Discretion — removes projectId out-of-band dependency"

requirements-completed: [CASE-11, CASE-12]

# Metrics
duration: ~8min
completed: 2026-05-06
---

# Phase 06 Plan 05: Tags List + Projects List Summary

**`testplanit_tags_list` with project-scoped usage counts and `testplanit_projects_list` with minimal { id, name } shape complete Phase 6's 12-tool catalog — confirmed by 216 unit tests, clean typecheck, and clean build**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-05-06
- **Tasks:** 2 (TDD RED+GREEN for each tool)
- **Files created:** 6
- **Files modified:** 2

## Tool Catalog — Final (12 Tools)

| Tool | Plan | Requirement |
|------|------|-------------|
| `testplanit_whoami` | Phase 5 | — |
| `testplanit_cases_list` | 06-02 | CASE-01 |
| `testplanit_cases_get` | 06-02 | CASE-02 |
| `testplanit_cases_create` | 06-03 | CASE-03 |
| `testplanit_cases_update` | 06-03 | CASE-04 |
| `testplanit_cases_delete` | 06-03 | CASE-05 |
| `testplanit_folders_list` | 06-04 | CASE-06 |
| `testplanit_folders_get` | 06-04 | CASE-07 |
| `testplanit_folders_create` | 06-04 | CASE-08 |
| `testplanit_folders_update` | 06-04 | CASE-09 |
| `testplanit_folders_delete` | 06-04 | CASE-10 |
| `testplanit_tags_list` | 06-05 | CASE-11 |
| `testplanit_projects_list` | 06-05 | Claude's Discretion |

## Tool Input/Output Shapes

### `testplanit_tags_list` (CASE-11)

**Input:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | `number` (int, positive) | no | When provided, scopes usage counts to this project |

**Output:** `{ tags: Array<{ id, name, usageCounts: { repositoryCases, testRuns, sessions } }> }`

**Tags query (no projectId):**
```typescript
zenstack("tags", "findMany", {
  where: { isDeleted: false },
  include: { _count: { select: { repositoryCases: true, testRuns: true, sessions: true } } },
  orderBy: { name: "asc" },
}, env);
```

**Tags query (with projectId = 7):**
```typescript
zenstack("tags", "findMany", {
  where: { isDeleted: false },
  include: {
    _count: {
      select: {
        repositoryCases: { where: { isDeleted: false, projectId: 7 } },
        testRuns: { where: { isDeleted: false, projectId: 7 } },
        sessions: { where: { isDeleted: false, projectId: 7 } },
      },
    },
  },
  orderBy: { name: "asc" },
}, env);
```

### `testplanit_projects_list` (Claude's Discretion)

**Input:** None (no parameters)

**Output:** `{ projects: Array<{ id, name }> }`

**Projects query:**
```typescript
zenstack("projects", "findMany", {
  where: { isDeleted: false },
  select: { id: true, name: true },
  orderBy: { name: "asc" },
}, env);
```

## Key Design Decisions

### Tags List: Option 2 (Global Tags + Project-Scoped Counts)

The plan offered two approaches for CASE-11 "list tags scoped to a project":

1. **Option 1 (global):** Ignore `projectId`, return all non-deleted tags with global usage counts.
2. **Option 2 (project-scoped counts):** When `projectId` provided, filter `_count` relations to that project's data; fall back to global counts when omitted.

**Option 2 was implemented** because it gives agents more useful information: "of the tags that exist globally, how many times is each used *in this project*?" enables filtering decisions without extra calls.

### Projects List: Claude's Discretion Include

`testplanit_projects_list` is not in the CASE-01..12 requirements but was included as a Claude's Discretion decision per CONTEXT.md. Rationale:

- Without it, agents must know `projectId` out-of-band (via system prompt or user input)
- Cost: 1 zenstack `findMany` call, ~30 lines of implementation
- Benefit: removes a friction point that would make the MCP server harder to use in practice
- `select: { id: true, name: true }` enforces minimal response — no description, isArchived, tenantId, or other admin-domain fields are exposed

### CASE-12: No New Error Mapping Required

CASE-12 structured errors (e.g., "Custom field 'X' not found", "Folder not empty") from plans 06-03/04 already flow through the existing `mapHttpErrorToToolResult` from Phase 5. The generic fallback handles HTTP 422 with unknown codes:

```
Request failed: <host's human-readable message> (HTTP 422)
```

This plan confirms that the same error path covers tags/projects as well. No new error code or mapping table was added — the existing seam in `errors.ts` is sufficient.

## Task Commits

| Task | Phase | Commit | Files |
|------|-------|--------|-------|
| Task 1 | RED | `e7c6fd45` | tags/list.test.ts (9 failing tests) |
| Task 1 | GREEN | `32d2b678` | tags/list.ts, tags/index.ts (9 passing) |
| Task 2 | RED | `6a7888e7` | projects/list.test.ts (8 failing tests) |
| Task 2 | GREEN | `3ff4a927` | projects/list.ts, projects/index.ts, tools/index.ts, src/index.ts (216 total passing) |

## Test Counts

| File | Tests | Key Assertions |
|------|-------|----------------|
| `tags/list.test.ts` | 9 | happy path, all 3 _count relations, global counts, project-scoped counts, isDeleted filter, orderBy, empty, error, registration |
| `projects/list.test.ts` | 8 | happy path, { id, name } shape only (no leaking fields), select body, isDeleted filter, orderBy, empty, error, registration |
| **New tests (plan 06-05)** | **17** | |
| **Full suite total** | **216** | All 23 test files |

## Acceptance Criteria Verification

- `testplanit_tags_list` registered: 1 hit for `"testplanit_tags_list"` in list.ts
- `_count` with all 3 relations: `isDeleted: 4` occurrences in list.ts (root where + 3 scoped count filters)
- `mapHttpErrorToToolResult` in both tools: confirmed
- `select: { id: true, name: true }` in projects/list.ts: 1 hit
- `registerTags|registerProjects` in tools/index.ts: 5 occurrences (≥ 4 required)
- 216 tests pass; typecheck exits 0; build exits 0
- No `console.log` in any tools file

## Deviations from Plan

None — plan executed exactly as written. The tags/index.ts and projects/index.ts match the plan's specified code. The tools/index.ts final shape matches the plan's specified content exactly.

## Known Stubs

None. Both tools make real ZenStack RPC calls. No placeholder data.

## Threat Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-06-01 | Verified: `select: { id: true, name: true }` in projects/list.ts prevents any field beyond id/name from appearing in the response, even if the host's `@@allow` policy widens in the future |
| T-06-04 | Verified: tags/list.ts is read-only; no `createIfMissing` surface; createIfMissing lives in 06-03's resolveTagIds where appropriate |
| T-06-05 | Verified: `mapHttpErrorToToolResult` fallback covers tags/projects 422 errors; no token value appears in error messages |

## Self-Check

### File existence
- `packages/mcp-server/src/tools/tags/list.ts` — FOUND
- `packages/mcp-server/src/tools/tags/list.test.ts` — FOUND
- `packages/mcp-server/src/tools/tags/index.ts` — FOUND
- `packages/mcp-server/src/tools/projects/list.ts` — FOUND
- `packages/mcp-server/src/tools/projects/list.test.ts` — FOUND
- `packages/mcp-server/src/tools/projects/index.ts` — FOUND
- `packages/mcp-server/src/tools/index.ts` (modified) — FOUND
- `packages/mcp-server/src/index.ts` (modified) — FOUND

### Commit existence
- `e7c6fd45` (RED: tags/list.test.ts) — FOUND
- `32d2b678` (GREEN: tags/list.ts, tags/index.ts) — FOUND
- `6a7888e7` (RED: projects/list.test.ts) — FOUND
- `3ff4a927` (GREEN: projects/list.ts, projects/index.ts, wiring) — FOUND

## Self-Check: PASSED

---
*Phase: 06-test-case-domain-read-write*
*Completed: 2026-05-06*
