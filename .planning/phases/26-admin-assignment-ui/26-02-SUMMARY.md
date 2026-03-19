---
phase: 26-admin-assignment-ui
plan: 02
subsystem: ui
tags: [react, zenstack, next-intl, shadcn, tanstack-query]

# Dependency graph
requires:
  - phase: 26-admin-assignment-ui-01
    provides: ZenStack access control for CaseExportTemplateProjectAssignment create/delete scoped to project admins
  - phase: 25-default-template-schema
    provides: defaultCaseExportTemplateId field on Projects model and CaseExportTemplateProjectAssignment join model
provides:
  - ExportTemplateAssignmentSection component for per-project template assignment UI
  - Export template assignment section rendered on quickscript settings page above code repo section
  - Translation keys for export template assignment under projects.settings.quickScript.exportTemplates
affects: [27-export-dialog, testing, e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delete-all/recreate pattern for many-to-many assignment updates (mirrors EditTemplate.tsx)"
    - "MultiAsyncCombobox for searchable multi-select with async fetch and metadata badges pushed right"
    - "Alphabetical sort applied client-side in useMemo to avoid ZenStack nested orderBy bugs"

key-files:
  created:
    - testplanit/app/[locale]/projects/settings/[projectId]/quickscript/ExportTemplateAssignmentSection.tsx
  modified:
    - testplanit/app/[locale]/projects/settings/[projectId]/quickscript/page.tsx
    - testplanit/messages/en-US.json
    - testplanit/components/ui/multi-async-combobox.tsx

key-decisions:
  - "Added translation keys to en-US.json as part of Task 1 because TypeScript type-checks translation keys against the JSON at compile time — component would not compile without them"
  - "MultiAsyncCombobox chosen over checkbox list after human review — better UX for potentially large template lists"
  - "selectedTemplates stored as TemplateOption[] objects (not just IDs) so badge data is available without re-lookup"
  - "Metadata badges (category, language) pushed right with ml-auto so template names stay left-aligned"

patterns-established:
  - "ExportTemplateAssignmentSection: MultiAsyncCombobox with full object state, useEffect initializer from server data, isDirty flag to enable Save only after local changes"

requirements-completed: [ADMIN-01, ADMIN-02]

# Metrics
duration: 15min
completed: 2026-03-19
---

# Phase 26 Plan 02: Export Template Assignment UI Summary

**ExportTemplateAssignmentSection with MultiAsyncCombobox on QuickScript settings page — admins assign templates, set per-project default, and save via delete-all/recreate ZenStack hooks**

## Performance

- **Duration:** ~45 min (including human review and UI refinement)
- **Started:** 2026-03-19T03:47:58Z
- **Completed:** 2026-03-19
- **Tasks:** 3 of 3 (all complete including checkpoint:human-verify)
- **Files modified:** 4

## Accomplishments
- Created ExportTemplateAssignmentSection component with MultiAsyncCombobox for searchable template assignment
- Admin can assign/unassign templates, set a default from assigned templates, and save with explicit Save button
- Save uses delete-all/recreate pattern: deleteMany assignments then createMany, plus updateProject for default
- Unassigning the default template automatically clears it (defaultStillAssigned check before updateProject)
- Component integrated into page.tsx above the code repository section with defaultCaseExportTemplateId passed as prop
- Human review approved, UI refined from checkbox list to MultiAsyncCombobox with metadata badges

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ExportTemplateAssignmentSection component** - `14929833` (feat)
2. **Task 2: Integrate section into page and add translations** - `b6b55c53` (feat)
3. **Task 3: Verify template assignment UI + UI refinements** - `87e79d2b` (refactor)

**Plan metadata:** `ba1d6edd` (docs: complete export template assignment UI plan)

## Files Created/Modified
- `testplanit/app/[locale]/projects/settings/[projectId]/quickscript/ExportTemplateAssignmentSection.tsx` - Export template assignment UI with MultiAsyncCombobox, alphabetical sort, metadata badges, default selector, and save handler
- `testplanit/app/[locale]/projects/settings/[projectId]/quickscript/page.tsx` - Added import, defaultCaseExportTemplateId to query, ExportTemplateAssignmentSection render
- `testplanit/messages/en-US.json` - Added exportTemplates keys including assignedLabel and selectPlaceholder
- `testplanit/components/ui/multi-async-combobox.tsx` - Fixed X button alignment and check icon consistency in option rows

## Decisions Made
- Added translation keys as part of Task 1 commit (not Task 2) because TypeScript validates translation key names against en-US.json at compile time
- MultiAsyncCombobox chosen over checkbox list after human review — better UX for potentially large template lists with search
- `selectedTemplates` stored as full `TemplateOption[]` objects so badge data (category, language) is available without re-lookup
- Metadata badges pushed right with `ml-auto` so template names stay left-aligned in option rows

## Deviations from Plan

### Post-Checkpoint UI Refinements

**1. [Human Review] Replaced checkbox list with MultiAsyncCombobox**
- **Found during:** Task 3 (human-verify checkpoint)
- **Issue:** Checkbox list was functional but user wanted a more polished, searchable multi-select
- **Fix:** Replaced checkbox list with MultiAsyncCombobox — supports search, badge rendering per option, alphabetical sort
- **Files modified:** ExportTemplateAssignmentSection.tsx, multi-async-combobox.tsx, en-US.json (2 new keys)
- **Committed in:** `87e79d2b`

---

**Total deviations:** 1 post-checkpoint UI refinement
**Impact on plan:** Improved UX, all success criteria met. No functional scope change.

## Issues Encountered
- TypeScript compile-time validation of i18n keys via next-intl means translation keys must exist before the component will type-check. Added translations first, then verified compilation. No functional impact.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ExportTemplateAssignmentSection is fully implemented, integrated, and human-verified
- Phase 27 (Export Dialog Filtering) can query `useFindManyCaseExportTemplateProjectAssignment` for project-scoped template lists
- `defaultCaseExportTemplateId` on Project is queryable for pre-selecting the default in the export dialog
- Backward compatible fallback (show all templates when no assignments exist) documented for Phase 27 to implement

---
*Phase: 26-admin-assignment-ui*
*Completed: 2026-03-19*
