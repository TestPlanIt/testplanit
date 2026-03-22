# Phase 35: Resolution Chain - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the three-level LLM resolution chain in PromptResolver and LlmManager services. When an AI feature is invoked, the system determines which LLM integration to use via: (1) project-level LlmFeatureConfig override, (2) per-prompt PromptConfigPrompt.llmIntegrationId, (3) project default integration. Existing behavior (project default) must be fully preserved when no overrides exist.

</domain>

<decisions>
## Implementation Decisions

### Resolution Chain Logic
- PromptResolver.resolve() must return the per-prompt llmIntegrationId and modelOverride alongside prompt content
- The ResolvedPrompt type/interface needs new optional fields: llmIntegrationId and modelOverride
- Call sites that use PromptResolver + LlmManager must be updated to pass through the resolved integration
- LlmFeatureConfig lookup happens per project + per feature — query LlmFeatureConfig where projectId + feature match

### Fallback Order
- Level 1 (highest priority): LlmFeatureConfig for project+feature → use its llmIntegrationId and model
- Level 2: PromptConfigPrompt.llmIntegrationId → use it (with optional modelOverride)
- Level 3 (default): LlmManager.getProjectIntegration(projectId) → existing behavior

### Claude's Discretion
- Whether to add a new service method or modify existing ones
- Internal naming of new types/fields
- How to structure the LlmFeatureConfig query (inline in resolver vs separate method)
- Error handling when a referenced llmIntegrationId is inactive or deleted

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/llm/services/prompt-resolver.service.ts` — PromptResolver with resolve(feature, projectId?) method
- `lib/llm/services/llm-manager.service.ts` — LlmManager with getAdapter(), chat(), getProjectIntegration()
- `lib/llm/constants.ts` — LlmFeature enum and PROMPT_FEATURE_VARIABLES
- LlmFeatureConfig model in schema.zmodel (already has llmIntegrationId, model, projectId, feature fields)
- ZenStack auto-generated hooks for LlmFeatureConfig in lib/hooks/

### Established Patterns
- PromptResolver returns ResolvedPrompt with source, systemPrompt, userPrompt, temperature, maxOutputTokens
- LlmManager.getProjectIntegration() returns integration or falls back to system default
- Services use singleton pattern with static getInstance()
- Prisma client accessed via lib/prisma.ts

### Integration Points
- All AI feature call sites that use PromptResolver + LlmManager (auto-tag worker, test case generation, editor assistant, etc.)
- The resolved integration ID must be passed to LlmManager.chat() or LlmManager.chatStream()

</code_context>

<specifics>
## Specific Ideas

- Resolution chain from issue #128: Project LlmFeatureConfig > PromptConfigPrompt.llmIntegrationId > Project default
- LlmFeatureConfig model already exists in schema with the right fields — just needs to be queried during resolution

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
