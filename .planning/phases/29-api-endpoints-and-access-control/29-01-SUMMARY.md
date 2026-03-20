---
phase: 29-api-endpoints-and-access-control
plan: "01"
subsystem: api
tags: [copy-move, preflight, zod, zenstack, access-control]
dependency_graph:
  requires: [28-01, 28-02]
  provides: [preflight-endpoint, copy-move-schemas]
  affects: [30-dialog-ui]
tech_stack:
  added: []
  patterns: [enhance-pattern, tdd-red-green]
key_files:
  created:
    - testplanit/app/api/repository/copy-move/schemas.ts
    - testplanit/app/api/repository/copy-move/preflight/route.ts
    - testplanit/app/api/repository/copy-move/preflight/route.test.ts
  modified: []
decisions:
  - conflictResolution limited to skip/rename at API layer (overwrite not accepted despite worker support)
  - canAutoAssignTemplates true for both ADMIN and PROJECTADMIN access levels
  - Source workflow state names fetched from source project WorkflowAssignment (not a separate states query)
  - Template names for missing templates use fallback "Template {id}" (actual names require extra query not in plan scope)
metrics:
  duration: "~6m"
  completed: "2026-03-20"
  tasks_completed: 2
  files_created: 3
---

# Phase 29 Plan 01: Preflight API Endpoint and Shared Schemas Summary

Shared Zod schemas (preflightSchema, submitSchema, PreflightResponse) and POST /api/repository/copy-move/preflight endpoint with ZenStack-enhanced access control, template compatibility detection, workflow state name-mapping with default fallback, and naming collision detection.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create shared Zod schemas and TypeScript types | bba6092a | schemas.ts |
| 2 (RED) | Write failing tests for preflight endpoint | ef8d5f84 | route.test.ts |
| 2 (GREEN) | Implement preflight endpoint | 4549efbb | route.ts |

## What Was Built

### schemas.ts
- `preflightSchema` — validates operation, caseIds (1-500), sourceProjectId, targetProjectId
- `submitSchema` — full submit body with `conflictResolution: z.enum(["skip", "rename"])` (no overwrite)
- `PreflightResponse` TypeScript interface with all fields for UI consumption

### preflight/route.ts (POST handler)
1. Auth gate: 401 if no session
2. Zod validation: 400 on invalid body
3. User fetch via raw `prisma.user.findUnique` (with role.rolePermissions for enhance)
4. `enhance(db, { user })` for all access-controlled queries
5. Source project access check: 403 if enhancedDb returns null
6. Target project access check: 403 if enhancedDb returns null
7. Move delete access: checks `repositoryCases.findFirst` for source case visibility
8. Template compatibility: detects templates used by source cases missing from target assignments
9. Workflow mapping: name-matched states or default fallback with isDefaultFallback flag
10. Collision detection: OR query on (name, className, source) in target project
11. Target repository resolution from active repository
12. Returns full `PreflightResponse`

### preflight/route.test.ts
16 unit tests covering all specified behaviors with vi.hoisted mocks for next-auth, @zenstackhq/runtime, ~/lib/prisma.

## Decisions Made

- `conflictResolution` schema limited to `["skip", "rename"]` — locked decision, worker supports "overwrite" but API rejects it
- `canAutoAssignTemplates` true for both `ADMIN` and `PROJECTADMIN` (consistent with TemplateProjectAssignment plan 29-03 access rules)
- Source workflow state names fetched via `projectWorkflowAssignment.findMany` on source project — avoids extra query complexity
- Missing template names use `"Template {id}"` fallback — actual template name resolution would require a separate templates query outside plan scope

## Deviations from Plan

### Auto-fixed Issues

None.

### Additional Work
- Added source workflow assignment query (projectWorkflowAssignment for sourceProjectId) to enable state name resolution in workflowMappings. The plan specified fetching source case state IDs, but names were needed for the sourceStateName field in PreflightResponse. This is a necessary addition to satisfy Test 10/11 sourceStateName requirements.

## Self-Check

- [x] testplanit/app/api/repository/copy-move/schemas.ts exists
- [x] testplanit/app/api/repository/copy-move/preflight/route.ts exists
- [x] testplanit/app/api/repository/copy-move/preflight/route.test.ts exists
- [x] All 16 tests pass
- [x] Commits bba6092a, ef8d5f84, 4549efbb exist
