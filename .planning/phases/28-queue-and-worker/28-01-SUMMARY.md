---
phase: 28-queue-and-worker
plan: "01"
subsystem: workers
tags: [bullmq, worker, copy-move, queue, prisma-transaction]
dependency_graph:
  requires: []
  provides:
    - COPY_MOVE_QUEUE_NAME constant (lib/queueNames.ts)
    - getCopyMoveQueue lazy initializer (lib/queues.ts)
    - copyMoveWorker processor (workers/copyMoveWorker.ts)
    - worker:copy-move npm script (package.json)
  affects:
    - lib/queues.ts (getAllQueues extended)
    - package.json (workers concurrently command extended)
tech_stack:
  added: []
  patterns:
    - BullMQ Worker with concurrency:1 and attempts:1 for idempotency
    - Per-case prisma.$transaction for all-or-nothing semantics
    - Shared step group deduplication via in-memory Map across cases
    - Separate ES sync pass after all transactions committed
    - Separate version fetch to avoid PostgreSQL 63-char alias limit
key_files:
  created:
    - testplanit/workers/copyMoveWorker.ts
  modified:
    - testplanit/lib/queueNames.ts
    - testplanit/lib/queues.ts
    - testplanit/package.json
decisions:
  - attempts:1 on queue — partial retry creates duplicate cases; surface failures cleanly
  - concurrency:1 on worker — prevents ZenStack v3 deadlocks (40P01)
  - resolveSharedStepGroup uses in-memory Map for deduplication across source cases
  - Version history fetched separately per source case before main loop to avoid 63-char alias
  - Template fields fetched separately per field for Dropdown/MultiSelect to avoid deep nesting
  - Rollback via deleteMany on createdTargetIds — cascade handles all child rows
  - Move soft-deletes source cases ONLY after all copies succeed
  - Cross-project RepositoryCaseLink rows dropped silently (droppedLinkCount reported)
metrics:
  duration: "3m 32s"
  completed: "2026-03-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 3
---

# Phase 28 Plan 01: Queue and Worker Infrastructure Summary

BullMQ queue constant, lazy initializer, and full copy/move worker processor for cross-project test case operations with all data carry-over, shared step group recreation, and rollback-on-failure semantics.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Register copy-move queue infrastructure | 42ccfd45 | lib/queueNames.ts, lib/queues.ts, package.json |
| 2 | Implement copyMoveWorker processor | de8b993b | workers/copyMoveWorker.ts |

## What Was Built

### Task 1: Queue infrastructure
- Added `COPY_MOVE_QUEUE_NAME = "copy-move"` to `lib/queueNames.ts`
- Added `getCopyMoveQueue()` lazy initializer to `lib/queues.ts` with `attempts: 1` (no retry — partial retries create duplicate cases)
- Re-exported `COPY_MOVE_QUEUE_NAME` from `lib/queues.ts`
- Added `copyMoveQueue: getCopyMoveQueue()` to `getAllQueues()` return object
- Added `"worker:copy-move": "dotenv -- tsx workers/copyMoveWorker.ts"` to package.json scripts
- Appended `"pnpm worker:copy-move"` to the `workers` concurrently command

### Task 2: Worker processor (661 lines)
The `workers/copyMoveWorker.ts` processor handles:
- **DATA-01** (steps): Per-step creation with sharedStepGroupId resolution
- **DATA-02** (field values): Dropdown/MultiSelect option ID resolution by name via `resolveFieldValue`; values dropped if no target match
- **DATA-03** (tags): Connected by global tag ID
- **DATA-04** (issues): Connected by global issue ID
- **DATA-05** (attachments): New DB rows pointing to same URLs — no re-upload
- **DATA-06** (move versions): All `RepositoryCaseVersions` rows re-created with `repositoryCaseId = newCase.id` and `projectId` updated to target
- **DATA-07** (copy version): Single version 1 via `createTestCaseVersionInTransaction`
- **DATA-08** (shared step groups): `resolveSharedStepGroup` recreates proper `SharedStepGroup` + `SharedStepItem` rows in target project
- **DATA-09** (name collision): `sharedStepGroupResolution: "reuse" | "create_new"` applied; `create_new` appends `(copy)` suffix

Additional behaviors:
- In-memory `sharedGroupMap` deduplicates: multiple source cases referencing the same group produce exactly one target group
- `folderMaxOrder` pre-fetched before the loop (not inside transaction) to avoid race condition
- Version history fetched separately from main query to avoid PostgreSQL 63-char alias limit
- Template field options fetched separately per field for same reason
- `prisma.$transaction` per case for isolation; rollback via `deleteMany(createdTargetIds)` on any failure
- Move soft-deletes source cases only after all target copies confirmed
- Redis cancellation checked between cases via `cancelKey(jobId)`
- Elasticsearch sync is a bulk post-loop pass (not per-case inside transaction)
- `concurrency: 1` (locked to prevent ZenStack v3 deadlocks)

## Requirements Satisfied

| ID | Description | Status |
|----|-------------|--------|
| DATA-01 | Steps carried over with shared step group recreation | DONE |
| DATA-02 | Custom field values with option ID resolution | DONE |
| DATA-03 | Tags connected by global ID | DONE |
| DATA-04 | Issues connected by global ID | DONE |
| DATA-05 | Attachments by URL reference (no re-upload) | DONE |
| DATA-06 | Move preserves full version history | DONE |
| DATA-07 | Copy starts at version 1 with fresh history | DONE |
| DATA-08 | Shared step groups recreated in target project | DONE |
| DATA-09 | User-chosen resolution for name collisions | DONE |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `testplanit/workers/copyMoveWorker.ts` exists (661 lines, >200 minimum)
- `testplanit/lib/queueNames.ts` contains `COPY_MOVE_QUEUE_NAME`
- `testplanit/lib/queues.ts` contains `getCopyMoveQueue` (2 occurrences)
- `testplanit/package.json` contains `worker:copy-move`
- Commits 42ccfd45 and de8b993b present in git log
