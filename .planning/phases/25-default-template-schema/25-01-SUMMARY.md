---
phase: 25-default-template-schema
plan: 01
subsystem: database
tags: [prisma, zenstack, postgresql, schema, relations]

# Dependency graph
requires: []
provides:
  - "Projects model with nullable defaultCaseExportTemplateId FK and defaultCaseExportTemplate optional relation"
  - "CaseExportTemplate model with defaultForProjects back-relation"
  - "Database column Projects.defaultCaseExportTemplateId (nullable, SetNull on delete)"
affects:
  - 26-default-template-ui
  - 27-export-dialog

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Named relation 'ProjectDefaultExportTemplate' disambiguates from CaseExportTemplateProjectAssignment join-table relation"
    - "onDelete: SetNull on nullable FK clears default when template is deleted"

key-files:
  created: []
  modified:
    - testplanit/schema.zmodel
    - testplanit/prisma/schema.prisma
    - testplanit/lib/hooks/__model_meta.ts
    - testplanit/lib/hooks/projects.ts
    - testplanit/lib/openapi/zenstack-openapi.json

key-decisions:
  - "Used onDelete: SetNull so deleting a CaseExportTemplate clears defaultCaseExportTemplateId on any referencing project (no orphan FKs)"
  - "Named relation 'ProjectDefaultExportTemplate' required to disambiguate from the existing join-table relation via CaseExportTemplateProjectAssignment"

patterns-established:
  - "Pattern: nullable optional relation with SetNull for per-project default selections (mirrors defaultRoleId/defaultRole pattern)"

requirements-completed: [SCHEMA-02]

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 25 Plan 01: Default Template Schema Summary

**Nullable `defaultCaseExportTemplateId` FK added to Projects model with `onDelete: SetNull`, enabling per-project export template defaults; ZenStack/Prisma regenerated and database schema pushed.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-19T03:05:00Z
- **Completed:** 2026-03-19T03:10:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `defaultCaseExportTemplateId Int?` FK and `defaultCaseExportTemplate CaseExportTemplate?` optional relation to Projects model in schema.zmodel
- Added `defaultForProjects Projects[]` back-relation on CaseExportTemplate model with named relation `"ProjectDefaultExportTemplate"`
- Ran `pnpm generate` — ZenStack hooks, Prisma client, and OpenAPI spec regenerated; nullable column pushed to database with all existing rows defaulting to NULL

## Task Commits

Each task was committed atomically:

1. **Task 1: Add defaultCaseExportTemplate relation to Project model** - `a739d82d` (feat)
2. **Task 2: Regenerate ZenStack/Prisma and push schema** - `0cabe15d` (chore)

## Files Created/Modified

- `testplanit/schema.zmodel` - Added FK and relation fields to Projects model; added back-relation to CaseExportTemplate model
- `testplanit/prisma/schema.prisma` - Generated Prisma schema with new fields
- `testplanit/lib/hooks/__model_meta.ts` - Updated ZenStack model metadata
- `testplanit/lib/hooks/projects.ts` - Updated ZenStack hooks for Projects model
- `testplanit/lib/openapi/zenstack-openapi.json` - Updated OpenAPI spec

## Decisions Made

- Used `onDelete: SetNull` so deleting a CaseExportTemplate automatically clears the FK on any project that used it as default — no orphaned references
- Named the relation `"ProjectDefaultExportTemplate"` to disambiguate from the existing `CaseExportTemplateProjectAssignment` join-table relation that also links Projects and CaseExportTemplate

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - `pnpm generate` and `prisma db push` completed cleanly on first attempt.

## User Setup Required

None - no external service configuration required. The nullable column was added to the existing Projects table without any data migration needed.

## Next Phase Readiness

- Schema change is ready for Phase 26 (admin UI) to set `defaultCaseExportTemplateId` on projects
- Phase 27 (export dialog) can use `project.defaultCaseExportTemplate` to pre-select a template
- ZenStack auto-generated hooks (`useFindManyProjects`, `useUpdateProjects`) already include the new field

---
*Phase: 25-default-template-schema*
*Completed: 2026-03-19*
