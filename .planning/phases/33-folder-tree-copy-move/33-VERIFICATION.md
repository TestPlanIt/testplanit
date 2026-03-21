---
phase: 33-folder-tree-copy-move
verified: 2026-03-21T00:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 33: Folder Tree Copy/Move Verification Report

**Phase Goal:** Users can copy or move an entire folder (with all subfolders and contained test cases) to another project, preserving the folder hierarchy
**Verified:** 2026-03-21
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can right-click a folder in the tree view and choose Copy/Move to open the CopyMoveDialog with all cases from that folder tree pre-selected | VERIFIED | `TreeView.tsx:73` — `onCopyMoveFolder?` prop; `TreeView.tsx:1005-1015` — `DropdownMenuItem` rendered when prop present; `CopyMoveDialog.tsx:156-161` — `effectiveCaseIds` uses folderCases from subtree query |
| 2 | The folder hierarchy is recreated in the target project preserving parent-child structure | VERIFIED | `copyMoveWorker.ts:284-338` — BFS loop over `folderTree`, creates folders with correct `parentId` derived from `sourceFolderToTargetFolderMap`; unit test at line 1176 asserts correct parentId chain |
| 3 | All cases within the folder tree are processed with the same compatibility handling as individual case copy/move | VERIFIED | `copyMoveWorker.ts:478-493` — `caseFolderId` resolved from map; same transaction, conflict resolution, template/workflow handling applied regardless of folder mode |
| 4 | User can choose to place the copied/moved tree inside an existing folder or at root level in the target | VERIFIED | `CopyMoveDialog.tsx` — target folder picker unchanged; root node in folderTree has `parentLocalKey: null` which maps to `job.data.targetFolderId` (user-selected target); TREE-04 merge behavior at `copyMoveWorker.ts:302-316` |

**Score:** 4/4 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `testplanit/workers/copyMoveWorker.ts` | FolderTreeNode interface, folder recreation loop, per-case folderId mapping, source folder soft-delete | VERIFIED | 751 lines; `FolderTreeNode` interface at line 41; `sourceFolderToTargetFolderMap` at line 285; BFS loop 288-349; per-case mapping 480-482; soft-delete 693-698 |
| `testplanit/app/api/repository/copy-move/schemas.ts` | folderTree field in submitSchema | VERIFIED | `folderTree: z.array(...)` at line 22 |
| `testplanit/app/api/repository/copy-move/route.ts` | folderTree passthrough to job data | VERIFIED | `folderTree: body.folderTree` at line 227 |
| `testplanit/workers/copyMoveWorker.test.ts` | Unit tests for folder tree recreation, merge, and move soft-delete | VERIFIED | `describe("folder tree operations")` at line 1141; 5 tests: BFS recreation, merge, soft-delete, version history, regression guard |

#### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `testplanit/app/[locale]/projects/repository/[projectId]/TreeView.tsx` | onCopyMoveFolder callback prop, Copy/Move DropdownMenuItem | VERIFIED | `onCopyMoveFolder?` at line 73; `DropdownMenuItem` at lines 1005-1015 |
| `testplanit/components/copy-move/CopyMoveDialog.tsx` | sourceFolderId prop, folder tree building, folder context in header | VERIFIED | 860 lines; `sourceFolderId` prop at line 52; `folderTree` built via BFS useMemo at lines 164-198; folder header display at line 400 |
| `testplanit/components/copy-move/useCopyMoveJob.ts` | folderTree field in submit args | VERIFIED | `FolderTreeNode` import at line 5; `folderTree?: FolderTreeNode[]` at lines 44 and 118 |
| `testplanit/app/[locale]/projects/repository/[projectId]/Cases.tsx` | copyMoveFolderId state management, CopyMoveDialog with folder props | VERIFIED | `copyMoveFolderId` props at lines 85-87; `useEffect` at line 2785-2792 opens dialog in folder mode |
| `testplanit/messages/en-US.json` | Translation key for folder Copy/Move action | VERIFIED | `repository.folderActions.copyMove: "Copy / Move to Project"` at line 1743; `components.copyMove.folderMode` ICU plural at line 4312 |

---

### Key Link Verification

#### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/api/repository/copy-move/route.ts` | `workers/copyMoveWorker.ts` | job data with folderTree field | WIRED | `route.ts:227` passes `folderTree: body.folderTree`; worker reads `job.data.folderTree` at line 288 |
| `workers/copyMoveWorker.ts` | `prisma.repositoryFolders` | folder creation in BFS order | WIRED | `copyMoveWorker.ts:324` calls `prisma.repositoryFolders.create`; merge check at line 303 calls `repositoryFolders.findFirst` |

#### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `TreeView.tsx` | `ProjectRepository.tsx` / `Cases.tsx` | onCopyMoveFolder callback prop | WIRED | `ProjectRepository.tsx:1424-1425` passes `canAddEdit ? handleCopyMoveFolder : undefined` to TreeView; state lifted to ProjectRepository per architecture note |
| `Cases.tsx` | `CopyMoveDialog.tsx` | sourceFolderId and sourceFolderName props | WIRED | `Cases.tsx:3591` calls `onCopyMoveFolderDialogClose`; `CopyMoveDialog` receives `sourceFolderId={activeCopyMoveFolderId}` and `sourceFolderName={activeCopyMoveFolderName}` |
| `CopyMoveDialog.tsx` | `useCopyMoveJob.ts` | submit call with folderTree | WIRED | `CopyMoveDialog.tsx:317` passes `folderTree` to `job.submit()`; `useCopyMoveJob.ts:44` declares `folderTree?: FolderTreeNode[]` in submit args |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TREE-01 | 33-02 | User can right-click a folder and choose Copy/Move to copy/move the entire folder tree with all contained cases | SATISFIED | TreeView context menu item at line 1005; onCopyMoveFolder wired through ProjectRepository |
| TREE-02 | 33-01, 33-02 | Folder hierarchy is recreated in the target project preserving parent-child structure | SATISFIED | Worker BFS loop with `sourceFolderToTargetFolderMap`; per-case `caseFolderId` mapping; unit test asserts BFS parentId chain |
| TREE-03 | 33-01, 33-02 | All cases within the folder tree are processed with the same compatibility handling (templates, workflows, collisions) | SATISFIED | Worker uses same transaction code path regardless of folder mode; `conflictResolution`, template/workflow assignment unchanged |
| TREE-04 | 33-01, 33-02 | User can choose to merge into an existing folder or create the tree fresh in the target | SATISFIED | Worker merge behavior at `copyMoveWorker.ts:302-316` (reuses existing folder ID when name/parent match); unit test "merges into existing folder" at line 1223; target folder picker unchanged in dialog |

All 4 requirements satisfied. No orphaned requirements.

---

### Anti-Patterns Found

None found. Scanned `copyMoveWorker.ts`, `CopyMoveDialog.tsx`, `TreeView.tsx`, `Cases.tsx`, `ProjectRepository.tsx` for TODO/FIXME/PLACEHOLDER/return null/empty implementations. Only legitimate `placeholder` attributes on form inputs were found.

---

### Commits Verified

All 4 commits documented in SUMMARY files exist in the repository:

| Commit | Description |
|--------|-------------|
| `8c9ddcb8` | feat(33-01): extend copy-move worker with folder tree recreation logic |
| `9203c583` | test(33-01): add unit tests for folder tree worker logic |
| `24d56c7d` | feat(33-02): add translation key and extend useCopyMoveJob with folderTree |
| `68552188` | feat(33-02): extend CopyMoveDialog for folder mode, add TreeView entry point, wire in Cases |

---

### Human Verification Required

#### 1. Folder context menu appearance

**Test:** Open the repository tree view in a project that has folders. Right-click a folder.
**Expected:** A "Copy / Move to Project" menu item appears in the context menu, after the Delete option.
**Why human:** Cannot verify rendered DOM from static analysis.

#### 2. Dialog folder mode display

**Test:** Click "Copy / Move to Project" on a folder with nested subfolders and cases.
**Expected:** The CopyMoveDialog opens showing the folder name and total case count (including cases in subfolders). The case count updates after loading (fetched from server).
**Why human:** Async data loading and dialog rendering cannot be verified from static analysis.

#### 3. End-to-end copy with hierarchy preservation

**Test:** Copy a folder with 2 subfolders and cases to another project.
**Expected:** The target project's repository shows the same folder hierarchy with all cases placed in their correct folders.
**Why human:** Requires live database + worker execution.

#### 4. Merge behavior in dialog

**Test:** Copy a folder to a target project that already has a folder with the same name at the target location.
**Expected:** Cases are added to the existing folder (not a duplicate folder created). No error shown.
**Why human:** Requires live database state to verify merge path.

#### 5. Move operation removes source folders

**Test:** Move a folder (with subfolders) to another project.
**Expected:** After the job completes, the source folder and its subfolders no longer appear in the source project's tree view.
**Why human:** Requires worker execution and UI re-render verification.

#### 6. Permission guard on context menu item

**Test:** Log in as a user without edit rights on the project. Right-click a folder.
**Expected:** The "Copy / Move to Project" menu item does NOT appear.
**Why human:** Requires actual auth context — `canAddEdit ? handleCopyMoveFolder : undefined` logic must be verified at runtime.

---

### Summary

All automated checks pass. The phase goal is fully implemented:

- **Backend (Plan 01):** Worker extended with `FolderTreeNode` interface, BFS folder recreation loop, merge behavior for existing folders, per-case `folderId` mapping from `sourceFolderToTargetFolderMap`, version history `folderId` using mapped target folder, and source folder soft-delete on move. The API schema and route correctly accept and forward `folderTree`. 5 unit tests cover all branches.

- **Frontend (Plan 02):** TreeView context menu gains a "Copy / Move to Project" item guarded by `canAddEdit`. Clicking it propagates through ProjectRepository state (correctly lifted from Cases since they're siblings) into CopyMoveDialog. The dialog in folder mode queries source folders, builds the BFS-ordered `folderTree`, computes `effectiveCaseIds` from the subtree, and passes `folderTree` to `useCopyMoveJob.submit`. Translation keys present in `en-US.json`.

6 items flagged for human verification (visual/runtime behavior) — none are implementation gaps.

---

_Verified: 2026-03-21_
_Verifier: Claude (gsd-verifier)_
