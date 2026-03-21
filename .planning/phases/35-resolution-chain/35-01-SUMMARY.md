---
phase: 35-resolution-chain
plan: 01
subsystem: ai
tags: [llm, prompt-resolver, llm-manager, per-prompt-llm, feature-config, resolution-chain]

# Dependency graph
requires:
  - phase: 34-schema-and-migration
    provides: LlmFeatureConfig and PromptConfigPrompt.llmIntegrationId/modelOverride DB fields

provides:
  - ResolvedPrompt interface with llmIntegrationId and modelOverride optional fields
  - LlmManager.resolveIntegration() implementing 3-tier chain (LlmFeatureConfig > per-prompt > project default)
  - All AI feature call sites using the resolution chain

affects:
  - 36-admin-ui (UI for managing LlmFeatureConfig and per-prompt LLM assignment)
  - 37-api-endpoints (REST API for LlmFeatureConfig management)
  - 38-testing (tests for resolveIntegration)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "3-tier LLM resolution chain: feature-level config > per-prompt config > project default"
    - "resolveIntegration() accepts optional resolvedPrompt for chained resolution"
    - "Prompt resolver called before resolveIntegration so per-prompt LLM fields are available"

key-files:
  created: []
  modified:
    - testplanit/lib/llm/services/prompt-resolver.service.ts
    - testplanit/lib/llm/services/prompt-resolver.service.test.ts
    - testplanit/lib/llm/services/llm-manager.service.ts
    - testplanit/lib/llm/services/auto-tag/tag-analysis.service.ts
    - testplanit/lib/llm/services/auto-tag/tag-analysis.service.test.ts
    - testplanit/app/api/llm/generate-test-cases/route.ts
    - testplanit/app/api/llm/magic-select-cases/route.ts
    - testplanit/app/api/llm/parse-markdown-test-cases/route.ts
    - testplanit/app/api/export/ai-stream/route.ts
    - testplanit/app/actions/aiExportActions.ts

key-decisions:
  - "Prompt resolver called before resolveIntegration so per-prompt LLM fields (llmIntegrationId, modelOverride) from PromptConfigPrompt are available to pass into resolveIntegration"
  - "Explicit-integration endpoints (chat, test, admin chat) intentionally not updated — client-specified integration overrides any server-side chain"
  - "resolveIntegration checks isDeleted and status=ACTIVE for both LlmFeatureConfig and per-prompt integrations to avoid using stale/deleted integrations"
  - "resolved.model is passed as LlmRequest.model when set, otherwise omitted — adapter uses its default model"

patterns-established:
  - "Always call PromptResolver.resolve() before LlmManager.resolveIntegration() to enable per-prompt LLM fields"
  - "Use ...(resolved.model ? { model: resolved.model } : {}) pattern to conditionally pass model override"

requirements-completed: [RESOLVE-01, RESOLVE-02, RESOLVE-03, COMPAT-01]

# Metrics
duration: 18min
completed: 2026-03-21
---

# Phase 35 Plan 01: Resolution Chain Summary

**3-tier LLM resolution chain (LlmFeatureConfig > per-prompt > project default) implemented in PromptResolver and LlmManager, with 6 AI feature call sites updated to use it**

## Performance

- **Duration:** 18 min
- **Started:** 2026-03-21T21:07:55Z
- **Completed:** 2026-03-21T21:25:58Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Extended `ResolvedPrompt` interface with `llmIntegrationId` and `modelOverride` optional fields, populated from `PromptConfigPrompt` DB rows
- Added `LlmManager.resolveIntegration()` implementing the 3-tier chain with active/deleted checks at each level
- Updated 6 call sites (tag-analysis, generate-test-cases, magic-select-cases, parse-markdown, ai-stream, aiExportActions x2) to use the resolution chain

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend PromptResolver and add LlmManager.resolveIntegration** - `de2b3791` (feat + test)
2. **Task 2: Update all call sites to use resolveIntegration chain** - `65bedb46` (feat)

**Plan metadata:** (docs commit below)

_Note: Task 1 followed TDD pattern (RED then GREEN)_

## Files Created/Modified
- `testplanit/lib/llm/services/prompt-resolver.service.ts` - Added `llmIntegrationId` and `modelOverride` to ResolvedPrompt; populated from DB in project + default branches
- `testplanit/lib/llm/services/prompt-resolver.service.test.ts` - Added per-prompt LLM field tests (backward compat + new fields)
- `testplanit/lib/llm/services/llm-manager.service.ts` - Added `resolveIntegration()` 3-tier method
- `testplanit/lib/llm/services/auto-tag/tag-analysis.service.ts` - Replaced `getProjectIntegration` with `resolveIntegration`
- `testplanit/lib/llm/services/auto-tag/tag-analysis.service.test.ts` - Added resolveIntegration mock, updated no-integration test
- `testplanit/app/api/llm/generate-test-cases/route.ts` - Use resolveIntegration chain
- `testplanit/app/api/llm/magic-select-cases/route.ts` - Use resolveIntegration chain
- `testplanit/app/api/llm/parse-markdown-test-cases/route.ts` - Use resolveIntegration chain
- `testplanit/app/api/export/ai-stream/route.ts` - Use resolveIntegration chain
- `testplanit/app/actions/aiExportActions.ts` - Use resolveIntegration in both batch and single export

## Decisions Made
- Prompt resolver called before `resolveIntegration` in all call sites so the per-prompt LLM fields from `PromptConfigPrompt` are available to pass into the 3-tier chain
- Explicit-integration endpoints (chat, test, admin chat) intentionally not updated — client-specified integration overrides any server-side chain, preserving existing explicit selection behavior
- `resolved.model` conditionally passed to `LlmRequest.model` with `...(resolved.model ? { model: resolved.model } : {})` pattern — when absent, adapter uses its configured default

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Resolution chain is fully wired; LlmFeatureConfig and per-prompt overrides will be respected by all AI features once the admin UI (Phase 36) allows configuring them
- getProjectIntegration() remains as the Level 3 fallback, preserving full backward compatibility

---
*Phase: 35-resolution-chain*
*Completed: 2026-03-21*
