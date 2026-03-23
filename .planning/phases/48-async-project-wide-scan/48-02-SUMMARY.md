---
phase: 48-async-project-wide-scan
plan: 02
subsystem: api-routes
tags: [duplicate-scan, bullmq, cursor-pagination, api]
dependency_graph:
  requires: [48-01]
  provides: [duplicate-scan-api]
  affects: [duplicate-scan-ui]
tech_stack:
  added: []
  patterns: [auto-tag-route-mirror, cursor-pagination, redis-cancel-flag]
key_files:
  created:
    - testplanit/app/api/duplicate-scan/submit/route.ts
    - testplanit/app/api/duplicate-scan/status/[jobId]/route.ts
    - testplanit/app/api/duplicate-scan/cancel/[jobId]/route.ts
    - testplanit/app/api/duplicate-scan/candidates/route.ts
  modified: []
decisions:
  - Raw prisma client used in candidates route to avoid ZenStack 63-char alias issue with DuplicateScanResult relations
  - Duplicate job prevention in submit route uses getJobs(["active", "waiting"]) filtered by projectId
  - Redis cancel key prefix set to duplicate-scan:cancel: (mirrors auto-tag:cancel: pattern)
metrics:
  duration: ~8 minutes
  completed: 2026-03-23
  tasks_completed: 2
  files_created: 4
  files_modified: 0
---

# Phase 48 Plan 02: Duplicate Scan API Routes Summary

Four Next.js App Router API routes implementing the duplicate scan feature, mirroring the auto-tag queue pattern with project-scoped duplicate job prevention and cursor-paginated result retrieval.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Submit, status, cancel API routes | 29aaca55 | Done |
| 2 | Candidates route with cursor pagination | 89ec08cd | Done |

## What Was Built

### Submit Route (`app/api/duplicate-scan/submit/route.ts`)
- POST handler with session auth and Zod validation (`{ projectId: z.number() }`)
- Checks for existing active/waiting jobs for same projectId before enqueuing — prevents duplicate concurrent scans
- Enqueues `scan-project` job with `{ projectId, userId, tenantId }` via `getDuplicateScanQueue()`
- Returns `{ jobId }` — or existing jobId if duplicate found

### Status Route (`app/api/duplicate-scan/status/[jobId]/route.ts`)
- GET handler returning `{ jobId, state, progress, result, failedReason, timestamp, processedOn, finishedOn }`
- Multi-tenant isolation: compares job tenantId against current tenant, 404 if mismatch
- Handles BullMQ returnvalue as string or object

### Cancel Route (`app/api/duplicate-scan/cancel/[jobId]/route.ts`)
- POST handler with ownership check (userId must match job submitter)
- Waiting/delayed jobs: `job.remove()` for immediate cancellation
- Active jobs: sets `duplicate-scan:cancel:${jobId}` Redis flag (EX 3600) for worker polling

### Candidates Route (`app/api/duplicate-scan/candidates/route.ts`)
- GET handler with cursor pagination (`cursor`, `limit` params, default 25, max 100)
- Filters to `{ projectId, isDeleted: false, status: "PENDING" }`
- Orders by `score: "desc"` — highest similarity pairs first
- Includes shallow `caseA` and `caseB` selects (`{ id, name }` only)
- Uses raw `prisma` client (not ZenStack enhanced) to avoid 63-char alias issue
- Returns `{ items, nextCursor }` — nextCursor is null on last page

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `testplanit/app/api/duplicate-scan/submit/route.ts` exists
- [x] `testplanit/app/api/duplicate-scan/status/[jobId]/route.ts` exists
- [x] `testplanit/app/api/duplicate-scan/cancel/[jobId]/route.ts` exists
- [x] `testplanit/app/api/duplicate-scan/candidates/route.ts` exists
- [x] Commit 29aaca55 exists
- [x] Commit 89ec08cd exists

## Self-Check: PASSED
