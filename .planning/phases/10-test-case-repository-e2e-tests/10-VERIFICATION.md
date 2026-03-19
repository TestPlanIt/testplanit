---
phase: 10-test-case-repository-e2e-tests
verified: 2026-03-19T05:00:00Z
status: human_needed
score: 7/7 must-haves verified
human_verification:
  - test: "Run full repository E2E suite against production build"
    expected: "All new tests pass (edit name, delete, move folder, shared steps CRUD). Pre-existing tests for REPO-02/04/05/07/08/09/10 also pass."
    why_human: "Tests are Playwright specs that require a running production server. Can't verify test execution programmatically without build environment."
  - test: "Verify REPO-01 field-type coverage is sufficient"
    expected: "case-creation-with-fields.spec.ts covers all field types (text, number, checkbox, dropdown, rich text) for create; test-case-management.spec.ts covers edit/delete of name. Combined satisfies REPO-01."
    why_human: "REPO-01 says 'including all field types' — edit flow only covers the name textarea. Confirming that create-time field coverage is accepted as satisfying the edit-time 'all field types' requirement requires product judgment."
  - test: "Confirm REQUIREMENTS.md checkbox status reflects phase completion"
    expected: "REPO-02, REPO-04, REPO-05, REPO-07, REPO-08, REPO-09, REPO-10 checkboxes updated to [x] and status table entries changed from Pending to Complete."
    why_human: "REQUIREMENTS.md currently shows these 7 requirements as unchecked/Pending despite substantive pre-existing spec coverage. The REQUIREMENTS.md was not updated during phase execution. A human must decide whether to update the doc or if the 'Pending' status is intentional (e.g., waiting for test run confirmation)."
---

# Phase 10: Test Case Repository E2E Tests Verification Report

**Phase Goal:** All test case repository workflows are verified end-to-end
**Verified:** 2026-03-19T05:00:00Z
**Status:** human_needed (all automated checks passed; 3 items need human confirmation)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can edit a test case name and save changes via the detail page | VERIFIED | `test-case-management.spec.ts` line 147: "Edit Test Case Name via Detail Page" — navigates to case detail, clicks `edit-test-case-button`, fills textarea, clicks `button[type="submit"]`, verifies name persists after reload |
| 2 | User can delete a test case from the detail page (row action) | VERIFIED | `test-case-management.spec.ts` line 199: "Delete Test Case via Row Action" — locates row by `data-row-id`, clicks `button:has(svg.lucide-trash-2)`, confirms alertdialog, verifies row absent |
| 3 | User can move a test case to a different folder via the detail page | VERIFIED | `bulk-operations.spec.ts` line 303: "Move Test Cases to Different Folder via Detail Page" — uses `FolderSelect` combobox in edit mode, selects target folder, saves, verifies case in target and absent from source |
| 4 | User can create a shared step group from the shared steps page | VERIFIED | `shared-steps.spec.ts` line 21: "Create Shared Step Group via UI" — navigates to `/en-US/projects/shared-steps/{projectId}`, clicks `manual-shared-steps-btn`, fills `manual-group-name-input`, adds 2 steps, saves, verifies group in list |
| 5 | User can edit a shared step group name and its step items | VERIFIED | `shared-steps.spec.ts` line 101: "Edit Shared Step Group Name and Steps" — creates group via API, enters edit mode via `edit-group-name-btn-main`, renames, edits step, adds step, saves, verifies updated name and step count=3 |
| 6 | User can delete a shared step group | VERIFIED | `shared-steps.spec.ts` line 252: "Delete Shared Step Group" — clicks `delete-group-btn`, confirms via `confirm-delete-group-btn`, verifies group absent from list |
| 7 | User can use a shared step group in a test case | VERIFIED | `shared-steps.spec.ts` line 327: "Use Shared Step Group in Test Case" — navigates to case detail, enters edit mode, clicks "Add Shared Steps" button, selects group via AsyncCombobox (`[cmdk-input]`), saves, verifies `[data-testid="shared-step-group"]` visible |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `testplanit/e2e/tests/repository/Test Repository Management/test-case-management.spec.ts` | Test case edit and delete E2E tests | VERIFIED | 6 tests: 4 pre-existing + "Edit Test Case Name via Detail Page" + "Delete Test Case via Row Action". 239 lines. No stubs. |
| `testplanit/e2e/tests/repository/Test Repository Management/bulk-operations.spec.ts` | Bulk move to folder E2E test | VERIFIED | 7 tests: 6 pre-existing + "Move Test Cases to Different Folder via Detail Page". 435 lines. No stubs. |
| `testplanit/e2e/tests/repository/Test Repository Management/shared-steps.spec.ts` | Shared steps CRUD and versioning E2E tests | VERIFIED | NEW file. 5 tests: Create, Edit, Delete, Use in Test Case, Steps Count Reflects Updates. 624 lines. No stubs. |
| `testplanit/e2e/tests/repository/Test Repository Management/folder-creation.spec.ts` | REPO-02: Folder create/nested (pre-existing) | VERIFIED | Exists, 417 lines, 13 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/folder-edit.spec.ts` | REPO-02: Folder rename/move (pre-existing) | VERIFIED | Exists, 3 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/folder-delete.spec.ts` | REPO-02: Folder delete (pre-existing) | VERIFIED | Exists, 6 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/search-filter.spec.ts` | REPO-04: Text search (pre-existing) | VERIFIED | Exists, 14 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/field-filters.spec.ts` | REPO-04: Field filters (pre-existing) | VERIFIED | Exists |
| `testplanit/e2e/tests/repository/Test Repository Management/custom-fields.spec.ts` | REPO-04: Custom field filters (pre-existing) | VERIFIED | Exists, 17 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/export-import.spec.ts` | REPO-05: CSV/JSON export-import (pre-existing) | VERIFIED | Exists |
| `testplanit/e2e/tests/repository/Test Repository Management/markdown-export-import.spec.ts` | REPO-05: Markdown export-import (pre-existing) | VERIFIED | Exists |
| `testplanit/e2e/tests/repository/Test Repository Management/markdown-paste-and-import.spec.ts` | REPO-05: Markdown paste import (pre-existing) | VERIFIED | Exists |
| `testplanit/e2e/tests/repository/Test Repository Management/version-history.spec.ts` | REPO-07: Version history (pre-existing) | VERIFIED | Exists, 331 lines, 10 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/tags.spec.ts` | REPO-08: Tag management (pre-existing) | VERIFIED | Exists, 1056 lines, 16 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/issues.spec.ts` | REPO-09: Issue linking (pre-existing) | VERIFIED | Exists |
| `testplanit/e2e/tests/repository/Test Repository Management/drag-drop.spec.ts` | REPO-10: Drag-drop reordering (pre-existing) | VERIFIED | Exists, 10 tests |
| `testplanit/e2e/tests/repository/Test Repository Management/tree-navigation.spec.ts` | REPO-10: Folder tree navigation (pre-existing) | VERIFIED | Exists, 14 tests |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `test-case-management.spec.ts` | `/en-US/projects/repository/{projectId}/{caseId}` | `page.goto` to case detail, `edit-test-case-button` click, `button[type="submit"]` save | WIRED | Lines 157–196: goto, editButton click, textarea fill, saveButton click, reload verify |
| `test-case-management.spec.ts` | row delete via `lucide-trash-2` + alertdialog confirm | `data-row-id` locator, `button:has(svg.lucide-trash-2)`, `alertdialog` confirm | WIRED | Lines 199–238: row locator, delete button, alertdialog confirm, absence verified |
| `bulk-operations.spec.ts` | FolderSelect combobox in case edit mode | `edit-test-case-button` → `role="combobox"` filtered by source folder name → `role="option"` | WIRED | Lines 327–369: edit mode, FolderSelect by hasText, target option click, save, target folder verified |
| `shared-steps.spec.ts` | `/en-US/projects/shared-steps/{projectId}` | `page.goto` shared steps page | WIRED | Lines 28, 155, 284, 547: all 4 applicable tests navigate correctly |
| `shared-steps.spec.ts` | `/en-US/projects/repository/{projectId}/{testCaseId}` | Navigate to case detail for shared step usage test | WIRED | Line 381: goto repository case detail in Test 4 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REPO-01 | 10-01-PLAN.md | E2E test verifies test case CRUD (create, view, edit, delete) including all field types | SATISFIED | Create: test-case-management.spec.ts + case-creation-with-fields.spec.ts (34 tests, all field types). View: "Click Test Case to View Details". Edit: "Edit Test Case Name via Detail Page". Delete: "Delete Test Case via Row Action". Note: edit-time field-type coverage is name-only; create-time coverage handles all field types. |
| REPO-02 | 10-01-PLAN.md (pre-satisfied) | E2E test verifies folder operations (create, rename, move, delete, nested hierarchy) | SATISFIED | folder-creation.spec.ts (13 tests), folder-edit.spec.ts (3 tests), folder-delete.spec.ts (6 tests) all exist and are substantive. REQUIREMENTS.md checkbox is unchecked — documentation not updated. |
| REPO-03 | 10-01-PLAN.md | E2E test verifies bulk operations (multi-select, bulk edit, bulk delete, bulk move) | SATISFIED | bulk-operations.spec.ts: 6 pre-existing tests cover multi-select, bulk edit, bulk delete, cancel. New test "Move Test Cases to Different Folder via Detail Page" covers folder move (via detail page FolderSelect — the only UI path). |
| REPO-04 | 10-01-PLAN.md (pre-satisfied) | E2E test verifies search and filtering | SATISFIED | search-filter.spec.ts (14 tests), field-filters.spec.ts, custom-fields.spec.ts (17 tests) all exist. REQUIREMENTS.md checkbox unchecked. |
| REPO-05 | 10-01-PLAN.md (pre-satisfied) | E2E test verifies import/export | SATISFIED | export-import.spec.ts, markdown-export-import.spec.ts, markdown-paste-and-import.spec.ts all exist. REQUIREMENTS.md checkbox unchecked. |
| REPO-06 | 10-02-PLAN.md | E2E test verifies shared steps (create, use in test cases, edit, version history) | SATISFIED | shared-steps.spec.ts: 5 new tests covering create UI, edit name+steps, delete, use in test case, steps count update. REQUIREMENTS.md checkbox is [x]. |
| REPO-07 | 10-01-PLAN.md (pre-satisfied) | E2E test verifies version history | SATISFIED | version-history.spec.ts (10 tests, 331 lines). REQUIREMENTS.md checkbox unchecked. |
| REPO-08 | 10-01-PLAN.md (pre-satisfied) | E2E test verifies tag management | SATISFIED | tags.spec.ts (16 tests, 1056 lines). REQUIREMENTS.md checkbox unchecked. |
| REPO-09 | 10-01-PLAN.md (pre-satisfied) | E2E test verifies issue linking | SATISFIED | issues.spec.ts exists. REQUIREMENTS.md checkbox unchecked. |
| REPO-10 | 10-01-PLAN.md (pre-satisfied) | E2E test verifies drag-drop reordering and folder tree navigation | SATISFIED | drag-drop.spec.ts (10 tests), tree-navigation.spec.ts (14 tests). REQUIREMENTS.md checkbox unchecked. |

**Documentation gap:** REPO-02, 04, 05, 07, 08, 09, 10 all show `[ ]` unchecked and "Pending" in REQUIREMENTS.md despite having substantive spec coverage. This phase's plans documented them as pre-satisfied but did not update REQUIREMENTS.md checkboxes or status table entries for those 7 requirements. REPO-01, 03, 06 are correctly marked `[x]` / "Complete".

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | No TODOs, stubs, empty handlers, or placeholder assertions in any of the 3 modified/created spec files |

### Human Verification Required

#### 1. Execute New E2E Tests Against Production Build

**Test:** From the `testplanit/` directory, run:
```bash
pnpm build && E2E_PROD=on pnpm test:e2e \
  "e2e/tests/repository/Test Repository Management/test-case-management.spec.ts" \
  "e2e/tests/repository/Test Repository Management/bulk-operations.spec.ts" \
  "e2e/tests/repository/Test Repository Management/shared-steps.spec.ts"
```
**Expected:** All 3 new/modified spec files pass. test-case-management: 6 tests pass. bulk-operations: 7 tests pass. shared-steps: 5 tests pass.
**Why human:** Playwright E2E tests require a live production server and seeded database. Cannot verify execution programmatically.

**Note:** The SUMMARYs claim all tests passed against production build (commits 927b0bb7, b5834bd0, 3acc6322 verified in git log). The SUMMARY for 10-01 also notes 8/323 pre-existing tests have intermittent flakiness unrelated to new tests.

#### 2. Confirm REPO-01 "All Field Types" Coverage Scope

**Test:** Review whether the REPO-01 acceptance criterion "including all field types" is satisfied by the combined coverage: `case-creation-with-fields.spec.ts` (34 tests covering text, number, checkbox, dropdown, rich text in create flow) + `test-case-management.spec.ts` (edit flow covers name textarea only).
**Expected:** Product decision confirms create-time field-type coverage satisfies the requirement, or clarifies that edit-time field-type testing is also required.
**Why human:** The REPO-01 requirement text is ambiguous — "including all field types" could mean create-only or also edit. The phase plan narrowed the gap to edit/delete only. If edit-time field type coverage is required, additional tests would be needed.

#### 3. Update REQUIREMENTS.md Documentation

**Test:** Verify whether REPO-02, 04, 05, 07, 08, 09, 10 should be marked `[x]` / "Complete" in REQUIREMENTS.md given their pre-existing spec coverage.
**Expected:** Checkboxes updated and status table changed to "Complete" for all 7 requirements, OR a documented reason why they remain "Pending" (e.g., awaiting CI run confirmation).
**Why human:** REQUIREMENTS.md is a planning document that should reflect actual state. The phase execution confirmed these specs exist and are substantive, but did not update the doc.

### Gaps Summary

No functional gaps found. All artifacts exist, are substantive (no stubs), and are properly wired. The phase successfully:

1. Added "Edit Test Case Name via Detail Page" and "Delete Test Case via Row Action" to close REPO-01 gaps
2. Added "Move Test Cases to Different Folder via Detail Page" to close REPO-03 gap (correctly adapted from the planned bulk-modal approach to the actual UI path via FolderSelect)
3. Created `shared-steps.spec.ts` with 5 tests to close REPO-06 gap

The only items requiring attention are documentation (REQUIREMENTS.md checkbox updates for 7 pre-satisfied requirements) and human confirmation of test execution.

---

_Verified: 2026-03-19T05:00:00Z_
_Verifier: Claude (gsd-verifier)_
