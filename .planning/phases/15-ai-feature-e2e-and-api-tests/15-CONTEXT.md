# Phase 15: AI Feature E2E and API Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E and API tests for all AI-powered features with mocked LLM providers. Covers: AI test case generation wizard, auto-tag flow, magic select in test runs, QuickScript generation, writing assistant in TipTap, LLM API endpoints, and auto-tag API endpoints. Does NOT cover AI component unit tests (Phase 16).

</domain>

<decisions>
## Implementation Decisions

### LLM Mocking Strategy
- Mock at the API route level using Playwright route interception for E2E tests
- For API tests, mock the LLM adapter layer or intercept outbound HTTP calls
- All AI features require an active LlmIntegration in the DB — create via API in test setup
- Return realistic but deterministic mock responses (consistent test data)

### E2E Test Approach
- AI test case generation wizard: navigate all 4 steps with mocked LLM responses
- Auto-tag: trigger from repository bulk action, mock background job completion, verify review dialog
- Magic select: already tested in Phase 13 component tests — E2E verifies the full dialog flow with mocked API
- QuickScript: test template-based generation (no LLM needed) and AI-based generation (mocked)
- Writing assistant: trigger from TipTap toolbar, mock streaming response

### API Test Approach
- Test LLM endpoints via Playwright request fixture (not browser)
- Endpoints: /api/llm/generate-test-cases, /api/llm/magic-select-cases, /api/llm/chat, /api/llm/parse-markdown-test-cases
- Auto-tag: /api/auto-tag/submit, /api/auto-tag/status/[jobId], /api/auto-tag/cancel/[jobId], /api/auto-tag/apply

### Claude's Discretion
- Exact mock response shapes for each AI feature
- Whether to test streaming vs non-streaming responses
- How to simulate background job completion for auto-tag

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/llm/adapters/*.test.ts` — existing LLM adapter unit tests show mock patterns
- `lib/llm/services/auto-tag/*.test.ts` — existing auto-tag service tests
- `components/runs/MagicSelectDialog.test.tsx` — component test from Phase 13
- ApiHelper with project/case/tag helpers

### Integration Points
- LLM API: app/api/llm/*.ts routes
- Auto-tag API: app/api/auto-tag/*.ts routes
- AI generation: typically triggered from UI dialogs
- QuickScript: triggered from repository toolbar or case detail

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 15-ai-feature-e2e-and-api-tests*
*Context gathered: 2026-03-19*
