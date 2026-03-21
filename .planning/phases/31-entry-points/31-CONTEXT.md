# Phase 31: Entry Points - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase wires the CopyMoveDialog (built in Phase 30) into three entry points: the repository toolbar button, the test case context menu, and the bulk edit modal footer. No new business logic — pure UI integration.

</domain>

<decisions>
## Implementation Decisions

### Button & Icon
- Toolbar button uses `ArrowRightLeft` icon from lucide-react
- Button visible but disabled when no cases are selected — consistent with other toolbar buttons
- Button positioned between "Create Test Run" and "Export" per requirement ENTRY-01

### Context Menu
- "Copy/Move to Project" item added at the bottom of the existing DropdownMenu in columns.tsx
- Opens the same CopyMoveDialog with the single case's ID

### Bulk Action
- "Copy/Move to Project" added as a new action in the BulkEditModal footer
- Passes all selected case IDs to the dialog

### Dialog State
- React state (`useState`) in parent component for dialog open state and selected case IDs
- CopyMoveDialog receives `open`, `onOpenChange`, `selectedCaseIds`, `sourceProjectId` as props

### Claude's Discretion
- Exact CSS classes and responsive behavior
- Whether to add a tooltip to the toolbar button
- Translation key naming

</decisions>

<code_context>
## Existing Code Insights

### Key Files to Modify
- `app/[locale]/projects/repository/[projectId]/Cases.tsx` — toolbar buttons area (Create Test Run, Export, etc.)
- `app/[locale]/projects/repository/[projectId]/columns.tsx` — DropdownMenu for row actions
- `app/[locale]/projects/repository/[projectId]/BulkEditModal.tsx` — footer actions

### Reusable Assets
- `components/copy-move/CopyMoveDialog.tsx` — the dialog component from Phase 30
- Existing toolbar button patterns in Cases.tsx
- Existing DropdownMenuItem patterns in columns.tsx

### Integration Points
- Import CopyMoveDialog into Cases.tsx (toolbar + dialog state management)
- Import CopyMoveDialog into columns.tsx or pass callback for context menu
- Add action to BulkEditModal footer

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the acceptance criteria — straightforward wiring.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
