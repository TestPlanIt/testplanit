---
phase: 31-entry-points
verified: 2026-03-20T18:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 31: Entry Points Verification Report

**Phase Goal:** The copy/move dialog is reachable from every UI location where users interact with test cases
**Verified:** 2026-03-20T18:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Repository toolbar shows a Copy/Move to Project button between Create Test Run and Export | VERIFIED | `Cases.tsx` line 3378: Button with `data-testid="copy-move-button"` appears after `create-test-run-button` block and before `export-cases-button` block in JSX order |
| 2 | Right-clicking (actions menu) on a test case row reveals a Copy/Move to Project option | VERIFIED | `columns.tsx` lines 955-962: `DropdownMenuItem` with `data-testid="copy-move-case-{row.original.id}"` and `ArrowRightLeft` icon added to `ActionsCell` |
| 3 | The bulk edit modal footer includes a Copy/Move to Project button | VERIFIED | `BulkEditModal.tsx` lines 2045-2055: Button with `data-testid="bulk-edit-copy-move-button"` positioned between Delete and Cancel/Save sections |
| 4 | Each entry point opens the CopyMoveDialog with the correct case IDs and source project ID | VERIFIED | All three paths flow into `selectedCaseIdsForBulkEdit` + `projectId` props on `<CopyMoveDialog>` rendered at `Cases.tsx` line 3564 |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `testplanit/app/[locale]/projects/repository/[projectId]/Cases.tsx` | CopyMoveDialog state management, toolbar button, dialog render | VERIFIED | Imports `CopyMoveDialog` (line 50), `isCopyMoveOpen` state (line 199), `handleCopyMove` callback (line 2767), toolbar button (line 3382), dialog render (line 3564) |
| `testplanit/app/[locale]/projects/repository/[projectId]/columns.tsx` | Context menu Copy/Move item using ArrowRightLeft | VERIFIED | `ArrowRightLeft` imported (line 75), `onCopyMove` prop on `ActionsCell` (line 905), `DropdownMenuItem` rendered (lines 955-962) |
| `testplanit/app/[locale]/projects/repository/[projectId]/BulkEditModal.tsx` | Copy/Move footer button using ArrowRightLeft | VERIFIED | `ArrowRightLeft` imported (line 28), `onCopyMove?: () => void` in props interface (line 138), footer button rendered (lines 2045-2055) |
| `testplanit/messages/en-US.json` | `copyMoveToProject` key under `repository.cases` | VERIFIED | Line 1761: `"copyMoveToProject": "Copy / Move to Project"` under `repository.cases` namespace |
| `testplanit/components/copy-move/CopyMoveDialog.tsx` | Dialog component from Phase 30 with open/onOpenChange/selectedCaseIds/sourceProjectId | VERIFIED | Exists with matching interface (lines 40-43) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Cases.tsx` toolbar button | `CopyMoveDialog` | `onClick={() => setIsCopyMoveOpen(true)}` + `isCopyMoveOpen` state | WIRED | Button at line 3380 sets state; dialog at line 3565 reads `open={isCopyMoveOpen}` |
| `columns.tsx` context menu | `Cases.tsx handleCopyMove` | `onCopyMove` callback threaded through `getColumns` → `ActionsCell` | WIRED | `getColumns` receives anonymous callback at Cases.tsx line 2849 calling `handleCopyMove([caseId])`; ActionsCell uses it at columns.tsx line 957 |
| `BulkEditModal` footer button | `CopyMoveDialog` via `Cases.tsx` | `onCopyMove` prop closes BulkEditModal then opens CopyMoveDialog | WIRED | `Cases.tsx` lines 3543-3545: `setIsBulkEditModalOpen(false)` then `setIsCopyMoveOpen(true)`; no nested dialogs |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DLGSEL-01 | 31-01-PLAN.md | User can select one or more test cases and choose "Copy/Move to Project" from context menu | SATISFIED | `columns.tsx` `DropdownMenuItem` with `data-testid="copy-move-case-{id}"` calls `onCopyMove(row.original.id)` → `handleCopyMove([caseId])` → sets `selectedCaseIdsForBulkEdit` and opens dialog |
| DLGSEL-02 | 31-01-PLAN.md | User can select "Copy/Move to Project" from bulk actions toolbar | SATISFIED | `Cases.tsx` toolbar button with `data-testid="copy-move-button"` visible when `canAddEdit && !isSelectionMode && !isRunMode && selectedCaseIdsForBulkEdit.length > 0` |
| ENTRY-01 | 31-01-PLAN.md | Copy/Move to Project button appears between Create Test Run and Export in the repository toolbar | SATISFIED | JSX order confirmed: `create-test-run-button` block → `copy-move-button` block → `export-cases-button` block (Cases.tsx lines 3359-3413) |
| ENTRY-02 | 31-01-PLAN.md | Copy/Move to Project option appears in the test case context menu (right-click) | SATISFIED | `ActionsCell` in `columns.tsx` renders `DropdownMenuItem` with `ArrowRightLeft` icon when `!isRunMode && !isSelectionMode && onCopyMove` |
| ENTRY-03 | 31-01-PLAN.md | Copy/Move to Project appears as an action in the bulk edit modal footer | SATISFIED | `BulkEditModal.tsx` footer has button positioned between Delete (left) and Cancel/Save (right) sections |

### Anti-Patterns Found

No blocking anti-patterns detected in the modified files. No TODO/FIXME/placeholder comments introduced. No stub implementations found.

### Human Verification Required

#### 1. Toolbar button visibility threshold

**Test:** Navigate to repository, select zero cases, confirm button is hidden. Select one or more cases, confirm button appears with correct count in parentheses.
**Expected:** Button only visible when at least one case is selected; count matches selection.
**Why human:** Conditional rendering logic is correct in code but actual display behavior depends on runtime state.

#### 2. Context menu positioning

**Test:** Right-click (or click the actions ellipsis) on a test case row. Confirm "Copy / Move to Project" appears in the dropdown and is positioned before or after the expected items.
**Expected:** Menu item appears with `ArrowRightLeft` icon and label "Copy / Move to Project".
**Why human:** Cannot verify visual dropdown item ordering or actual rendering in browser.

#### 3. No-nested-dialogs behavior

**Test:** Open Bulk Edit modal with selected cases, click "Copy / Move to Project" in the footer. Confirm Bulk Edit modal closes fully before the CopyMoveDialog opens.
**Expected:** Smooth sequential transition — no stacked/overlapping dialogs.
**Why human:** Sequential React state updates (`setIsBulkEditModalOpen(false)` then `setIsCopyMoveOpen(true)`) are correct in code but visual transition requires browser observation.

#### 4. Context menu single-case ID propagation

**Test:** Click "Copy / Move to Project" from a specific row's context menu. Confirm the CopyMoveDialog receives only that single case's ID (not a prior bulk selection).
**Expected:** `selectedCaseIds` in the dialog contains exactly the one case ID from the row.
**Why human:** The `handleCopyMove` callback calls `setSelectedCaseIdsForBulkEdit([caseId])` first, but verifying the state contains only that ID requires runtime inspection.

### Gaps Summary

No gaps. All four observable truths verified. All three entry points (toolbar, context menu, bulk edit footer) are wired to the `CopyMoveDialog` with correct `selectedCaseIds` and `sourceProjectId` props. All five requirement IDs (DLGSEL-01, DLGSEL-02, ENTRY-01, ENTRY-02, ENTRY-03) are satisfied by the implementation. Commits `d7f44ee5` and `52be0f80` confirmed in git history.

---

_Verified: 2026-03-20T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
