---
phase: 33-folder-tree-copy-move
plan: "02"
subsystem: copy-move
tags: [copy-move, folder-tree, ui, dialog, context-menu]
dependency_graph:
  requires: [33-01]
  provides: [folder-copy-move-ui-entry-point]
  affects: [CopyMoveDialog, TreeView, Cases, ProjectRepository, useCopyMoveJob]
tech_stack:
  added: []
  patterns:
    - Prop-drilling folder state from ProjectRepository through Cases to trigger dialog
    - BFS subtree traversal for folder hierarchy collection in useMemo
    - FolderTreeNode BFS-ordered array built client-side for worker serialization
key_files:
  created: []
  modified:
    - testplanit/components/copy-move/CopyMoveDialog.tsx
    - testplanit/components/copy-move/CopyMoveDialog.test.tsx
    - testplanit/components/copy-move/useCopyMoveJob.ts
    - testplanit/app/[locale]/projects/repository/[projectId]/TreeView.tsx
    - testplanit/app/[locale]/projects/repository/[projectId]/Cases.tsx
    - testplanit/app/[locale]/projects/repository/[projectId]/ProjectRepository.tsx
    - testplanit/messages/en-US.json
decisions:
  - TreeView and Cases are siblings in ProjectRepository — folder state lifted to ProjectRepository, passed as props to both
  - Cases receives copyMoveFolderId/copyMoveFolderName props; useEffect opens dialog when prop changes
  - onCopyMoveFolder prop guarded by canAddEdit in ProjectRepository — only shown to users with edit permission
  - effectiveCaseIds replaces selectedCaseIds everywhere in dialog when in folder mode (preflight, submit, progress text)
  - folderTree is undefined when not in folder mode so it is omitted from the submit payload automatically
  - CopyMoveDialog.test.tsx mock updated to include useFindManyRepositoryCases (returns empty array; folder mode not tested in unit tests)
metrics:
  duration: ~15m
  completed: "2026-03-21"
  tasks_completed: 2
  files_modified: 7
---

# Phase 33 Plan 02: Folder Copy/Move UI Entry Point Summary

Wire folder copy/move from TreeView context menu through CopyMoveDialog to the backend, collecting cases from folder subtree and serializing the BFS-ordered folder tree for the worker.

## What Was Built

### Task 1: Translation key and useCopyMoveJob extension

- Added `repository.folderActions.copyMove: "Copy / Move to Project"` to en-US.json
- Imported `FolderTreeNode` type in `useCopyMoveJob.ts`
- Added optional `folderTree?: FolderTreeNode[]` parameter to both the `UseCopyMoveJobReturn` interface `submit` type and the `useCallback` implementation — the JSON body serialization picks it up automatically

### Task 2: CopyMoveDialog folder mode, TreeView entry point, Cases/ProjectRepository wiring

**CopyMoveDialog (folder mode):**
- Added `sourceFolderId?: number` and `sourceFolderName?: string` props
- Queries source project folders via `useFindManyRepositoryFolders` when `sourceFolderId` is set
- Builds `folderSubtreeIds` via BFS starting from `sourceFolderId`
- Queries `useFindManyRepositoryCases` for cases in the subtree
- Computes `effectiveCaseIds` (folder cases in folder mode, `selectedCaseIds` otherwise)
- Builds BFS-ordered `folderTree: FolderTreeNode[]` in a `useMemo`
- Uses `effectiveCaseIds` in preflight, submit, and progress text
- Passes `folderTree` to `job.submit()`
- Shows folder name + case count in dialog header when `sourceFolderName` is set
- Added `components.copyMove.folderMode` i18n key with ICU plural for case count

**TreeView context menu:**
- Added `onCopyMoveFolder?: (folderId: number, folderName: string) => void` prop
- Added `Copy` icon import from `lucide-react`
- Added `DropdownMenuItem` for "Copy / Move to Project" after the Delete item, only rendered when `onCopyMoveFolder` is provided

**Cases.tsx:**
- Added `copyMoveFolderId?: number | null`, `copyMoveFolderName?: string`, `onCopyMoveFolderDialogClose?: () => void` props
- Added `activeCopyMoveFolderId` and `activeCopyMoveFolderName` state
- Added `useEffect` that opens the CopyMoveDialog in folder mode when `copyMoveFolderId` prop changes
- Updated `CopyMoveDialog` render to pass `sourceFolderId`/`sourceFolderName` and handle close cleanup

**ProjectRepository.tsx:**
- Added `copyMoveFolderId`/`copyMoveFolderName` state
- Added `handleCopyMoveFolder` callback (sets folder state) and `handleCopyMoveFolderDialogClose` (clears it)
- Passes `onCopyMoveFolder={canAddEdit ? handleCopyMoveFolder : undefined}` to TreeView
- Passes `copyMoveFolderId`, `copyMoveFolderName`, `onCopyMoveFolderDialogClose` to Cases

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CopyMoveDialog.test.tsx mock missing useFindManyRepositoryCases**
- **Found during:** Task 2 verification (pnpm test)
- **Issue:** All 16 CopyMoveDialog tests failed with "No 'useFindManyRepositoryCases' export is defined on the '~/lib/hooks' mock"
- **Fix:** Added `useFindManyRepositoryCases: () => ({ data: [] })` to the `vi.mock("~/lib/hooks")` factory
- **Files modified:** `testplanit/components/copy-move/CopyMoveDialog.test.tsx`
- **Commit:** 68552188

### Architecture Note

The plan suggested managing folder copy/move state in Cases.tsx and passing `onCopyMoveFolder` to TreeView from there. However, `TreeView` and `Cases` are siblings in `ProjectRepository.tsx`, not parent-child. State was therefore lifted to `ProjectRepository.tsx`, which is the correct architectural location. Cases.tsx receives the folder state as props and triggers the dialog via a `useEffect`.

## Self-Check: PASSED

- 33-02-SUMMARY.md: FOUND
- CopyMoveDialog.tsx: FOUND
- useCopyMoveJob.ts: FOUND
- TreeView.tsx: FOUND (shell bracket escaping false negative)
- Commit 24d56c7d: FOUND
- Commit 68552188: FOUND
- copyMove key in en-US.json: FOUND
- folderTree in useCopyMoveJob: FOUND
- onCopyMoveFolder in TreeView: FOUND
- sourceFolderId in CopyMoveDialog: FOUND
- copyMoveFolderId in Cases: FOUND
