---
phase: 10-test-case-repository-e2e-tests
plan: "01"
subsystem: testing
tags: [playwright, e2e, repository, test-cases, crud, folder-move]

# Dependency graph
requires:
  - phase: 09-authentication-e2e-and-api-tests
    provides: E2E test infrastructure and auth fixtures already established
provides:
  - E2E coverage for test case edit by name via detail page
  - E2E coverage for test case delete via row action
  - E2E coverage for moving test case to different folder via detail page edit mode
affects: [11-test-runs-e2e, repository-feature-development]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Case detail page edit: click edit-test-case-button, modify textarea, click button[type=submit], wait for edit button to reappear"
    - "Case delete in row: locator('[data-row-id]').locator('button:has(svg.lucide-trash-2)'), then alertdialog confirm"
    - "Folder move: FolderSelect in edit mode is a Radix Select with role=combobox scoped by hasText on current folder name"

key-files:
  created: []
  modified:
    - testplanit/e2e/tests/repository/Test Repository Management/test-case-management.spec.ts
    - testplanit/e2e/tests/repository/Test Repository Management/bulk-operations.spec.ts

key-decisions:
  - "BulkEditModal does not support folder/move field — bulk move via detail page FolderSelect is the only UI path"
  - "FolderSelect is a Radix UI Select (role=combobox); must scope by hasText on current folder name to avoid selecting project navigation dropdown"
  - "BUILD_ID race condition in Turbopack: pnpm exec next build exits 0 despite ENOENT error on tmp file; BUILD_ID must be written manually from static hash directory name"

patterns-established:
  - "Row delete pattern: locator('[data-row-id]') → locator('button:has(svg.lucide-trash-2)') → alertdialog confirm"
  - "Detail page edit pattern: getByTestId('edit-test-case-button') → textarea first → button[type=submit] → wait for edit button reappear"

requirements-completed: [REPO-01, REPO-03]

# Metrics
duration: 90min
completed: 2026-03-19
---

# Phase 10 Plan 01: Test Case Repository E2E Tests Summary

**E2E tests for test case edit/delete via detail page and folder move via detail page FolderSelect, closing REPO-01 and REPO-03 coverage gaps**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-03-19T02:30:00Z
- **Completed:** 2026-03-19T04:17:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added "Edit Test Case Name via Detail Page" test: navigates to case detail, enters edit mode, changes name via textarea, saves, reloads and verifies persistence
- Added "Delete Test Case via Row Action" test: locates row by data-row-id, clicks Trash2 button, confirms AlertDialog, verifies row is gone
- Added "Move Test Cases to Different Folder via Detail Page" test: uses FolderSelect in case edit mode to move case between folders, verifies folder membership before and after

## Task Commits

Each task was committed atomically:

1. **Task 1: Add test case edit and delete E2E tests** - `927b0bb7` (feat)
2. **Task 2: Add move test case to folder E2E test** - `b5834bd0` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `testplanit/e2e/tests/repository/Test Repository Management/test-case-management.spec.ts` - Added edit and delete tests (now 6 tests total: 4 existing + 2 new)
- `testplanit/e2e/tests/repository/Test Repository Management/bulk-operations.spec.ts` - Added move to folder test (now 7 tests total: 6 existing + 1 new)

## Decisions Made
- BulkEditModal does NOT have a folder field — the standard fields are: name, state, automated, estimate, tags, issues. Folder move is only available via the individual case detail page's FolderSelect component. The plan's reference to `BulkEditCases.tsx` was to a non-existent file; actual component is `BulkEditModal.tsx`.
- The FolderSelect is a Radix UI `<Select>` component that renders a trigger with `role="combobox"`. Must filter by `hasText: sourceFolderName` to avoid clicking the project navigation dropdown which also has `role="combobox"`.
- The Turbopack build has a known race condition: the `_buildManifest.js.tmp` file is created in a temp hash directory that differs from the final static hash directory. The build exits 0 despite printing an ENOENT error but does NOT write the BUILD_ID file. The BUILD_ID must be written manually using the actual hash directory name from `.next/static/`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adapted bulk move test to use detail page instead of non-existent BulkEditModal folder field**
- **Found during:** Task 2 (bulk-operations.spec.ts)
- **Issue:** Plan referenced `BulkEditCases.tsx` (doesn't exist) and assumed BulkEditModal has a folder field. The actual `BulkEditModal.tsx` has no folder/move capability. Standard fields are name, state, automated, estimate, tags, issues only.
- **Fix:** Wrote "Move Test Cases to Different Folder via Detail Page" test using the FolderSelect component available in case edit mode, which IS the only UI path for folder moves
- **Files modified:** bulk-operations.spec.ts
- **Verification:** Test passes against production build
- **Committed in:** b5834bd0 (Task 2 commit)

**2. [Rule 3 - Blocking] Turbopack race condition required manual BUILD_ID creation**
- **Found during:** Both tasks (verification)
- **Issue:** `pnpm build` consistently failed with ENOENT on a temp file during Turbopack's page data collection. The build creates all necessary files but exits before writing BUILD_ID. `next start` requires BUILD_ID to exist.
- **Fix:** Run `pnpm exec next build` (exits 0 despite error), then write BUILD_ID manually: `ls .next/static/ | grep -v chunks | grep -v media | head -1 > .next/BUILD_ID`
- **Files modified:** .next/BUILD_ID (runtime, not committed)
- **Verification:** `next start` succeeds, E2E tests run against production build
- **Committed in:** Not committed (runtime artifact)

---

**Total deviations:** 2 auto-fixed (1 incorrect assumption about component, 1 build environment issue)
**Impact on plan:** Both deviations handled automatically. Test outcomes satisfy the original requirements: REPO-01 (edit/delete test cases) and REPO-03 (move test cases to folder) are now covered.

## Issues Encountered
- The Turbopack build consistently fails with a race condition on `_buildManifest.js.tmp` files when `cpus: 2` is configured in next.config.mjs. This is a pre-existing environment issue. Setting `cpus: 1` didn't help. The workaround is to use `pnpm exec next build` (which exits 0) and then manually write the BUILD_ID.
- 8 of 323 repository E2E tests have intermittent failures (pre-existing): strict mode violations with multiple `[role="dialog"]` elements and project name timestamp collisions. All 3 new tests pass reliably.

## Next Phase Readiness
- REPO-01 and REPO-03 coverage gaps closed
- test-case-management.spec.ts now has 6 tests (4 existing + 2 new)
- bulk-operations.spec.ts now has 7 tests (6 existing + 1 new)
- Pre-existing 8-test flakiness in repository suite is not a blocker
- BulkEditModal folder move feature is a missing UI feature (not tested) — if it needs to be implemented, it requires schema/API changes

---
*Phase: 10-test-case-repository-e2e-tests*
*Completed: 2026-03-19*

## Self-Check: PASSED

- [x] test-case-management.spec.ts exists and contains 2 new tests
- [x] bulk-operations.spec.ts exists and contains 1 new test
- [x] SUMMARY.md exists at correct path
- [x] Commit 927b0bb7 verified in git log
- [x] Commit b5834bd0 verified in git log
