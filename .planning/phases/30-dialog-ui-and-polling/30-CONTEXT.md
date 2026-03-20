# Phase 30: Dialog UI and Polling - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase builds the CopyMoveDialog component and useCopyMoveJob polling hook. The dialog guides users through target selection, compatibility warnings, conflict resolution, and progress tracking. It connects to the preflight, submit, status, and cancel API endpoints built in Phase 29.

</domain>

<decisions>
## Implementation Decisions

### Dialog Flow & Steps
- Multi-step wizard: Step 1 (target project + folder), Step 2 (operation + warnings/conflicts), Step 3 (progress + results)
- Folder picker lazy-loads after project selection — selecting a project triggers folder tree fetch for that project
- Template/workflow warnings displayed as inline yellow alert banners in Step 2, with option checkboxes for admin auto-assign
- Clicking "Go" transitions dialog to progress view (Step 3) — shows live progress bar, then final summary

### Progress & Results UX
- If user closes dialog during progress, job continues in background
- Notification bell integration: when copy/move job completes, a notification appears in the existing notification system so user can see results
- Progress indicator: progress bar with "X of Y cases processed" text + spinner
- Results summary: success count, failure count; if failures, expandable list with per-case error reason
- After completion: "View in target project" link + "Close" button

### Collision & Warning Presentation
- Collision list: scrollable list of conflicting case names with radio options per-collision (skip or rename) plus "Apply to all" batch option
- Shared step group collisions: inline per-group choice — "Group 'X' exists in target — Reuse existing / Create new"
- Template warning for non-admins: yellow alert with list of affected templates, warning that cases will be copied but template won't be available in target
- Template auto-assign for admins: checkbox (enabled by default) to auto-assign missing templates

### Claude's Discretion
- Component library choices within shadcn/ui
- Dialog sizing and responsive behavior
- Animation and transition details
- Internal state management approach (useState vs useReducer)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/auto-tag/useAutoTagJob.ts` — direct blueprint for `useCopyMoveJob` polling hook
- `components/auto-tag/useAutoTagJob.test.ts` — test pattern for polling hook
- `components/DuplicateTestRunDialog.tsx` — similar multi-step dialog UX pattern
- `@/components/ui/` — shadcn/ui primitives (Dialog, Button, Select, Progress, Alert, RadioGroup)
- `components/FolderSelect.tsx` or similar folder picker components (if exist)
- Notification system components for notification bell integration

### Established Patterns
- Dialogs use shadcn/ui Dialog component with DialogContent, DialogHeader, DialogFooter
- Form state managed with React useState or React Hook Form
- Data fetching via ZenStack auto-generated hooks (useFindManyProjects, etc.)
- Polling hooks use setInterval with cleanup on unmount

### Integration Points
- New files: `components/copy-move/CopyMoveDialog.tsx`, `components/copy-move/useCopyMoveJob.ts`
- API endpoints from Phase 29: preflight, submit, status, cancel
- Notification system: create notification on job completion
- Repository toolbar and context menu (Phase 31 will wire entry points)

</code_context>

<specifics>
## Specific Ideas

- The `useCopyMoveJob` hook should mirror `useAutoTagJob` — manage jobId state, poll status endpoint, return progress/result/error
- Dialog should be a controlled component that receives `open`, `onOpenChange`, `selectedCaseIds`, `sourceProjectId` as props
- Use ZenStack hooks for project list (filtered to write-access projects) and folder tree

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
