---
phase: 27-export-dialog-filtering
plan: 01
subsystem: ui
tags: [react, zenstack, tanstack-query, next-intl, export-templates]

# Dependency graph
requires:
  - phase: 25-default-template-schema
    provides: defaultCaseExportTemplateId field on Projects and CaseExportTemplateProjectAssignment join model
  - phase: 26-admin-assignment-ui
    provides: Admin UI for assigning templates to projects; CaseExportTemplateProjectAssignment records
provides:
  - QuickScript export dialog filtered to project-assigned templates only
  - Project default template pre-selection in QuickScript dialog
  - Backward-compatible fallback (no assignments = all enabled templates)
  - Empty state message when assignments exist but all are disabled/deleted
affects: [28-future-export-features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useFindManyCaseExportTemplateProjectAssignment with projectId filter for per-project template scoping"
    - "useFindUniqueProjects with select: { defaultCaseExportTemplateId } for lightweight project field fetch"
    - "filteredTemplates useMemo pattern: derive visible list from global fetch + assignment filter"

key-files:
  created: []
  modified:
    - testplanit/app/[locale]/projects/repository/[projectId]/QuickScriptModal.tsx
    - testplanit/messages/en-US.json

key-decisions:
  - "Used templateId (not caseExportTemplateId) — the join model field is named templateId per schema.zmodel"
  - "Removed include: { caseExportTemplate: true } from assignment query — not needed since templates are already fetched globally via useFindManyCaseExportTemplate"
  - "assignmentsExistButEmpty renders inline empty state message instead of disabling the combobox trigger — better UX clarity"
  - "Export button also disabled when assignmentsExistButEmpty to prevent submitting without a template"

patterns-established:
  - "Project-scoped template filtering: fetch global templates + fetch project assignments separately, then filter in useMemo"
  - "Pre-selection priority chain: explicit user selection > project default > global isDefault > first available"

requirements-completed: [EXPORT-01, EXPORT-02, EXPORT-03]

# Metrics
duration: 15min
completed: 2026-03-19
---

# Phase 27 Plan 01: Export Dialog Filtering Summary

**QuickScript dialog now filters templates to project assignments with project-default pre-selection and backward-compatible fallback when no assignments exist**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-19T05:24:02Z
- **Completed:** 2026-03-19T05:39:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- QuickScript dialog shows only project-assigned templates when assignments exist (EXPORT-01)
- Project default template is pre-selected with priority over global isDefault (EXPORT-02)
- No assignments configured = all enabled templates shown (backward compatible, EXPORT-03)
- Empty state message rendered with export button disabled when assignments exist but all are unavailable
- Category grouping behavior preserved using filteredTemplates

## Task Commits

Each task was committed atomically:

1. **Task 1: Add empty state translation key** - `c96dcd0b` (feat)
2. **Task 2: Filter templates by project assignment and pre-select project default** - `398da5c8` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `testplanit/app/[locale]/projects/repository/[projectId]/QuickScriptModal.tsx` - Added assignment + project queries, filteredTemplates memo, updated defaultTemplate logic, empty state rendering
- `testplanit/messages/en-US.json` - Added `noAvailableTemplates` key under `repository.quickScript`

## Decisions Made
- Used `templateId` field (not `caseExportTemplateId`) on the join model — matches the actual schema.zmodel field name
- Removed `include: { caseExportTemplate: true }` from the assignments query since the global `useFindManyCaseExportTemplate` fetch already provides the template data; filtering by Set of templateIds avoids redundant data fetch
- Empty state message is rendered inline (replacing the combobox) rather than just showing an empty combobox, giving the user a clear actionable message

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed field name mismatch: caseExportTemplateId vs templateId**
- **Found during:** Task 2 (filter templates by project assignment)
- **Issue:** Plan specified `a.caseExportTemplateId` and `include: { caseExportTemplate: true }` but the schema.zmodel join model uses `templateId` and `template` as field names
- **Fix:** Changed `caseExportTemplateId` to `templateId` in the Set mapping; removed the `include` clause (not needed and caused a TypeScript error)
- **Files modified:** QuickScriptModal.tsx
- **Verification:** `pnpm type-check` passes without errors
- **Committed in:** `398da5c8` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - field name mismatch from plan vs actual schema)
**Impact on plan:** Essential fix for correctness. No scope creep.

## Issues Encountered
- TypeScript caught the field name mismatch immediately on first type-check run, making the fix straightforward

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- v2.1 Per-Project Export Template Assignment feature is complete across all three phases (25, 26, 27)
- All three requirements (EXPORT-01, EXPORT-02, EXPORT-03) satisfied
- No blockers

---
*Phase: 27-export-dialog-filtering*
*Completed: 2026-03-19*
