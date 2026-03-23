---
phase: 47-detection-foundation
plan: 03
subsystem: testing
tags: [elasticsearch, similarity, duplicate-detection, more_like_this, jaro-winkler, jaccard]

# Dependency graph
requires:
  - phase: 47-01
    provides: similarity scoring utilities (jaroWinkler, jaccardSimilarity, combineScores, scoreToConfidence, ConfidenceBucket)
provides:
  - DuplicateScanService class with findSimilarCases method
  - CaseSearchInput and SimilarCasePair TypeScript interfaces
  - Unit test suite with 18 test cases using mocked ES client
affects:
  - phase 48 (scan worker — consumes DuplicateScanService)
  - phase 50 (creation-time warnings — consumes DuplicateScanService)
  - phase 51 (LLM tier — builds on fuzzy detection from this plan)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Constructor injection for ES client and PrismaClient (same pattern as TagAnalysisService)
    - ES more_like_this query with bool/filter for strict project scoping
    - Normalize unbounded ES _score to 0-1 via MAX_ES_SCORE constant before combining
    - Canonical pair ordering (caseAId < caseBId) to prevent logical duplicates in result set

key-files:
  created:
    - testplanit/lib/services/duplicateScanService.ts
    - testplanit/lib/services/duplicateScanService.test.ts
  modified: []

key-decisions:
  - "ES _score used as steps signal proxy (normalized by MAX_ES_SCORE=10.0) — avoids needing separate step-level comparison"
  - "stepsScore threshold for matchedFields set at 0.3 (normalized), i.e. rawEsScore >= 3.0 indicates meaningful step overlap"
  - "Jaccard on tag name strings — both source and candidate with empty tags produce 1.0 (identical empty sets); plan behavior matches spec"

patterns-established:
  - "DuplicateScanService: inject ES client as nullable (Client | null) — graceful no-op when ES unavailable"
  - "Confidence gating via scoreToConfidence: below 0.55 returns null, filtered before pairs list is built"
  - "matchedFields populated from per-signal thresholds (name>=0.7, steps>=0.3, tags>0, fields>0)"

requirements-completed: [DET-01, DET-02, DET-03, DET-04, DET-05]

# Metrics
duration: 15min
completed: 2026-03-23
---

# Phase 47 Plan 03: DuplicateScanService Summary

**DuplicateScanService with ES more_like_this orchestrating Jaro-Winkler, Jaccard, and field-value scoring into HIGH/MEDIUM/LOW confidence duplicate pairs**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-23T16:20:00Z
- **Completed:** 2026-03-23T16:35:00Z
- **Tasks:** 1 (TDD: 2 commits — test + feat)
- **Files modified:** 2

## Accomplishments

- DuplicateScanService class with findSimilarCases method combining 4 signals into a weighted score
- ES more_like_this query with mandatory projectId and isDeleted:false filters (DET-05)
- Canonical pair ordering (caseAId < caseBId) prevents duplicate entries in result set
- 18 unit tests covering all behavior from the plan spec including edge cases

## Task Commits

1. **Task 1 RED: failing tests** — `a3c189a4` (test)
2. **Task 1 GREEN: DuplicateScanService implementation** — `8ede58fb` (feat)

## Files Created/Modified

- `testplanit/lib/services/duplicateScanService.ts` — DuplicateScanService class with findSimilarCases, CaseSearchInput, and SimilarCasePair exports
- `testplanit/lib/services/duplicateScanService.test.ts` — 18 unit tests with mocked ES client covering all detection behaviors

## Decisions Made

- ES _score used as the steps signal proxy after normalization — avoids a separate step-comparison loop since MLT already encodes step text similarity
- MAX_ES_SCORE constant = 10.0 chosen as the practical cap for bounded normalization; scores above this clamp to 1.0
- stepsScore >= 0.3 threshold for including "steps" in matchedFields aligns with the steps weight (0.3) in the scoring formula

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- DuplicateScanService is ready to be consumed by Phase 48 (scan worker) and Phase 50 (creation-time warnings)
- Service accepts optional tenantId for multi-tenant index naming, matching the existing ES infrastructure pattern
- Phase 51 (LLM tier) can wrap this service and add a post-processing step for LLM re-ranking

---
*Phase: 47-detection-foundation*
*Completed: 2026-03-23*
