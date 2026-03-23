---
phase: 48-async-project-wide-scan
plan: "01"
subsystem: workers
tags: [bullmq, duplicate-detection, worker, redis, cancellation]
dependency_graph:
  requires:
    - testplanit/lib/services/duplicateScanService.ts
    - testplanit/lib/queueNames.ts
    - testplanit/lib/multiTenantPrisma.ts
    - testplanit/lib/valkey.ts
    - testplanit/services/elasticsearchService.ts
  provides:
    - DuplicateScanJobData interface
    - DuplicateScanJobResult interface
    - startDuplicateScanWorker function
    - BullMQ worker for duplicate-scan queue
  affects:
    - testplanit/scripts/build-workers.js
    - testplanit/package.json
tech_stack:
  added: []
  patterns:
    - BullMQ worker with concurrency:1 to prevent overlapping scans
    - Set-based deduplication of caseAId:caseBId pairs
    - Redis cancellation key pattern (duplicate-scan:cancel:<jobId>)
    - Separate deleteMany + createMany (no transaction — avoids timeout on large sets)
key_files:
  created:
    - testplanit/workers/duplicateScanWorker.ts
    - testplanit/workers/duplicateScanWorker.test.ts
  modified:
    - testplanit/scripts/build-workers.js
    - testplanit/package.json
decisions:
  - "No $transaction() wrapping deleteMany+createMany — can timeout on large sets"
  - "concurrency: 1 enforced at worker level — prevents overlapping scans for same project"
  - "Shallow select on repositoryCases (id, name only) — avoids ZenStack v3 alias limit"
  - "getElasticsearchClient() called per-job, not cached — worker isolation pattern"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-03-23"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
---

# Phase 48 Plan 01: Duplicate Scan Worker Summary

**One-liner:** BullMQ worker with Set-based pair deduplication, Redis cancellation, progress reporting, and skipDuplicates createMany for the duplicate-scan queue.

## What Was Built

A production-ready BullMQ worker processor for project-wide duplicate test case scanning. The worker:

1. Validates multi-tenant context and gets the appropriate Prisma client
2. Checks Redis for a pre-start cancellation key
3. Fetches all non-deleted `repositoryCases` for the project (shallow select: id, name only)
4. Iterates each case, checking cancellation mid-loop, calling `DuplicateScanService.findSimilarCases()`
5. Deduplicates pairs via a `Set<string>` keyed by `caseAId:caseBId`
6. Reports progress via `job.updateProgress({ analyzed, total })` after each case
7. Sorts all accumulated pairs by score descending, caps at 100
8. Deletes previous scan results for the project, then bulk-inserts new results with `skipDuplicates: true`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create duplicateScanWorker with tests (TDD) | 0b49a6bc | workers/duplicateScanWorker.ts, workers/duplicateScanWorker.test.ts |
| 2 | Register worker in build system and package.json | 3b542d8a | scripts/build-workers.js, package.json |

## Test Coverage

8 unit tests covering:
- Processor fetches non-deleted cases and returns correct counts (Test 1)
- Duplicate pair deduplication — same caseAId:caseBId key kept once (Test 2)
- Results capped at 100 pairs sorted by score descending (Test 3)
- deleteMany called before createMany with correct projectId (Test 4)
- job.updateProgress called with {analyzed: i+1, total} per case (Test 5)
- Pre-start cancellation check throws "Job cancelled by user" (Test 6)
- Mid-loop cancellation check throws and stops processing (Test 7)
- createMany uses skipDuplicates: true (Test 8)

## Decisions Made

- **No $transaction()**: `deleteMany` + `createMany` run separately to avoid timeouts on large case sets (>1000 cases)
- **concurrency: 1**: Enforced at worker level so two scans for the same project cannot run simultaneously
- **Shallow case select**: Only `id` and `name` fetched to avoid ZenStack v3 alias limit issues (no nested relations)
- **skipDuplicates: true**: Safety net against the `@@unique(caseAId, caseBId, projectId)` constraint on `DuplicateScanResult`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong import name for Elasticsearch client**
- **Found during:** Task 1 implementation
- **Issue:** Plan specified `getElasticClient` from `~/services/elasticsearchService`, but the actual exported function name is `getElasticsearchClient`
- **Fix:** Used `getElasticsearchClient` (correct name) in the import
- **Files modified:** workers/duplicateScanWorker.ts

**2. [Rule 1 - Bug] copyMoveWorker.ts inadvertently added to build-workers.js**
- **Found during:** Task 2 (build script edit)
- **Issue:** Initial edit accidentally inserted `copyMoveWorker.ts` entry (which was not in the original build script)
- **Fix:** Removed the erroneous `copyMoveWorker.ts` entry immediately; only `duplicateScanWorker.ts` added
- **Files modified:** scripts/build-workers.js

## Self-Check: PASSED

- [x] `testplanit/workers/duplicateScanWorker.ts` exists
- [x] `testplanit/workers/duplicateScanWorker.test.ts` exists (174 lines, 8 tests)
- [x] All 8 tests pass: `pnpm test workers/duplicateScanWorker.test.ts`
- [x] `grep "DUPLICATE_SCAN_QUEUE_NAME" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "findSimilarCases" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "deleteMany" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "createMany" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "skipDuplicates" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "duplicate-scan:cancel" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "updateProgress" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "concurrency: 1" testplanit/workers/duplicateScanWorker.ts` — match
- [x] `grep "duplicateScanWorker.ts" testplanit/scripts/build-workers.js` — match
- [x] `grep '"worker:duplicate-scan"' testplanit/package.json` — match containing `dotenv -- tsx workers/duplicateScanWorker.ts`
- [x] `grep '"workers"' testplanit/package.json` — line contains `worker:duplicate-scan`
- [x] Commit 0b49a6bc exists
- [x] Commit 3b542d8a exists
