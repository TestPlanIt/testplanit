---
gsd_state_version: 1.0
milestone: v0.17
milestone_name: milestone
status: executing
stopped_at: Completed 51-02-PLAN.md
last_updated: "2026-03-24T13:42:47.172Z"
last_activity: 2026-03-23 — Completed 47-03 DuplicateScanService
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 14
  completed_plans: 13
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
| Phase 48 P01 | 15m | 2 tasks | 4 files |
| Phase 48 P02 | 8 | 2 tasks | 4 files |
| Phase 49 P01 | 5m | 1 tasks | 2 files |
| Phase 49-resolution-engine P02 | 5m | 2 tasks | 2 files |
| Phase 50-creation-time-and-import-warnings P01 | 4 | 2 tasks | 3 files |
| Phase 50-creation-time-and-import-warnings P02 | 15 | 2 tasks | 4 files |
| Phase 51-llm-semantic-tier P01 | 10 | 2 tasks | 6 files |
| Phase 51-llm-semantic-tier P02 | 10 | 1 tasks | 2 files |

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
- [Phase 48]: No $transaction() for deleteMany+createMany — avoids timeout on large case sets
- [Phase 48]: concurrency:1 at worker level prevents overlapping scans for same project
- [Phase 48]: Shallow repositoryCases select (id,name only) avoids ZenStack v3 alias limit
- [Phase 48]: Raw prisma client used in candidates route to avoid ZenStack 63-char alias issue
- [Phase 48]: Duplicate scan job prevention via getJobs active+waiting check in submit route
- [Phase 49]: vi.hoisted() required for mock objects in vi.mock() factories — vi.mock is hoisted before variable declarations in Vitest
- [Phase 49]: linkCases uses static array form of prisma.$transaction([op1, op2]) to avoid interactive tx overhead for simple two-step operations
- [Phase 49]: Steps model uses step (Json) field not title; CaseFieldValues relation is field not caseField with displayName not name
- [Phase 49-resolution-engine]: onTestCaseClick DataTable prop used for row click in DuplicateResultsTable — avoids modifying duplicateColumns.tsx
- [Phase 49-resolution-engine]: Merge button disabled until survivor explicitly selected — prevents accidental destructive merge
- [Phase 50]: getCurrentTenantId() used for tenantId in check-new route — Projects model has no tenant relation
- [Phase 50]: caseAId=0 convention for new cases — DuplicateScanService sets caseAId=Math.min(0, candidate.id) when sourceId is null
- [Phase 50]: View action link only shown for single match in duplicate warning toast — multiple matches show count only
- [Phase 50]: getCurrentTenantId() used in import routes for tenantId — avoids non-existent prisma.project model, consistent with check-new pattern
- [Phase 50]: Duplicate check guarded by esClient null check in both import routes — graceful degradation when Elasticsearch unavailable
- [Phase 51-01]: PROMPT_FEATURE_VARIABLES entry for DUPLICATE_DETECTION uses empty array — variables injected directly into prompt body
- [Phase 51-01]: fallback-prompts.ts requires exhaustive Record<LlmFeature> — new feature constants must always include a fallback prompt entry
- [Phase 51-02]: PromptResolver injected but not used in analyzePairs — kept for future prompt customization without breaking the interface
- [Phase 51-02]: buildUserPrompt uses 'Pair N:' prefix pattern to enable pairIndex-based verdict matching in LLM response

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 49 (Merge): TestRunCases conflict resolution policy is a product decision — which status wins when both cases appear in the same run? Must be decided before Phase 49 implementation begins.
- Phase 48 (Scan scale): pg_trgm pairwise SQL performance at 1,000+ cases needs empirical validation early in Phase 48.

## Session Continuity

Last session: 2026-03-24T13:42:47.170Z
Stopped at: Completed 51-02-PLAN.md
Resume file: None
