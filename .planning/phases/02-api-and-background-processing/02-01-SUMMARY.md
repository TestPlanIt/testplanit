---
phase: 02-api-and-background-processing
plan: 01
subsystem: api
tags: [bullmq, redis, workers, llm, auto-tag, background-processing]

requires:
  - phase: 01-llm-tag-analysis
    provides: TagAnalysisService, LlmManager, PromptResolver, auto-tag types

provides:
  - AUTO_TAG_QUEUE_NAME constant and getAutoTagQueue lazy singleton
  - autoTagWorker with multi-tenant support, progress reporting, and cancellation
  - AutoTagJobData and AutoTagJobResult exported types for API routes
  - LlmManager.createForWorker() factory for per-tenant worker instances
  - TagAnalysisService onBatchComplete callback for progress tracking

affects: [02-02-api-routes, auto-tag-ui]

tech-stack:
  added: []
  patterns:
    - "Worker progress reporting via onBatchComplete callback + job.updateProgress"
    - "Redis key-based cancellation pattern (auto-tag:cancel:{jobId})"
    - "Per-tenant LlmManager via createForWorker factory (bypasses singleton)"

key-files:
  created:
    - testplanit/workers/autoTagWorker.ts
  modified:
    - testplanit/lib/llm/services/auto-tag/tag-analysis.service.ts
    - testplanit/lib/llm/services/auto-tag/tag-analysis.service.test.ts
    - testplanit/lib/llm/services/llm-manager.service.ts
    - testplanit/lib/queueNames.ts
    - testplanit/lib/queues.ts
    - testplanit/scripts/build-workers.js
    - testplanit/package.json

key-decisions:
  - "Redis key cancellation pattern for async job abort between batches"
  - "Worker concurrency 1 since LLM calls are the bottleneck"
  - "24hr completed TTL, 7d failed TTL for auto-tag queue"

patterns-established:
  - "onBatchComplete callback pattern for service-level progress reporting"
  - "createForWorker factory pattern to bypass LlmManager singleton in multi-tenant workers"

requirements-completed: [API-01, API-02]

duration: 6min
completed: 2026-03-07
---

# Phase 02 Plan 01: Queue Infrastructure and Worker Summary

**BullMQ auto-tag queue with progress-reporting worker, Redis-based cancellation, and multi-tenant LlmManager factory**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-07T10:31:10Z
- **Completed:** 2026-03-07T10:37:02Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- TagAnalysisService enhanced with onBatchComplete callback for per-batch progress reporting (called even on batch failure for accurate progress tracking)
- LlmManager.createForWorker() static factory added to bypass singleton pattern for multi-tenant worker isolation
- Auto-tag queue registered following existing lazy-singleton pattern with 24hr/7d TTL configuration
- Full-featured BullMQ worker with multi-tenant Prisma routing, progress updates via job.updateProgress, and Redis key-based cancellation between batches

## Task Commits

Each task was committed atomically:

1. **Task 1: Add onBatchComplete callback and createForWorker factory** - `8b5a309` (feat)
2. **Task 2: Register queue, create worker, configure build pipeline** - `a40f97f` (feat)

## Files Created/Modified
- `testplanit/workers/autoTagWorker.ts` - BullMQ worker with multi-tenant support, progress, cancellation
- `testplanit/lib/llm/services/auto-tag/tag-analysis.service.ts` - Added onBatchComplete callback to analyzeTags
- `testplanit/lib/llm/services/auto-tag/tag-analysis.service.test.ts` - New tests for callback progress and failure scenarios
- `testplanit/lib/llm/services/llm-manager.service.ts` - Added createForWorker static factory
- `testplanit/lib/queueNames.ts` - AUTO_TAG_QUEUE_NAME constant
- `testplanit/lib/queues.ts` - getAutoTagQueue lazy singleton and re-export
- `testplanit/scripts/build-workers.js` - autoTagWorker entry point
- `testplanit/package.json` - worker:auto-tag script and workers concurrently command

## Decisions Made
- Used Redis key-based cancellation (auto-tag:cancel:{jobId}) checked between batches, allowing graceful abort without killing the worker process
- Worker concurrency set to 1 since LLM API calls are the bottleneck and parallelism would not improve throughput
- onBatchComplete callback placed AFTER try/catch per batch so progress reports even on failed batches (per-batch error isolation)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial test for onBatchComplete with 2 batches used entities that were too small to force batch splitting. Fixed by using long entity names (6000 chars each) to exceed the token budget per batch.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Queue infrastructure ready for Plan 02 to add API routes that enqueue jobs and poll status
- AutoTagJobData and AutoTagJobResult types exported for API route consumption
- Worker progress format ({ analyzed, total }) ready for SSE/polling endpoints

## Self-Check: PASSED

All 6 key files verified present. Both task commits (8b5a309, a40f97f) verified in git log.

---
*Phase: 02-api-and-background-processing*
*Completed: 2026-03-07*
