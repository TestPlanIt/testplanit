---
phase: 49-resolution-engine
plan: 03
subsystem: ui
tags: [react, next-intl, tanstack-query, shadcn, duplicates, dialog]

# Dependency graph
requires:
  - phase: 49-resolution-engine
    provides: resolve API endpoints (/api/duplicate-scan/case-details and /api/duplicate-scan/resolve)
  - phase: 49-resolution-engine
    provides: DuplicateResultsTable with DuplicateCandidateRow type and candidates query
provides:
  - DuplicateComparisonDialog component with side-by-side case details and merge/link/dismiss actions
  - Row click integration in DuplicateResultsTable
  - 34 translation keys under repository.duplicates in en-US.json
affects: [duplicate-resolution-flow, repository-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useQuery for case detail fetching on dialog open with pair-keyed queryKey
    - Survivor selection state pattern for destructive merge action gating
    - onTestCaseClick DataTable prop used for row-level click delegation

key-files:
  created:
    - testplanit/components/duplicates/DuplicateComparisonDialog.tsx
  modified:
    - testplanit/components/duplicates/DuplicateResultsTable.tsx
    - testplanit/messages/en-US.json

key-decisions:
  - "onTestCaseClick DataTable prop used for row click — avoids duplicateColumns.tsx changes"
  - "handleRowClick defined after sortedItems useMemo to resolve dependency order"
  - "Merge button disabled until survivor selected — prevents accidental destructive action"

patterns-established:
  - "Dialog fetches own data via useQuery keyed on pair IDs — parent passes only IDs"
  - "onResolved callback pattern: dialog calls back to parent which invalidates query"

requirements-completed: [RES-01, RES-06, RES-07]

# Metrics
duration: 15min
completed: 2026-03-23
---

# Phase 49 Plan 03: Resolution Engine - Comparison Dialog Summary

**Side-by-side duplicate comparison dialog with merge/link/dismiss resolution actions wired into DuplicateResultsTable row clicks**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-23T23:05:00Z
- **Completed:** 2026-03-23T23:20:00Z
- **Tasks:** 2 of 3 complete (Task 3 awaiting human verification)
- **Files modified:** 3

## Accomplishments
- Created DuplicateComparisonDialog: two-column side-by-side layout showing title, description, steps, tags, folder, last run, field values, attachments count, created date for both cases
- Wired row click in DuplicateResultsTable via onTestCaseClick prop — clicking any candidate pair opens the dialog
- Added 34 translation keys under repository.duplicates in en-US.json covering all comparison dialog strings
- All three resolution actions (merge with survivor selection, link as related, dismiss) POST to /api/duplicate-scan/resolve
- After resolution, onResolved callback invalidates the duplicate-scan-candidates query so the table refreshes

## Task Commits

Each task was committed atomically:

1. **Task 1: DuplicateComparisonDialog component** - `735dc374` (feat)
2. **Task 2: Wire dialog into DuplicateResultsTable and add translations** - `b67fc3cc` (feat)
3. **Task 3: Visual verification** - awaiting human verification

## Files Created/Modified
- `testplanit/components/duplicates/DuplicateComparisonDialog.tsx` - Side-by-side comparison dialog with merge/link/dismiss actions (395 lines)
- `testplanit/components/duplicates/DuplicateResultsTable.tsx` - Added row click handler, dialog state, DuplicateComparisonDialog render
- `testplanit/messages/en-US.json` - 34 translation keys under repository.duplicates

## Decisions Made
- Used `onTestCaseClick` DataTable prop for row click delegation — avoids needing to modify duplicateColumns.tsx for click handling
- `handleRowClick` defined after `sortedItems` useMemo to maintain proper dependency order
- Merge button disabled until a survivor is explicitly selected — prevents accidental merge with wrong survivor

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

TypeScript errors from translation keys were expected (keys referenced before being added to en-US.json). Resolved by adding translations as part of Task 2 before verifying.

## Next Phase Readiness
- Task 3 (human verification) is a blocking checkpoint — human must verify dialog renders and actions work
- Upon verification, plan 49-03 is complete
- Phase 49 resolution engine implementation is complete pending checkpoint approval

---
*Phase: 49-resolution-engine*
*Completed: 2026-03-23*
