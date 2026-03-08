# Phase 4: Entry Point Integrations - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire AI bulk tagging into existing list views (cases, test runs, sessions) and the tags management page. Each entry point triggers the same backend flow (submit -> poll -> review -> apply) using the components built in Phase 3. This phase adds no new backend logic — only frontend integration.

</domain>

<decisions>
## Implementation Decisions

### Cases list integration
- Add AI Tag button as a new entry inside a dropdown menu (not a standalone button)
- Keep Bulk Edit and Create Test Run as separate standalone buttons — dropdown is only for tag-related actions
- Same `canAddEdit` permission gates AI tagging (no new permission)
- AutoTagProgress banner appears above the DataTable, below the filter/pagination bar
- Selection uses existing `selectedCaseIdsForBulkEdit` state — no new selection infrastructure needed

### Test runs & sessions lists
- No row selection added — use a page-level "Tag All" button instead
- "Tag All" submits all filtered/visible entities (respects active search/filters), not all entities in project
- Button appears in the header action area, next to existing page-level actions (e.g., "Add Session")
- AutoTagProgress appears in the same above-table position as cases list

### Tags management page
- "AI Auto-Tag" button in the page header
- Clicking opens a popover/dialog where user picks entity type (cases/runs/sessions) and project
- Project is auto-detected from the tag's project associations (tags page is global, not project-scoped)
- Submits all entities of the chosen type in the selected project (no entity selection step)
- AutoTagProgress + AutoTagReviewDialog render on the tags page itself

### Shared wiring pattern
- Each page owns its own `useAutoTagJob` hook instance (no global provider/context)
- Job persistence via localStorage: store jobId keyed by `entityType+projectId`
- Hook checks localStorage on mount and resumes polling if a job is still active
- This lets users navigate away and return to see progress/results

### Claude's Discretion
- Dropdown component choice and styling for the cases bulk action
- Exact layout of the entity type + project picker on the tags page
- How to fetch filtered entity IDs for "Tag All" on runs/sessions pages
- Loading/disabled states while job is submitting

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Cases.tsx`: Has `selectedCaseIdsForBulkEdit` state, `rowSelection`, bulk action buttons pattern — direct integration point
- `useAutoTagJob.ts`: Complete lifecycle hook ready to compose (submit, poll, cancel, apply, reset)
- `AutoTagProgress.tsx`: Inline progress indicator with i18n and themed colors
- `AutoTagReviewDialog.tsx`: Full review dialog ready to mount
- `components/ui/dropdown-menu.tsx`: Radix DropdownMenu for the cases bulk action dropdown
- `DataTable.tsx`: Has `rowSelection` support via @tanstack/react-table

### Established Patterns
- Bulk action buttons appear in a `flex gap-2` bar below pagination, visible only when rows are selected
- Pages use `useProjectPermissions` hook for `canAddEdit` check
- `useFindMany*` hooks provide filtered data; entity IDs can be extracted from query results
- Pages use `useTranslations` with feature-specific namespaces

### Integration Points
- `Cases.tsx` line ~3205: Bulk action button bar — add dropdown here
- `TestRunsListDisplay.tsx` / sessions page: Header action area for "Tag All" button
- `app/[locale]/tags/page.tsx` line ~384: CardHeader area for "AI Auto-Tag" button
- `useAutoTagJob.submit(entityIds, entityType, projectId)`: Entry point for all triggers

</code_context>

<specifics>
## Specific Ideas

- User chose dropdown only for tag-related actions specifically because they want Bulk Edit and Create Test Run to stay as standalone buttons — don't consolidate everything
- "Tag All" for runs/sessions avoids the complexity of adding row selection infrastructure to those pages
- Auto-detect project from tag associations on the tags page rather than requiring manual project selection

</specifics>

<deferred>
## Deferred Ideas

- Row selection for test runs and sessions lists — useful for future bulk actions beyond tagging
- Per-tag "Auto-tag more entities" action on the tags management page

</deferred>

---

*Phase: 04-entry-point-integrations*
*Context gathered: 2026-03-07*
