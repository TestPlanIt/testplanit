---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Comprehensive Test Coverage
status: completed
stopped_at: Completed 28-02-PLAN.md (Phase 28 Plan 02 — unit tests for copy-move worker)
last_updated: "2026-03-20T17:01:27.522Z"
last_activity: "2026-03-20 — Completed 28-02: unit tests for copy-move worker processor"
progress:
  total_phases: 24
  completed_phases: 18
  total_plans: 49
  completed_plans: 52
  percent: 14
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Copy/Move Test Cases Between Projects — Phase 28 ready to plan

## Current Position

Phase: 28 of 32 (Queue and Worker)
Plan: 02 of 02 (complete)
Status: Phase 28 complete — ready for Phase 29
Last activity: 2026-03-20 — Completed 28-02: unit tests for copy-move worker processor

Progress: [█░░░░░░░░░] 14% (v0.17.0 phases — 2 of ~14 plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed (v0.17.0): 2
- Average duration: ~6m
- Total execution time: ~12m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 28    | 2     | ~12m  | ~6m      |

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 29] Verify `@@allow` delete semantics on RepositoryCases in schema.zmodel before implementing move permission check
- [Phase 29] Verify TemplateProjectAssignment access rules permit admin auto-assign via enhance(db, { user }) without elevated-privilege client
- [Phase 28] Verify RepositoryCaseVersions cascade behavior on source delete does not fire before copy completes inside transaction

## Session Continuity

Last session: 2026-03-20
Stopped at: Completed 28-02-PLAN.md (Phase 28 Plan 02 — unit tests for copy-move worker)
Resume file: None
