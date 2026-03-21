---
phase: quick
plan: 260321-fk3
subsystem: workers
tags: [audit-log, bullmq, workers, testmo, sync, forecast, captureAuditEvent]

# Dependency graph
requires:
  - phase: workers
    provides: copyMoveWorker captureAuditEvent pattern
provides:
  - Audit trail coverage for testmoImportWorker, syncWorker, forecastWorker
affects: [audit-log, workers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "captureAuditEvent best-effort pattern: always .catch(() => {}) so audit failures never block worker jobs"

key-files:
  created: []
  modified:
    - testplanit/workers/testmoImportWorker.ts
    - testplanit/workers/syncWorker.ts
    - testplanit/workers/forecastWorker.ts

key-decisions:
  - "One summary BULK_CREATE event per Testmo import (not per-entity) because imports create thousands of records"
  - "jobId (string param) used in testmoImportWorker, not job.id (BullMQ Job not in scope inside processImportMode)"
  - "Workers use best-effort audit logging: .catch(() => {}) on all captureAuditEvent calls"

patterns-established:
  - "Worker audit pattern: import captureAuditEvent, call with .catch(() => {}) after successful operation"

requirements-completed: [ISSUE-143]

# Metrics
duration: 12min
completed: 2026-03-21
---

# Quick Task 260321-fk3: Add Audit Logging to Workers Summary

**captureAuditEvent calls added to testmoImportWorker (BULK_CREATE), syncWorker (BULK_UPDATE x2, UPDATE x1), and forecastWorker (UPDATE per milestone) following the copyMoveWorker best-effort pattern**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-21T11:15:00Z
- **Completed:** 2026-03-21T11:27:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- testmoImportWorker now emits a single BULK_CREATE audit event on successful import completion, with entityProgress counts and duration in metadata
- syncWorker now emits BULK_UPDATE audit events for sync-issues and sync-project-issues operations, and UPDATE for refresh-issue
- forecastWorker now emits UPDATE audit events for each milestone auto-completed by the JOB_AUTO_COMPLETE_MILESTONES job, including the isCompleted change record
- All three workers import captureAuditEvent from auditLog service; all calls use .catch(() => {}) to ensure audit failures never break worker jobs
- TypeScript type-check passes on all three worker files; all worker unit tests pass

## Task Commits

1. **Task 1: Add audit logging to testmoImportWorker** - `7789c94b` (feat)
2. **Task 2: Add audit logging to syncWorker and forecastWorker** - `849bdf30` (feat)
3. **Task 3: Verify type-checking and run existing worker tests** - `7b37bff0` (fix)

## Files Created/Modified

- `testplanit/workers/testmoImportWorker.ts` - Added captureAuditEvent import and BULK_CREATE call after COMPLETED update in processImportMode
- `testplanit/workers/syncWorker.ts` - Added captureAuditEvent import and three audit calls (sync-issues, sync-project-issues, refresh-issue)
- `testplanit/workers/forecastWorker.ts` - Added captureAuditEvent import and UPDATE call per auto-completed milestone

## Decisions Made

- One summary BULK_CREATE event per Testmo import rather than per-entity events — imports create thousands of records, one summary event with entityProgress counts is correct
- Used `jobId` string parameter in testmoImportWorker rather than `job.id` — the processImportMode function is not a BullMQ processor and doesn't receive the Job object
- All audit calls placed after successful operation completes, before any logging/return — ensures event only fires on success

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect `job.id` reference in testmoImportWorker**
- **Found during:** Task 3 (type-check)
- **Issue:** Plan's code snippet used `job.id` but the completion code lives inside `processImportMode(importJob, jobId, prisma, tenantId)` — a regular async function, not a BullMQ processor. The `job` variable (BullMQ Job) is not in scope there.
- **Fix:** Changed `job.id` to `jobId` (the string parameter already available in the function)
- **Files modified:** testplanit/workers/testmoImportWorker.ts
- **Verification:** TypeScript type-check passes with no worker errors
- **Committed in:** 7b37bff0 (Task 3 fix commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential correction for type safety. No scope creep.

## Issues Encountered

- Pre-existing type errors in `e2e/tests/api/copy-move-endpoints.spec.ts` (unrelated to this task) caused `pnpm type-check` to exit non-zero — verified the three worker files are clean; those E2E test errors are out of scope
- Pre-existing test failures in `Cases.tsx` component tests unrelated to worker changes — forecastWorker.test.ts, syncWorker.test.ts, and testmoImportWorker.test.ts all pass

## Next Phase Readiness

- Audit trail is now complete for all user-visible worker mutations
- autoTagWorker, budgetAlertWorker, repoCacheWorker confirmed excluded (read-only or internal system operations)

---
*Phase: quick*
*Completed: 2026-03-21*
