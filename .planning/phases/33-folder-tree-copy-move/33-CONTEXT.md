# Phase 33: Folder Tree Copy/Move - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds folder-level copy/move support. Users can right-click a folder in the tree view and choose Copy/Move, which recursively processes all subfolders and contained cases to the target project. Reuses the existing CopyMoveDialog, worker, and API infrastructure from Phases 28-31.

</domain>

<decisions>
## Implementation Decisions

### Entry Point
- Add "Copy / Move" option to the existing folder context menu (alongside Edit and Delete)
- The menu item opens the CopyMoveDialog with all case IDs from the folder tree pre-collected

### Folder Handling
- Recursively collect all cases from the selected folder and all descendant subfolders
- Recreate the folder hierarchy in the target project preserving parent-child structure
- On Move: source folders are also deleted (soft-delete) after all cases are moved
- On Copy: source folders remain unchanged

### Worker Changes
- Worker needs to accept an optional folder tree structure in job data
- Before creating cases, worker recreates the folder tree in the target project
- Each case is placed in the corresponding recreated folder (not all in one flat folder)
- Folder creation uses the target repository ID and respects the user's chosen parent folder

### Dialog Changes
- CopyMoveDialog needs to accept an optional `sourceFolderId` prop
- When a folder is the source, the dialog shows the folder name and case count
- The target folder picker selects where the root of the copied tree will be placed

### Claude's Discretion
- How to collect case IDs from folder tree (client-side query vs API)
- Exact folder tree data structure passed to worker
- Whether to show folder structure preview in the dialog

</decisions>

<code_context>
## Existing Code Insights

### Key Files to Modify
- `app/[locale]/projects/repository/[projectId]/TreeView.tsx` — folder context menu (Edit/Delete already exist)
- `workers/copyMoveWorker.ts` — add folder tree recreation before case processing
- `app/api/repository/copy-move/route.ts` — accept folder structure in submit
- `components/copy-move/CopyMoveDialog.tsx` — accept sourceFolderId, show folder context

### Reusable Assets
- Existing CopyMoveDialog, useCopyMoveJob, preflight/submit/status/cancel APIs
- `useFindManyRepositoryFolders` for loading folder trees
- `useCreateRepositoryFolders` for creating folders (already used in dialog)
- Existing folder context menu pattern in TreeView.tsx

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the acceptance criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
