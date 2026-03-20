---
phase: 28-queue-and-worker
plan: "02"
subsystem: testing
tags: [vitest, bullmq, worker, copy-move, prisma-mock, unit-tests]

requires:
  - phase: 28-01
    provides: copyMoveWorker processor (workers/copyMoveWorker.ts)
provides:
  - Unit test suite for copy-move worker (workers/copyMoveWorker.test.ts)
  - Verified coverage for DATA-01 through DATA-09 behavioral requirements
  - Rollback, cancellation, move-only comments, and source deletion timing verified
affects:
  - Phase 29 (API layer) — test patterns established here inform integration test approach
  - Phase 32 (testing/docs) — unit coverage complete, only E2E remaining

tech-stack:
  added: []
  patterns:
    - "vi.hoisted() for stable mock refs across vi.resetModules() calls"
    - "mockPrisma.$transaction.mockReset() in beforeEach to prevent rollback test mock leakage"
    - "loadWorker() dynamic import + startWorker() pattern for module-level worker initialization"

key-files:
  created:
    - testplanit/workers/copyMoveWorker.test.ts
  modified: []

key-decisions:
  - "mockPrisma.$transaction.mockReset() required in beforeEach — mockClear() does not reset mockImplementation, causing rollback tests to pollute subsequent tests"
  - "Tests verify resolveFieldValue by mocking templateCaseAssignment and caseFieldAssignment separately (worker's actual DB access pattern)"
  - "ES sync non-fatal test uses .resolves.toBeDefined() since syncRepositoryCaseToElasticsearch is fire-and-forget via .catch()"

requirements-completed: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09]

duration: 8min
completed: 2026-03-20
---

# Phase 28 Plan 02: Copy-Move Worker Unit Tests Summary

**1,123-line Vitest test suite covering all 9 DATA requirements plus rollback, cancellation, and move-only comment behaviors for the copy-move BullMQ worker**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-20T11:50:00Z
- **Completed:** 2026-03-20T11:58:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Full unit test coverage for DATA-01 through DATA-09: steps, field values with option ID resolution, tags, issues, attachments, version history (copy vs. move), shared step groups, and name collision resolution
- Rollback semantics verified: `deleteMany` called on `createdTargetIds` when any case transaction fails; move source not deleted on failure
- Cancellation verified: pre-start and between-case cancellation stop processing and trigger rollback, cancel key deleted after detection
- ES sync is fire-and-forget: processor resolves even if `syncRepositoryCaseToElasticsearch` throws

## Task Commits

1. **Tasks 1 + 2: Test scaffolding, copy tests, move/rollback/cancellation tests** - `52f8f715` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `testplanit/workers/copyMoveWorker.test.ts` — 1,123-line unit test file covering all behavioral requirements

## Decisions Made

- `mockPrisma.$transaction.mockReset()` added to `beforeEach` — `vi.clearAllMocks()` clears call counts but not `mockImplementation`; rollback tests override `$transaction` to throw on second call, which leaks into subsequent tests without a full reset
- Verified actual worker DB access pattern: `fetchTemplateFields` calls `prisma.templateCaseAssignment.findMany` then `prisma.caseFieldAssignment.findMany` per Dropdown/MultiSelect field — mocks reflect this two-step query
- ES sync test uses `.resolves.toBeDefined()` since `syncRepositoryCaseToElasticsearch(id)` is invoked with `.catch(...)` (fire-and-forget) — processor never awaits it, so rejection does not propagate

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added mockPrisma.$transaction.mockReset() in beforeEach**
- **Found during:** Task 2 (rollback and cancellation tests)
- **Issue:** The rollback tests use `mockPrisma.$transaction.mockImplementation` to make the second call throw. Without `mockReset()` in `beforeEach`, this implementation leaked into subsequent describe blocks (field option edge cases and ES sync tests), causing those tests to fail with "Move failure"
- **Fix:** Added `mockPrisma.$transaction.mockReset()` followed by `.mockImplementation((fn) => fn(mockTx))` in `beforeEach` so each test starts with a clean default transaction behavior
- **Files modified:** testplanit/workers/copyMoveWorker.test.ts
- **Verification:** All 5038 tests pass after fix
- **Committed in:** 52f8f715 (task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Required for test isolation correctness. No scope creep.

## Issues Encountered

None — worker implementation matched plan spec exactly, making mock setup straightforward.

## Next Phase Readiness

- All DATA-01 through DATA-09 requirements verified by unit tests
- Rollback, cancellation, and source deletion ordering confirmed correct
- Phase 29 (API layer) can proceed — worker behavioral contract is fully specified and tested

---
*Phase: 28-queue-and-worker*
*Completed: 2026-03-20*
