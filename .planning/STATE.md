---
gsd_state_version: 1.0
milestone: v0.17.0
milestone_name: Copy/Move Test Cases Between Projects
status: planning
stopped_at: —
last_updated: "2026-03-20"
last_activity: 2026-03-20 — Roadmap created for v0.17.0 (Phases 28-32)
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Copy/Move Test Cases Between Projects — Phase 28 ready to plan

## Current Position

Phase: 28 of 32 (Queue and Worker)
Plan: —
Status: Ready to plan Phase 28
Last activity: 2026-03-20 — Roadmap created, 31 requirements mapped across 5 phases (28-32)

Progress: [░░░░░░░░░░] 0% (v0.17.0 phases)

## Performance Metrics

**Velocity:**

- Total plans completed (v0.17.0): 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| -     | -     | -     | -        |

## Accumulated Context

### Decisions

- Build order: worker (Phase 28) → API (Phase 29) → dialog UI (Phase 30) → entry points (Phase 31) → testing/docs (Phase 32)
- Worker uses raw `prisma` (not `enhance()`); ZenStack access control gated once at API entry only
- `concurrency: 1` on BullMQ queue to prevent ZenStack v3 deadlocks (40P01)
- `attempts: 1` on queue — partial retries on copy/move create duplicates; surface failures cleanly
- Shared steps inlined as standalone steps (sharedStepGroupId = null) in target; content fetched from SharedStepGroup before nulling
- Move: copy all RepositoryCaseVersions rows to target then update projectId; only soft-delete source after target confirmed
- Copy: version 1 only, fresh history
- Field option IDs must be re-resolved by option name when source and target use different templates
- folderMaxOrder pre-fetched before the per-case loop to avoid race condition (not fetched inside loop)
- Unique constraint errors detected via string-matching err.info?.message for "duplicate key" (not err.code === "P2002")
- Cross-project case links explicitly dropped (not migrated)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 29] Verify `@@allow` delete semantics on RepositoryCases in schema.zmodel before implementing move permission check
- [Phase 29] Verify TemplateProjectAssignment access rules permit admin auto-assign via enhance(db, { user }) without elevated-privilege client
- [Phase 28] Verify RepositoryCaseVersions cascade behavior on source delete does not fire before copy completes inside transaction

## Session Continuity

Last session: 2026-03-20
Stopped at: Roadmap created — Phase 28 ready to plan
Resume file: None
