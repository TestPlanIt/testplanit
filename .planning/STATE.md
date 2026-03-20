---
gsd_state_version: 1.0
milestone: v0.17.0
milestone_name: Copy/Move Test Cases Between Projects
status: in-progress
stopped_at: Completed 28-01-PLAN.md
last_updated: "2026-03-20"
last_activity: 2026-03-20 — Phase 28 Plan 01 complete (queue + worker)
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 1
  completed_plans: 1
  percent: 7
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Copy/Move Test Cases Between Projects — Phase 28 ready to plan

## Current Position

Phase: 28 of 32 (Queue and Worker)
Plan: 01 of 01 (complete)
Status: Phase 28 complete — ready for Phase 29
Last activity: 2026-03-20 — Completed 28-01: copy-move queue and worker processor

Progress: [█░░░░░░░░░] 7% (v0.17.0 phases — 1 of ~14 plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed (v0.17.0): 1
- Average duration: ~3m 32s
- Total execution time: ~3m 32s

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 28    | 1     | ~4m   | ~4m      |

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 29] Verify `@@allow` delete semantics on RepositoryCases in schema.zmodel before implementing move permission check
- [Phase 29] Verify TemplateProjectAssignment access rules permit admin auto-assign via enhance(db, { user }) without elevated-privilege client
- [Phase 28] Verify RepositoryCaseVersions cascade behavior on source delete does not fire before copy completes inside transaction

## Session Continuity

Last session: 2026-03-20
Stopped at: Completed 28-01-PLAN.md (Phase 28 Plan 01 — queue + worker)
Resume file: None
