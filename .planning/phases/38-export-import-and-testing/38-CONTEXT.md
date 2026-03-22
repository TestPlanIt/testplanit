# Phase 38: Export/Import and Testing - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Three deliverables: (1) Per-prompt LLM fields in prompt config export/import, (2) Unit tests for PromptResolver resolution chain and LlmFeatureConfig, (3) E2E tests for admin prompt editor LLM selector and project AI Models overrides.

</domain>

<decisions>
## Implementation Decisions

### Export/Import
- Prompt config export must include llmIntegrationId (as integration name reference, not raw ID) and modelOverride per prompt
- On import, resolve integration name back to ID; if integration not found, skip the assignment (graceful degradation)
- Export format should be JSON, matching existing prompt config export structure

### Unit Tests
- Test PromptResolver.resolve() returns llmIntegrationId and modelOverride when set on prompt
- Test LlmManager.resolveIntegration() 3-tier chain: Level 1 (LlmFeatureConfig), Level 2 (per-prompt), Level 3 (project default)
- Test graceful fallthrough when integration is deleted/inactive
- Test LlmFeatureConfig CRUD behavior (create, update, delete, unique constraint)

### E2E Tests
- Admin prompt editor: select integration, select model, save, reload and verify pre-selected, clear and save
- Project AI Models: assign override per feature, verify effective LLM display, clear override, verify fallback
- Follow CLAUDE.md E2E testing requirements: build first, use test IDs, E2E_PROD=on

### Claude's Discretion
- Test file locations and naming
- Mock strategy for unit tests (mock Prisma client vs in-memory)
- E2E test data setup approach
- Whether to combine or separate test files

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `testplanit/lib/llm/services/prompt-resolver.service.test.ts` — existing test file with per-prompt LLM tests added in Phase 35
- `testplanit/lib/llm/services/llm-manager.service.ts` — resolveIntegration method to test
- Existing E2E test patterns in `/e2e` directory
- Test fixtures and helpers

### Established Patterns
- Unit tests: co-located `*.test.ts` files using Vitest
- E2E tests: Playwright in `/e2e` directory
- E2E tests must be run against production builds (pnpm build && E2E_PROD=on pnpm test:e2e)
- Mock Prisma client for service unit tests

### Integration Points
- Export/import likely in admin prompts page or a service
- E2E tests need test data (LLM integrations, prompt configs)

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the acceptance criteria from REQUIREMENTS.md.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
