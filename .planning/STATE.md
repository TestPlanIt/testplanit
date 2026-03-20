---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Comprehensive Test Coverage
status: in_progress
stopped_at: Completed 29-02-PLAN.md (Phase 29 Plan 02 — status and cancel endpoints for copy-move jobs)
last_updated: "2026-03-20T17:46:00Z"
last_activity: "2026-03-20 — Completed 29-02: status polling and cancel endpoints with multi-tenant isolation"
progress:
  total_phases: 24
  completed_phases: 18
  total_plans: 49
  completed_plans: 54
  percent: 24
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Copy/Move Test Cases Between Projects — Phase 29 in progress

## Current Position

Phase: 29 of 32 (API Endpoints and Access Control)
Plan: 02 of 04 (complete)
Status: Phase 29 plan 02 complete — ready for 29-03
Last activity: 2026-03-20 — Completed 29-02: status polling and cancel endpoints with multi-tenant isolation

Progress: [██░░░░░░░░] 24% (v0.17.0 phases — 4 of ~14 plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed (v0.17.0): 3
- Average duration: ~6m
- Total execution time: ~18m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 28    | 2     | ~12m  | ~6m      |
| 29    | 1     | ~6m   | ~6m      |

## Accumulated Context

### Decisions

- Build order: worker (Phase 28) → API (Phase 29) → dialog UI (Phase 30) → entry points (Phase 31) → testing/docs (Phase 32)
- Worker uses raw `prisma` (not `enhance()`); ZenStack access control gated once at API entry only
- `concurrency: 1` on BullMQ worker to prevent ZenStack v3 deadlocks (40P01)
- `attempts: 1` on queue — partial retries on copy/move create duplicates; surface failures cleanly
- Shared step groups recreated as proper SharedStepGroups in target (not flattened); in-memory deduplication Map across cases
- Move: all RepositoryCaseVersions rows re-created with `repositoryCaseId = newCase.id` and `projectId` updated to target
- Copy: version 1 only, fresh history via createTestCaseVersionInTransaction
- Field option IDs re-resolved by option name when source/target templates differ; values dropped if no match
- folderMaxOrder pre-fetched before the per-case loop to avoid race condition (not inside transaction)
- Unique constraint errors detected via string-matching err.info?.message for "duplicate key" (not err.code === "P2002")
- Cross-project case links (RepositoryCaseLink) dropped silently; droppedLinkCount reported in job result
- Version history and template field options fetched separately to avoid PostgreSQL 63-char alias limit (ZenStack v3)
- mockPrisma.$transaction.mockReset() required in test beforeEach — mockClear() does not reset mockImplementation, causing rollback tests to pollute subsequent tests
- Tests mock templateCaseAssignment + caseFieldAssignment separately to match worker's two-step field option fetch pattern
- conflictResolution limited to skip/rename at API layer (overwrite not accepted despite worker support)
- canAutoAssignTemplates true for both ADMIN and PROJECTADMIN access levels
- Source workflow state names fetched from source project WorkflowAssignment (not a separate states query)
- Cancel key prefix `copy-move:cancel:` (not `auto-tag:cancel:`) — must match copyMoveWorker.ts cancelKey() exactly
- Active job cancellation uses Redis flag (not job.remove()) to allow graceful per-case boundary stops

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 29] Verify `@@allow` delete semantics on RepositoryCases in schema.zmodel before implementing move permission check
- [Phase 29] Verify TemplateProjectAssignment access rules permit admin auto-assign via enhance(db, { user }) without elevated-privilege client
- [Phase 28] Verify RepositoryCaseVersions cascade behavior on source delete does not fire before copy completes inside transaction

## Session Continuity

Last session: 2026-03-20
Stopped at: Completed 29-01-PLAN.md (Phase 29 Plan 01 — preflight API endpoint and shared schemas)
Resume file: None
