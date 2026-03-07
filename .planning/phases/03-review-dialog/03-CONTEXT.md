# Phase 3: Review Dialog - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Modal dialog where users review AI-suggested tags per entity, accept/reject/modify individual suggestions, see new vs existing tags visually distinguished, and apply all accepted suggestions with one action. This phase covers the review UI component only — entry points (bulk action menus, tags page) are Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Suggestion Layout
- Two-column split: entity list on the left, selected entity's suggestions on the right
- Large centered modal dialog (max-width ~900px) with existing fullscreen toggle — not a sheet or full page
- Entity list has text search/filter at the top for finding specific entities (helpful at 50+ entities)
- Entity list display style: Claude's Discretion (user wants to evaluate during UAT)

### Accept/Reject Interaction
- Toggle chips — each tag is a clickable chip/badge; clicked = accepted (filled), unclicked = rejected (outlined/dimmed)
- All suggestions start as accepted by default (opt-out model) — reduces clicks when AI accuracy is decent
- Inline edit on double-click to modify a suggestion (e.g., 'auth' -> 'authentication')
- No per-entity bulk actions (accept all / reject all) — with all-accepted default, users mostly just deselect a few
- Already decided (Phase 2): frontend sends only accepted suggestions to apply endpoint

### New vs Existing Tag Distinction
- New tags (not yet in project) use dashed border + small 'New' label — clear distinction without color that implies meaning
- Existing tags use standard filled chip style
- No near-match warnings in UI — trust Phase 1's fuzzy matching to handle at the service level
- Show already-applied tags (current tags) as non-interactive context in a separate grayed-out section per entity

### Summary Display
- Aggregate summary in dialog footer near Apply button: "12 existing tags, 3 new tags will be created"
- Gives user impact awareness before applying

### Progress & Completion Flow
- While AI processes: inline progress indicator in the page (replaces trigger button area), not a dialog or toast
- Already decided (Phase 2): polling with per-entity count granularity ("Analyzed 23/100 entities")
- When processing completes: success notification with "Review" button to open the dialog — user controls when to engage
- After Apply: dialog closes + success toast ("15 tags applied to 8 entities, 3 new tags created") + React Query invalidation refreshes page data
- On Apply failure: error toast + dialog stays open with all selections preserved — user can retry

### Claude's Discretion
- Entity list display format in left column (name + count, name + preview, or name + status indicator)
- Exact chip styling and animation for toggle state changes
- Polling interval for status endpoint
- Loading states and skeleton patterns within the dialog
- How to handle the edge case of zero suggestions for an entity

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/ui/dialog.tsx`: Radix Dialog with fullscreen toggle, overlay, close button — use as the modal container
- `components/ui/badge.tsx`: Badge with variants (default, secondary, outline, destructive) — base for tag chips
- `components/ui/checkbox.tsx`: Available but not needed (toggle chips chosen instead)
- `components/ui/progress.tsx`: Progress bar component — use for inline processing indicator
- `components/ui/accordion.tsx` / `components/ui/collapsible.tsx`: Available but not needed (two-column chosen)
- `components/ManageTags.tsx`: Existing tag picker using react-select with create support — reference for tag creation patterns
- `components/tables/TagDisplay.tsx`: Existing tag badge display with tooltip — reference for tag rendering
- `components/tables/TagListDisplay.tsx`: Tag list rendering — reference for multi-tag display

### Established Patterns
- Tags use `Badge` component with `Tag` icon from lucide-react
- Tag creation uses `useCreateTags` hook (ZenStack auto-generated)
- Tag data fetched via `useFindManyTags` hook
- Dialogs use Radix primitives with Tailwind CSS animations
- Theming via next-themes with `getCustomStyles` for dark mode support

### Integration Points
- Phase 2 API routes: `POST /api/auto-tag/submit` (start job), `GET /api/auto-tag/status/[jobId]` (poll), `POST /api/auto-tag/cancel/[jobId]` (cancel), `POST /api/auto-tag/apply` (apply accepted)
- React Query invalidation after apply to refresh entity lists with new tags
- Tags model: many-to-many relations with RepositoryCases, Sessions, TestRuns

</code_context>

<specifics>
## Specific Ideas

No specific references — open to standard approaches following existing codebase conventions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-review-dialog*
*Context gathered: 2026-03-07*
