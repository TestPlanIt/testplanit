---
phase: 51-llm-semantic-tier
plan: 02
subsystem: llm
tags: [llm, duplicate-detection, tdd, semantic, batch-processing]

# Dependency graph
requires:
  - phase: 51-01
    provides: LLM_FEATURES.DUPLICATE_DETECTION constant
  - phase: 47-detection-foundation
    provides: SimilarCasePair type from duplicateScanService
provides:
  - DuplicateAnalysisService with analyzePairs method
  - BATCH_SIZE=10 and MAX_PAIRS_PER_SCAN=50 exported constants
  - PairWithCaseContent and AnnotatedPair types
affects:
  - 51-03 (duplicateScanWorker wires DuplicateAnalysisService into scan pipeline)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Batch processor pattern (manual, not shared) for fixed-size pair batching
    - Private method decomposition: buildSystemPrompt / buildUserPrompt / parseResponse / stripContentFields
    - Conservative fallback: missing LLM response entries kept as "fuzzy" (not dropped)
    - Overflow cap: pairs beyond MAX_PAIRS_PER_SCAN returned unchanged as fuzzy

key-files:
  created:
    - testplanit/lib/llm/services/duplicate-detection/duplicate-analysis.service.ts
    - testplanit/lib/llm/services/duplicate-detection/duplicate-analysis.service.test.ts
  modified: []

key-decisions:
  - "PromptResolver injected but not used in analyzePairs — kept for future prompt customization (3-tier chain)"
  - "buildUserPrompt uses 'Pair N:' prefix pattern to enable pairIndex-based verdict matching"
  - "parseResponse strips markdown code fences to handle LLM adapters that wrap JSON in backticks"
  - "LLM chat request cast as any at boundary — LlmRequest type lacks feature/userId fields in public interface"

# Metrics
duration: ~10min
completed: 2026-03-24
---

# Phase 51 Plan 02: DuplicateAnalysisService Summary

**DuplicateAnalysisService with LLM-based semantic pair verification — batches up to 50 pairs in groups of 10, upgrades YES pairs to HIGH confidence/semantic, removes NO pairs, and gracefully falls back to fuzzy on all failure modes**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-24T13:30:00Z
- **Completed:** 2026-03-24T13:41:39Z
- **Tasks:** 1 (TDD: RED + GREEN + REFACTOR)
- **Files created:** 2

## Accomplishments

- Created `duplicate-analysis.service.ts` with `DuplicateAnalysisService` class implementing all specified behavior
- Created `duplicate-analysis.service.test.ts` with 10 passing test cases covering all 7 behavior specifications plus LLM call param validation and missing-response conservative fallback
- Exported `BATCH_SIZE=10` and `MAX_PAIRS_PER_SCAN=50` constants for worker logging
- All private methods named as specified: `buildSystemPrompt()`, `buildUserPrompt(pairs)`, `parseResponse(content)`, `stripContentFields(pair)`

## Task Commits

TDD cycle produced 3 atomic commits:

1. **RED: Failing tests** - `2a3ca06d` — `test(51-02): add failing tests for DuplicateAnalysisService`
2. **GREEN: Implementation** - `4ff32812` — `feat(51-02): implement DuplicateAnalysisService`
3. **REFACTOR: Cleanup** - `64c3d26c` — `refactor(51-02): clean up DuplicateAnalysisService`

## Files Created

- `testplanit/lib/llm/services/duplicate-detection/duplicate-analysis.service.ts` — Service class + PairWithCaseContent/AnnotatedPair types + BATCH_SIZE/MAX_PAIRS_PER_SCAN constants
- `testplanit/lib/llm/services/duplicate-detection/duplicate-analysis.service.test.ts` — 10 tests covering all behavior cases

## Decisions Made

- PromptResolver is injected but not called in the current implementation — the service builds system/user prompts inline rather than via the 3-tier chain. The constructor parameter is kept for future customization without breaking the interface.
- `buildUserPrompt` uses `Pair N:` prefix notation to establish pairIndex-based verdict lookup — LLM response `pairIndex` is the 0-based position within the batch, not the global pair index.
- The `parseResponse` method strips markdown code fences before parsing to handle LLM adapters (e.g., OpenAI) that return JSON wrapped in ```json``` blocks.
- The LLM chat request uses `as any` at the boundary because the public `LlmRequest` type in `llm-manager.service.ts` does not expose `feature`, `userId`, `projectId` fields in its type signature (these are extension fields passed through but not typed).

## Test Coverage

All 7 specified behavior cases tested plus 3 additional:

| Test | Behavior |
|------|----------|
| 1 | Empty pairs → returns [] |
| 2 | No LLM configured → all pairs fuzzy unchanged |
| 3 | YES/NO verdicts → YES upgraded to HIGH+semantic, NO removed |
| 4 | 60 pairs input → first 50 analyzed, 10 overflow returned fuzzy |
| 5 | 25 pairs → exactly 3 LLM calls (10, 10, 5) |
| 6 | LLM error on batch 2 → batch 2 pairs kept fuzzy, batch 1 unaffected |
| 7 | Unparseable JSON → all batch pairs kept fuzzy |
| 8 | Constants BATCH_SIZE=10, MAX_PAIRS_PER_SCAN=50 exported |
| 9 | LLM call params: feature=DUPLICATE_DETECTION, temperature=0.1, userId/projectId forwarded |
| 10 | Missing pair in LLM response → conservative fuzzy fallback |

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — all tests passed on first GREEN phase run.

## User Setup Required

None.

## Next Phase Readiness

- Plan 51-03 (duplicateScanWorker) can import `DuplicateAnalysisService`, `BATCH_SIZE`, `MAX_PAIRS_PER_SCAN` from `~/lib/llm/services/duplicate-detection/duplicate-analysis.service`
- The worker needs to fetch `caseAName/caseASteps/caseBName/caseBSteps` before calling `analyzePairs()`
- No blockers

---
*Phase: 51-llm-semantic-tier*
*Completed: 2026-03-24*
