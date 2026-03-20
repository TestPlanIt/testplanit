---
phase: 29-api-endpoints-and-access-control
plan: "02"
subsystem: api
tags: [bullmq, job-management, copy-move, status, cancel, multi-tenant, redis]
dependency_graph:
  requires:
    - 28-01: copyMoveWorker (cancelKey pattern copy-move:cancel:{jobId})
    - lib/queues: getCopyMoveQueue
  provides:
    - GET /api/repository/copy-move/status/[jobId]
    - POST /api/repository/copy-move/cancel/[jobId]
  affects:
    - Phase 30 UI: polls status endpoint, triggers cancel endpoint
tech_stack:
  added: []
  patterns:
    - BullMQ job.getState() + returnvalue polling pattern
    - Redis cancel-flag pattern for graceful active-job cancellation
    - Multi-tenant isolation on job data (tenantId check)
    - Per-submitter authorization (userId check on cancel)
key_files:
  created:
    - testplanit/app/api/repository/copy-move/status/[jobId]/route.ts
    - testplanit/app/api/repository/copy-move/status/[jobId]/route.test.ts
    - testplanit/app/api/repository/copy-move/cancel/[jobId]/route.ts
    - testplanit/app/api/repository/copy-move/cancel/[jobId]/route.test.ts
  modified: []
decisions:
  - Cancel key uses prefix 'copy-move:cancel:' (not 'auto-tag:cancel:') to match copyMoveWorker.ts cancelKey()
  - Cancel message reads "job will stop after current case" (not "batch") to match copy-move semantics
  - Active job cancellation uses Redis flag (not job.remove()) to allow graceful per-case boundary stops
metrics:
  duration: 9m
  completed: "2026-03-20"
  tasks_completed: 2
  files_created: 4
  files_modified: 0
  tests_added: 15
requirements_satisfied: [BULK-03]
---

# Phase 29 Plan 02: Status and Cancel Endpoints Summary

Status and cancel API endpoints for copy-move BullMQ jobs — direct adaptation of the auto-tag pattern with correct queue getter and Redis cancel key prefix.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create status polling endpoint | 81758fd1 | route.ts, route.test.ts |
| 2 | Create cancel endpoint | d4eca333 | route.ts, route.test.ts |

## What Was Built

**GET /api/repository/copy-move/status/[jobId]**
- Polls BullMQ for job state, progress, result, failedReason, and timestamps
- Multi-tenant isolation: returns 404 if job.data.tenantId !== currentTenantId
- Returns parsed `returnvalue` object for completed jobs (handles string vs object BullMQ quirk)
- Uses `getCopyMoveQueue()` exclusively

**POST /api/repository/copy-move/cancel/[jobId]**
- Authorization: only the job submitter (job.data.userId === session.user.id) can cancel
- Multi-tenant isolation: same tenantId check as status endpoint
- Waiting/delayed jobs: removed directly via `job.remove()`
- Active jobs: sets Redis key `copy-move:cancel:{jobId}` with 1-hour TTL for worker to pick up
- Already-finished jobs return informational 200 (not an error)

## Decisions Made

- **Cancel key prefix**: `copy-move:cancel:` matches `cancelKey()` in `workers/copyMoveWorker.ts` exactly. Using a different prefix would silently break cancellation for active jobs.
- **Cancel message**: "job will stop after current case" communicates the per-case granularity of copy-move operations (vs auto-tag's per-batch model).
- **No new abstractions**: both routes are intentionally thin — same pattern as auto-tag endpoints, different queue and key prefix only.

## Test Coverage

| File | Tests |
|------|-------|
| status/[jobId]/route.test.ts | 7 |
| cancel/[jobId]/route.test.ts | 8 |
| **Total** | **15** |

All 15 tests pass. Full test suite: 302 files / 5069 tests passing.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

Files exist:
- testplanit/app/api/repository/copy-move/status/[jobId]/route.ts: FOUND
- testplanit/app/api/repository/copy-move/status/[jobId]/route.test.ts: FOUND
- testplanit/app/api/repository/copy-move/cancel/[jobId]/route.ts: FOUND
- testplanit/app/api/repository/copy-move/cancel/[jobId]/route.test.ts: FOUND

Commits exist:
- 81758fd1: FOUND
- d4eca333: FOUND

## Self-Check: PASSED
