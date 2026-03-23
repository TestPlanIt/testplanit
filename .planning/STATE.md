---
gsd_state_version: 1.0
milestone: v0.17
milestone_name: milestone
status: executing
stopped_at: Completed 47-03-PLAN.md
last_updated: "2026-03-23T16:40:00.000Z"
last_activity: 2026-03-23 — Completed 47-03 DuplicateScanService
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 3
  completed_plans: 2
  percent: 67
---

# State

## Current Position

Phase: 47 of 52 (Detection Foundation)
Plan: 3 of 3 in current phase
Status: In progress
Last activity: 2026-03-23 — Completed 47-03 DuplicateScanService

Progress: [██████░░░░] 67%

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.

**Current focus:** v0.19.0 — Phase 47: Detection Foundation

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total  | Avg/Plan |
|-------|-------|--------|----------|
| -     | -     | -      | -        |

## Accumulated Context

| Phase 47 P01 | 2 | 1 tasks | 2 files |
| Phase 47 P03 | 2 | 1 tasks | 2 files |

### Decisions

- RepositoryCases has unique constraint on (projectId, name, className, source) — exact duplicates prevented at DB level
- RepositoryCaseLink model already supports SAME_TEST_DIFFERENT_SOURCE type for the "link as related" resolution path
- All detection scoped to within a project only — cross-project detection is explicitly out of scope
- BullMQ async worker pattern (autoTagWorker template) drives the project-wide scan
- Merge must be a single prisma.$transaction() — non-atomic merge is a hard constraint
- Version history re-parenting must happen before soft-delete of victim within the merge transaction
- TestRunCases unique constraint conflict (both cases in same run) requires preflight and consolidation strategy
- LLM tier is additive and optional — fuzzy tier must work standalone first
- [Phase 47]: Jaro-Winkler chosen over Levenshtein for bounded 0-1 similarity scoring with transposition and prefix handling
- [Phase 47]: scoreToConfidence returns null below 0.55 — below-threshold results not surfaced to users
- [Phase 47]: Lowercase normalization inside jaroWinkler itself — callers never need to handle case
- [Phase 47 P03]: ES _score used as steps signal proxy (normalized by MAX_ES_SCORE=10.0) — avoids separate step-level comparison
- [Phase 47 P03]: stepsScore threshold for matchedFields set at 0.3 (normalized) — aligns with steps weight in scoring formula

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 49 (Merge): TestRunCases conflict resolution policy is a product decision — which status wins when both cases appear in the same run? Must be decided before Phase 49 implementation begins.
- Phase 48 (Scan scale): pg_trgm pairwise SQL performance at 1,000+ cases needs empirical validation early in Phase 48.

## Session Continuity

Last session: 2026-03-23T16:40:00.000Z
Stopped at: Completed 47-03-PLAN.md
Resume file: None
