---
phase: 19-reporting-e2e-and-component-tests
plan: "01"
subsystem: reporting-e2e
tags: [e2e, reports, report-builder, drill-down, forecasting, RPT-01, RPT-02, RPT-03, RPT-05]
dependency_graph:
  requires: []
  provides: [RPT-01-coverage, RPT-02-coverage, RPT-03-coverage, RPT-05-coverage]
  affects: [reports-e2e]
tech_stack:
  added: []
  patterns: [url-param-navigation, incognito-context-auth-test, lenient-result-assertion]
key_files:
  created:
    - testplanit/e2e/tests/reports/report-builder-types.spec.ts
    - testplanit/e2e/tests/reports/drill-down-and-forecasting.spec.ts
  modified: []
decisions:
  - "Drill-down API returns { data, total, hasMore, context } not { records, total } - updated assertions to accept either shape"
  - "E2E unauthenticated tests use storageState: { cookies: [], origins: [] } pattern (not storageState: undefined) to avoid auth cookie inheritance"
  - "E2E server runs on port 3002 - incognito context requests must use process.env.E2E_BASE_URL or http://localhost:3002"
metrics:
  duration: "~35 min"
  completed_date: "2026-03-19"
  tasks: 2
  files_created: 2
---

# Phase 19 Plan 01: Reporting E2E Tests Summary

Report builder E2E tests for multiple report types (RPT-01), pre-built reports (RPT-02), drill-down (RPT-03), and forecasting API (RPT-05), using URL param navigation and lenient result assertions.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Report builder multi-type and pre-built reports E2E | 9c485fa2 | testplanit/e2e/tests/reports/report-builder-types.spec.ts |
| 2 | Drill-down and forecasting E2E tests | ccf3f7c4 | testplanit/e2e/tests/reports/drill-down-and-forecasting.spec.ts |

## What Was Built

### Task 1: report-builder-types.spec.ts (7 tests)

Covers RPT-01 (configurable report builder) and RPT-02 (pre-built reports):

- **automation-trends** report loads and runs (pre-built type)
- **test-execution** report with status dimension + testCaseCount metric
- **flaky-tests** report loads and runs (pre-built type)
- **test-case-health** report loads and runs (pre-built type)
- **repository-stats** with folder dimension + testCaseCount metric shows table results
- Pre-built report type selector (`data-testid="report-type-select"`) is visible on reports page
- URL params (dimensions, metrics) persist on page reload and auto-run

### Task 2: drill-down-and-forecasting.spec.ts (7 tests)

Covers RPT-03 (drill-down) and RPT-05 (forecasting):

**Drill-down (RPT-03):**
- Clicking a `cursor-pointer` metric cell in the report results table opens the DrillDownDrawer (`role="dialog"`)
- Drill-down API (`POST /api/report-builder/drill-down`) responds with `{ data, total, hasMore, context }` for valid contexts
- Drill-down API rejects unauthenticated requests with 401

**Forecasting (RPT-05):**
- `POST /api/repository-cases/forecast` returns correct shape `{ manualEstimate, mixedEstimate, automatedEstimate, areAllCasesAutomated, fetchedTestCasesCount }` for valid case IDs
- Empty caseIds array returns 400 (schema validation)
- Non-existent case IDs return 200 with zero counts
- Invalid request body returns 400

## Test Results

All 14 new tests pass. The 9 existing `repository-stats-test-case-dimension.spec.ts` tests continue to pass. Total report test suite: 23 passing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Drill-down API response shape mismatch**
- **Found during:** Task 2 initial test run
- **Issue:** Plan specified asserting `body.records` but API returns `body.data` (the actual property is `data` not `records`)
- **Fix:** Updated assertion to accept either `records` or `data` array property and use `body.records ?? body.data`
- **Files modified:** testplanit/e2e/tests/reports/drill-down-and-forecasting.spec.ts
- **Commit:** ccf3f7c4

**2. [Rule 1 - Bug] Unauthenticated test using hardcoded port 3000**
- **Found during:** Task 2 initial test run (ECONNREFUSED ::1:3000)
- **Issue:** Initial implementation used `localhost:3000` but E2E server runs on port 3002
- **Fix:** Changed to use `process.env.E2E_BASE_URL || "http://localhost:3002"` and correct `storageState: { cookies: [], origins: [] }` pattern
- **Files modified:** testplanit/e2e/tests/reports/drill-down-and-forecasting.spec.ts
- **Commit:** ccf3f7c4

## Self-Check: PASSED
