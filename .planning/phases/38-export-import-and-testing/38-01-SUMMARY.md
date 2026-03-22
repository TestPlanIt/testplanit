---
phase: 38-export-import-and-testing
plan: 01
subsystem: api
tags: [prompt-config, export, import, llm, admin, zod]

# Dependency graph
requires:
  - phase: 36-admin-prompt-editor-llm-selector
    provides: per-prompt llmIntegrationId and modelOverride fields on PromptConfigPrompt
  - phase: 34-schema-and-migration
    provides: PromptConfig and PromptConfigPrompt schema with LLM fields

provides:
  - GET /api/admin/prompt-configs/export?id=xxx — exports prompt config JSON with human-readable llmIntegrationName per prompt
  - POST /api/admin/prompt-configs/import — imports prompt config from JSON, resolves integration names to IDs, reports unresolved names

affects:
  - future-ui-phases that add export/import buttons to the admin prompt configs table

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Admin API route pattern with getServerSession + ADMIN access guard
    - Zod validation for import request body
    - Name-to-ID resolution map for portable cross-environment references

key-files:
  created:
    - testplanit/app/api/admin/prompt-configs/export/route.ts
    - testplanit/app/api/admin/prompt-configs/export/route.test.ts
    - testplanit/app/api/admin/prompt-configs/import/route.ts
    - testplanit/app/api/admin/prompt-configs/import/route.test.ts
  modified: []

key-decisions:
  - "Export uses llmIntegrationName (human-readable name) not raw ID for portability across environments"
  - "Import gracefully degrades when integration name not found: sets llmIntegrationId to null and reports name in unresolvedIntegrations array (no failure)"
  - "Import fetches only active (non-deleted, status=ACTIVE) integrations for name resolution"

patterns-established:
  - "Export pattern: map relation name from include to portable string field"
  - "Import pattern: fetch active lookup records, build name-to-id Map, resolve each item, collect unresolved for reporting"

requirements-completed: [EXPORT-01]

# Metrics
duration: 12min
completed: 2026-03-21
---

# Phase 38 Plan 01: Export/Import API Routes Summary

**Prompt config export/import API routes with per-prompt LLM fields — GET exports llmIntegrationName per prompt, POST resolves names to IDs with graceful degradation**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-21T20:50:00Z
- **Completed:** 2026-03-21T21:02:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- GET /api/admin/prompt-configs/export returns full prompt config JSON with llmIntegrationName (human-readable) and modelOverride per prompt
- POST /api/admin/prompt-configs/import creates config from JSON body, resolves integration names to IDs, reports unresolved names in response
- 29 unit tests covering auth, validation, resolution logic, and graceful degradation across both routes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create prompt config export API route** - `0df33927` (feat)
2. **Task 2: Create prompt config import API route** - `88cbec58` (feat)

**Plan metadata:** (docs commit below)

_Note: TDD tasks — tests written first, then implementation_

## Files Created/Modified
- `testplanit/app/api/admin/prompt-configs/export/route.ts` - GET endpoint exporting prompt config as JSON with LLM fields
- `testplanit/app/api/admin/prompt-configs/export/route.test.ts` - 13 unit tests for export endpoint
- `testplanit/app/api/admin/prompt-configs/import/route.ts` - POST endpoint importing prompt config, resolving integration names
- `testplanit/app/api/admin/prompt-configs/import/route.test.ts` - 16 unit tests for import endpoint

## Decisions Made
- Export uses human-readable `llmIntegrationName` (not `llmIntegrationId`) so configs are portable across environments where integration IDs differ
- Import resolves names against active integrations only (`isDeleted: false, status: "ACTIVE"`)
- Missing integration names produce `llmIntegrationId: null` (graceful degradation), with the name reported in `unresolvedIntegrations` array in the response — no error is thrown

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Export and import API routes are functional and tested
- Ready for UI integration (export/import buttons on the admin prompt configs table)
- Round-trip fidelity: export → import → export produces equivalent JSON (minus auto-generated id/timestamps)

---
*Phase: 38-export-import-and-testing*
*Completed: 2026-03-21*

## Self-Check: PASSED
- All 4 files exist
- Both task commits verified (0df33927, 88cbec58)
