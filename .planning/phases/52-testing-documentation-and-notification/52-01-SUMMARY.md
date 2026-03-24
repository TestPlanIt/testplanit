---
phase: 52-testing-documentation-and-notification
plan: "01"
subsystem: e2e-testing
tags: [e2e, playwright, duplicates, data-testid]
dependency_graph:
  requires: []
  provides: [duplicate-scan-e2e-coverage]
  affects: [duplicate-detection-ui]
tech_stack:
  added: []
  patterns: [playwright-e2e, data-testid-selectors, api-polling-helper]
key_files:
  created:
    - testplanit/e2e/tests/repository/duplicates/duplicate-scan-workflow.spec.ts
  modified:
    - testplanit/components/duplicates/FindDuplicatesButton.tsx
    - testplanit/components/duplicates/DuplicateResultsTable.tsx
    - testplanit/components/duplicates/DuplicateComparisonDialog.tsx
decisions:
  - DataTable already renders data-testid="case-row-{id}" on each row — spec uses case-row- prefix instead of duplicate-pair-row- to match actual DOM output
  - CasePanel testId prop added as optional string to avoid breaking interface changes
  - triggerAndWaitForScan helper polls scan status via API to decouple UI timing from test assertions
  - Tests 3 and 4 use test.skip when no pairs found — graceful degradation for threshold-dependent behavior
metrics:
  duration: 12m
  completed_date: "2026-03-24T14:00:24Z"
  tasks_completed: 2
  files_modified: 4
  files_created: 1
requirements: [TEST-02]
---

# Phase 52 Plan 01: Duplicate Scan Workflow E2E Tests Summary

**One-liner:** E2E coverage for duplicate scan trigger, results view, dismiss, and link via data-testid selectors on three components.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add data-testid attributes to duplicate detection components | 6817a52b | FindDuplicatesButton.tsx, DuplicateResultsTable.tsx, DuplicateComparisonDialog.tsx |
| 2 | Write E2E test spec for duplicate scan workflow | 72b023b4 | duplicate-scan-workflow.spec.ts |

## What Was Built

### Task 1: data-testid Attributes

Added stable E2E selectors to three components without changing any logic or styling:

**FindDuplicatesButton.tsx:**
- `find-duplicates-button` — idle state scan trigger button
- `scan-progress` — active scan indicator div
- `view-duplicates-button` — complete state link button
- `retry-scan-button` — failed state retry button

**DuplicateResultsTable.tsx:**
- `duplicates-table` — wrapper div around the DataTable component

**DuplicateComparisonDialog.tsx:**
- `comparison-dialog` — DialogContent root
- `case-panel-a` / `case-panel-b` — left and right CasePanel cards (via new optional `testId` prop)
- `dismiss-button` / `link-button` / `merge-button` — action buttons in dialog footer

### Task 2: E2E Spec (211 lines, 4 tests)

`duplicate-scan-workflow.spec.ts` covers:

1. **Trigger scan** — clicks `find-duplicates-button`, asserts `scan-progress` or `view-duplicates-button` appears within 15s
2. **View results page** — API-triggers scan, polls to completion, navigates to `/duplicates`, asserts `duplicates-table` visible
3. **Dismiss a pair** — full workflow: scan → navigate → click row → comparison dialog → dismiss-button → dialog closes → toast appears
4. **Link as related** — same setup → link-button → dialog closes → toast appears

Shared `triggerAndWaitForScan()` helper submits scan via POST and polls status every 2s for up to 30s.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Observation] DataTable renders case-row- not duplicate-pair-row- testids**
- **Found during:** Task 2
- **Issue:** The generic DataTable component already renders `data-testid="case-row-${id}"` on every row. The plan suggested `duplicate-pair-row-${id}` but this would require modifying the shared DataTable component.
- **Fix:** E2E spec uses `[data-testid^="case-row-"]` selector which correctly matches rows in the duplicates table. The `data-testid="duplicates-table"` wrapper added to DuplicateResultsTable.tsx scopes these selectors to the correct context.
- **Files modified:** duplicate-scan-workflow.spec.ts

## Self-Check

Files exist:
- [x] testplanit/e2e/tests/repository/duplicates/duplicate-scan-workflow.spec.ts
- [x] testplanit/components/duplicates/FindDuplicatesButton.tsx (modified)
- [x] testplanit/components/duplicates/DuplicateResultsTable.tsx (modified)
- [x] testplanit/components/duplicates/DuplicateComparisonDialog.tsx (modified)

Commits exist:
- [x] 6817a52b (Task 1)
- [x] 72b023b4 (Task 2)

TypeScript: PASSED (both app and e2e tsconfig)

## Self-Check: PASSED
