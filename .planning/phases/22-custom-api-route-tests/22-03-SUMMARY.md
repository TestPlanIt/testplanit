---
phase: 22-custom-api-route-tests
plan: 03
subsystem: testing
tags: [vitest, report-builder, api-tests, drill-down, flaky-tests, test-case-health, automation-trends]

# Dependency graph
requires:
  - phase: 19-reporting-e2e-and-component-tests
    provides: report builder E2E tests and component tests establishing route shapes
provides:
  - 6 Vitest unit test files covering report builder API routes (CAPI-06)
  - Auth, validation, and success case coverage for main report builder, drill-down, and 4 pre-built reports
affects:
  - future reporting feature changes must maintain test coverage for these route contracts

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Mock utility wrapper functions (handleReportGET/POST, handleFlakyTestsPOST, etc.) to test route delegation and config
    - Dynamic model access pattern: mock (prisma as any)[modelName] for drill-down tests
    - vi.mock module factory pattern for all prisma/next-auth/utility dependencies

key-files:
  created:
    - testplanit/app/api/report-builder/route.test.ts
    - testplanit/app/api/report-builder/drill-down/route.test.ts
    - testplanit/app/api/report-builder/test-execution/route.test.ts
    - testplanit/app/api/report-builder/flaky-tests/route.test.ts
    - testplanit/app/api/report-builder/test-case-health/route.test.ts
    - testplanit/app/api/report-builder/automation-trends/route.test.ts
  modified: []

key-decisions:
  - "Main report-builder/route.ts has no authentication — tests validate only prisma and schema validation"
  - "Pre-built routes (test-execution, automation-trends) delegate to reportApiUtils handleReportGET/POST — mock the utility to verify delegation and config shape"
  - "flaky-tests and test-case-health delegate to specialized utilities — mock those utilities to test route-level behavior"
  - "Drill-down route has getServerSession auth — test 401/403/400/200 cases including cross-project admin check and passRate aggregate shape"
  - "Dynamic model access in drill-down (prisma as any)[modelName] requires injecting mock models directly onto prisma object in tests"

patterns-established:
  - "Pre-built report route testing: mock the utility handler, assert delegation args (isCrossProject flag, reportType config) and response shapes"
  - "Drill-down dynamic model pattern: inject mockModel via (prisma as any).modelName in beforeEach"

requirements-completed: [CAPI-06]

# Metrics
duration: 3min
completed: 2026-03-19
---

# Phase 22 Plan 03: Report Builder Route Tests Summary

**Vitest unit tests for 6 report builder API routes covering auth enforcement, input validation, delegation to utility handlers, and correct response shapes for main builder, drill-down, and 4 pre-built reports**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-19T18:41:17Z
- **Completed:** 2026-03-19T18:44:11Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created comprehensive auth + validation + success coverage for drill-down route (12 tests)
- Created GET/POST coverage for main report-builder route including dimension registry and metric validation (12 tests)
- Created 4 pre-built report test files (24 tests) covering delegation patterns, auth pass-through, projectId validation, and response shapes for test-execution, flaky-tests, test-case-health, and automation-trends

## Task Commits

Each task was committed atomically:

1. **Task 1: Main report builder and drill-down route tests** - `aabc96cc` (test)
2. **Task 2: Pre-built report endpoint route tests** - `23aa4e82` (test)

**Plan metadata:** (pending final commit)

## Files Created/Modified

- `testplanit/app/api/report-builder/route.test.ts` - GET metadata and POST validation/aggregation tests (12 tests)
- `testplanit/app/api/report-builder/drill-down/route.test.ts` - Auth, validation, passRate aggregates, hasMore pagination (12 tests)
- `testplanit/app/api/report-builder/test-execution/route.test.ts` - GET/POST delegation to handleReportGET/POST with config verification (7 tests)
- `testplanit/app/api/report-builder/flaky-tests/route.test.ts` - GET empty schema, POST delegation with flaky data shape (5 tests)
- `testplanit/app/api/report-builder/test-case-health/route.test.ts` - GET empty schema, POST delegation with health metrics shape (5 tests)
- `testplanit/app/api/report-builder/automation-trends/route.test.ts` - GET/POST delegation with trend period data shape (7 tests)

## Decisions Made

- Main report-builder route has no auth — focused tests on schema validation and prisma mock behavior
- Pre-built routes test delegation approach (mock utility, verify isCrossProject flag and config) rather than re-testing utility logic
- Drill-down dynamic model access pattern requires injecting mock directly onto prisma object
- GET /flaky-tests and GET /test-case-health return hardcoded empty arrays — simple assertion, no utility mock needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- All CAPI-06 report builder route tests complete (48 tests across 6 files, all passing)
- Phase 22 plan 03 delivers final planned coverage for report builder API routes

---
*Phase: 22-custom-api-route-tests*
*Completed: 2026-03-19*
