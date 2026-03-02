---
phase: 02-alert-service-and-pipeline
plan: 02
subsystem: infra
tags: [bullmq, valkey, worker, queue, i18n]

# Dependency graph
requires:
  - phase: 02-alert-service-and-pipeline/01
    provides: BudgetAlertService with checkAndAlert method
  - phase: 01-schema-foundation
    provides: LlmProviderConfig schema with alertThresholdsFired field
provides:
  - BUDGET_ALERT_QUEUE_NAME constant in queueNames.ts
  - getBudgetAlertQueue() lazy-init function in queues.ts
  - budgetAlertWorker.ts BullMQ worker processing check-budget jobs
  - worker:budget-alert npm script and PM2 config
  - budgetAlert i18n keys under admin.llm for Phase 3 UI
affects: [02-alert-service-and-pipeline/03, 03-ui-and-enqueue]

# Tech tracking
tech-stack:
  added: []
  patterns: [budget-alert-worker follows auditLogWorker pattern exactly]

key-files:
  created:
    - testplanit/workers/budgetAlertWorker.ts
  modified:
    - testplanit/lib/queueNames.ts
    - testplanit/lib/queues.ts
    - testplanit/package.json
    - testplanit/ecosystem.config.js
    - testplanit/messages/en-US.json

key-decisions:
  - "Worker concurrency set to 5 (lower than auditLog's 10) since budget checks are less frequent but do more work per job"
  - "7-day completed job retention matches standard queue pattern (not audit log's 1-year retention)"

patterns-established:
  - "Budget alert worker: follows auditLogWorker template with BudgetAlertService injection via getPrismaClientForJob"

requirements-completed: [CHCK-03]

# Metrics
duration: 5min
completed: 2026-03-02
---

# Phase 2 Plan 2: Queue and Worker Registration Summary

**BullMQ budget-alerts queue with lazy-init, budgetAlertWorker processing check-budget jobs via BudgetAlertService, PM2 config, and i18n keys for Phase 3 UI**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-02T12:00:35Z
- **Completed:** 2026-03-02T12:05:44Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Registered budget-alerts queue in queueNames.ts and queues.ts with lazy initialization and standard job options
- Created budgetAlertWorker.ts following the established auditLogWorker pattern with multi-tenant support
- Updated package.json scripts and PM2 ecosystem config for deployment readiness
- Added budgetAlert i18n keys under admin.llm for Phase 3 UI consumption

## Task Commits

Each task was committed atomically:

1. **Task 1: Register budget-alerts queue in queueNames.ts and queues.ts** - `c0de984` (feat)
2. **Task 2: Create budgetAlertWorker.ts and register in package.json, ecosystem.config.js, and add i18n keys** - `38fec0e` (feat)

## Files Created/Modified
- `testplanit/lib/queueNames.ts` - Added BUDGET_ALERT_QUEUE_NAME constant
- `testplanit/lib/queues.ts` - Added getBudgetAlertQueue() function and updated getAllQueues()
- `testplanit/workers/budgetAlertWorker.ts` - New BullMQ worker for budget alert check jobs
- `testplanit/package.json` - Added worker:budget-alert script, updated workers script
- `testplanit/ecosystem.config.js` - Added budget-alert-worker PM2 entry
- `testplanit/messages/en-US.json` - Added budgetAlert i18n keys (budgetDisclaimer, spendLabel, etc.)

## Decisions Made
- Worker concurrency set to 5 (vs auditLog's 10) since budget checks involve more DB work per job but are less frequent
- 7-day completed job retention matches the standard queue pattern; budget checks don't need audit-log-level retention

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Queue infrastructure ready for Plan 02-03 to enqueue budget-check jobs after LLM usage
- Worker will process jobs as soon as they appear in the budget-alerts queue
- i18n keys ready for Phase 3 UI to display budget disclaimers and spend labels

## Self-Check: PASSED

All 7 files verified present. Both task commits (c0de984, 38fec0e) confirmed in git log.

---
*Phase: 02-alert-service-and-pipeline*
*Completed: 2026-03-02*
