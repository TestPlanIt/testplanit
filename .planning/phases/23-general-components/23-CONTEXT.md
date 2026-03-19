# Phase 23: General Components - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Vitest component tests for shared UI components: Header/UserDropdownMenu/NotificationBell, comment system, attachment components, DataTable, form components, onboarding, TipTap extensions, DnD components. Thorough with edge cases per user decision.

</domain>

<decisions>
## Implementation Decisions

### Strategy
- Many existing component tests — gap-fill approach
- Existing: Avatar, DurationDisplay, FileThumbnail, LoadingSpinner, NotificationBell (2 tests), NotificationContent, UnifiedSearch, UserDropdownMenu, DataTable.columnVisibility, Pagination, TagListDisplay, TipTapEditor, DateRangePickerField, InitialPreferencesDialog, ReportBuilder
- Focus on gaps: Header, comment system, attachment components, form selects, DnD, TipTap extensions

### Claude's Discretion
- Which existing tests to extend vs create new
- Mock depth for complex components
- Test file organization

</decisions>

<code_context>
## Existing Tests
- components/Avatar.test.tsx, DurationDisplay.test.tsx, etc. (17 existing component test files)
- components/tables/DataTable.columnVisibility.test.ts, Pagination.test.tsx
- components/tiptap/TipTapEditor.test.tsx

### Integration Points
- components/ directory with feature subdirectories
- components/ui/ for shadcn primitives (don't test these)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 23-general-components*
*Context gathered: 2026-03-19*
