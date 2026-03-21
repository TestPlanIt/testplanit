---
phase: 29-api-endpoints-and-access-control
plan: "03"
subsystem: api
tags: [copy-move, submit, bullmq, access-control, zenstack, template-assignment]
dependency_graph:
  requires: [29-01]
  provides: [submit-endpoint, template-auto-assign, job-enqueue]
  affects: [phase-30-dialog-ui, phase-28-worker]
tech_stack:
  added: []
  patterns: [tdd-red-green, zenstack-enhance, bullmq-enqueue, project-admin-access]
key_files:
  created:
    - testplanit/app/api/repository/copy-move/route.ts
    - testplanit/app/api/repository/copy-move/route.test.ts
  modified:
    - testplanit/schema.zmodel
decisions:
  - conflictResolution limited to skip/rename at API layer (overwrite rejected by Zod schema)
  - canAutoAssign true for both ADMIN and PROJECTADMIN access levels (matches CONTEXT.md user decision)
  - Auto-assign failures wrapped in try/catch per-template — ZenStack rejects project admins without project access gracefully
  - targetRepositoryId/templateId/workflowStateId resolved server-side when not provided in request body
metrics:
  duration: ~7m
  completed: "2026-03-20T17:55:00Z"
  tasks_completed: 2
  files_changed: 3
---

# Phase 29 Plan 03: Submit Endpoint with Permission Checks and Template Auto-Assign Summary

**One-liner:** POST submit endpoint with Zod validation, ZenStack permission checks, admin/project-admin template auto-assignment, ID resolution, and BullMQ job enqueue.

## What Was Built

### Task 0: TemplateProjectAssignment ZenStack Access Rules

Updated `schema.zmodel` to add project admin access rules to the `TemplateProjectAssignment` model, matching the exact pattern from `CaseExportTemplateProjectAssignment`. Added two new `@@allow` rules:

1. Project admins with explicit `SPECIFIC_ROLE` (Project Admin role) can create/delete assignments for their projects
2. Users with `PROJECTADMIN` access assigned to the project can create/delete assignments

`pnpm generate` re-ran successfully.

### Task 1: Submit Endpoint (TDD — RED/GREEN)

**Route:** `POST /api/repository/copy-move`

**Request flow:**
1. Auth check via `getServerSession` — 401 if no session
2. Zod validation with `submitSchema` — 400 if invalid (including `conflictResolution: "overwrite"` rejected)
3. Queue availability check via `getCopyMoveQueue` — 503 if null
4. User fetch + `enhance(db, { user })` for ZenStack policy enforcement
5. Source project read access — 403 if denied
6. Target project write access — 403 if denied
7. Move delete check (operation === "move") — 403 if no delete access on source
8. Admin/project-admin template auto-assign (if `autoAssignTemplates: true`):
   - `canAutoAssign = user.access === "ADMIN" || user.access === "PROJECTADMIN"`
   - Fetches existing target template assignments, identifies missing templateIds from source cases
   - Creates `TemplateProjectAssignment` records for each missing templateId
   - Individual create failures wrapped in try/catch — ZenStack may reject project admins lacking project access
   - Regular users (access === "USER") silently skip — no error
9. Resolve `targetRepositoryId` from active repository when not provided — 400 if no active repo
10. Resolve `targetDefaultWorkflowStateId` from default workflow — 400 if none
11. Resolve `targetTemplateId` from first template assignment — 400 if none
12. Enqueue `CopyMoveJobData` to BullMQ via `queue.add("copy-move", jobData)`
13. Return `{ jobId: job.id }`

## Tests

15 unit tests covering all behaviors:
- Tests 1-3: Auth and validation guards
- Test 4: Queue unavailability
- Tests 5-7: Permission enforcement (source read, target write, move delete)
- Tests 8-10: Auto-assign for ADMIN, PROJECTADMIN, and regular user (silent skip)
- Tests 11-13: ID resolution (repository, workflow state, template)
- Test 14: Full CopyMoveJobData shape validation
- Test 15: Success response shape

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture mock exhaustion for templateProjectAssignment.findMany in auto-assign tests**
- **Found during:** Task 1, GREEN phase
- **Issue:** Tests 8-10 mocked `templateProjectAssignment.findMany` to return `[]` (no existing assignments), but the route calls `findMany` a second time during `resolveTargetTemplateId` — also returning `[]`, causing a 400 ("no template assignment found"). Tests returned 400 instead of expected 200.
- **Fix:** Tests 8-10 now provide `targetTemplateId`, `targetRepositoryId`, and `targetDefaultWorkflowStateId` directly in the request body to bypass the resolution step, keeping focus on the auto-assign behavior being tested.
- **Files modified:** `testplanit/app/api/repository/copy-move/route.test.ts`
- **Commit:** 3f2cfc2e

## Self-Check: PASSED
