---
phase: 34-schema-and-migration
plan: 01
subsystem: database
tags: [prisma, zenstack, schema, llm, migration]

# Dependency graph
requires: []
provides:
  - PromptConfigPrompt.llmIntegrationId optional FK to LlmIntegration
  - PromptConfigPrompt.modelOverride optional string field
  - @@index([llmIntegrationId]) on PromptConfigPrompt
  - LlmIntegration.promptConfigPrompts reverse relation
  - Generated Prisma client and ZenStack hooks with new fields
  - Database columns added via prisma db push
affects:
  - 35-resolution-chain
  - 36-api
  - 37-ui
  - 38-workers
  - 39-tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nullable FK on PromptConfigPrompt.llmIntegrationId with no cascade delete (SetNull on integration removal)"
    - "Per-prompt LLM override pattern mirrors LlmFeatureConfig project-level override pattern"

key-files:
  created: []
  modified:
    - testplanit/schema.zmodel
    - testplanit/prisma/schema.prisma
    - testplanit/lib/hooks/__model_meta.ts
    - testplanit/lib/hooks/prompt-config-prompt.ts
    - testplanit/lib/openapi/zenstack-openapi.json

key-decisions:
  - "No onDelete: Cascade on llmIntegration relation — deleting an LLM integration sets llmIntegrationId to NULL, preserving prompts"
  - "Index added on PromptConfigPrompt.llmIntegrationId matching LlmFeatureConfig pattern"

patterns-established:
  - "Per-prompt LLM override: llmIntegrationId + modelOverride fields on PromptConfigPrompt"

requirements-completed:
  - SCHEMA-01
  - SCHEMA-02
  - SCHEMA-03

# Metrics
duration: 10min
completed: 2026-03-21
---

# Phase 34 Plan 01: Schema and Migration Summary

**Added optional llmIntegrationId FK and modelOverride string to PromptConfigPrompt in schema.zmodel, regenerated Prisma client, and synced database columns via prisma db push**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-21T00:00:00Z
- **Completed:** 2026-03-21T00:10:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `llmIntegrationId Int?` and `LlmIntegration?` relation to PromptConfigPrompt (no cascade delete)
- Added `modelOverride String?` field for per-prompt model name override
- Added `@@index([llmIntegrationId])` on PromptConfigPrompt
- Added `promptConfigPrompts PromptConfigPrompt[]` reverse relation on LlmIntegration
- Generated ZenStack/Prisma artifacts successfully; database synced with new columns and FK constraint

## Task Commits

Each task was committed atomically:

1. **Task 1: Add llmIntegrationId and modelOverride fields to PromptConfigPrompt** - `d8936696` (feat)
2. **Task 2: Generate ZenStack/Prisma artifacts and push schema to database** - `ce97468b` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `testplanit/schema.zmodel` - Added llmIntegrationId FK, modelOverride field, index, and reverse relation on LlmIntegration
- `testplanit/prisma/schema.prisma` - Regenerated with new PromptConfigPrompt fields
- `testplanit/lib/hooks/__model_meta.ts` - Regenerated ZenStack model metadata
- `testplanit/lib/hooks/prompt-config-prompt.ts` - Regenerated ZenStack hooks
- `testplanit/lib/openapi/zenstack-openapi.json` - Regenerated OpenAPI spec

## Decisions Made
- No `onDelete: Cascade` on the llmIntegration relation — the field is nullable so Postgres will SetNull when an LlmIntegration is deleted, preserving the prompt record
- Index on `llmIntegrationId` follows the same pattern established by LlmFeatureConfig

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Database was reachable and synced automatically via `prisma db push`.

## Next Phase Readiness
- Schema foundation is complete
- Phase 35 (resolution chain) can now build the per-prompt LLM resolution logic on top of `PromptConfigPrompt.llmIntegrationId` and `modelOverride`
- LlmFeatureConfig confirmed unchanged with correct project-admin access rules

---
*Phase: 34-schema-and-migration*
*Completed: 2026-03-21*
