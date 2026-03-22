# Phase 37: Project AI Models Overrides - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Add per-feature LLM override UI to the Project AI Models settings page. Project admins can assign a specific LLM integration per feature via LlmFeatureConfig. The page displays the effective resolution chain per feature (which LLM will actually be used and why).

</domain>

<decisions>
## Implementation Decisions

### UI Layout
- New section/card on the AI Models settings page below existing cards
- Shows all 7 LLM features (from lib/llm/constants.ts) in a list/table
- Each feature row has: feature name, current effective LLM (with source indicator), override selector
- Source indicators: "Project Override", "Prompt Config", "Project Default"

### Data Flow
- LlmFeatureConfig model already exists with projectId, feature, llmIntegrationId, model fields
- Use useFindManyLlmFeatureConfig({ where: { projectId } }) to load existing overrides
- Use useCreateLlmFeatureConfig / useUpdateLlmFeatureConfig / useDeleteLlmFeatureConfig for CRUD
- Resolution chain display: query the prompt config's per-prompt assignments + project default to show full chain

### Resolution Chain Display
- For each feature, show what LLM would be used and at which level:
  - Level 1: Project override (LlmFeatureConfig) — if set, shown prominently
  - Level 2: Prompt config assignment — shown as fallback
  - Level 3: Project default — shown as final fallback
- Visual: Could be tooltip, expandable row, or inline text like "Using: GPT-4o (project override) → falls back to Claude 3.5 (prompt config) → GPT-4o-mini (project default)"

### Claude's Discretion
- Exact layout of the override section (table vs card grid vs accordion)
- How to visualize the resolution chain (tooltip, inline, expandable)
- Whether to show model override alongside integration selector
- Error states (no integrations available, integration deleted, etc.)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/[locale]/projects/settings/[projectId]/ai-models/page.tsx` — existing AI Models settings page with 2 cards
- `components/LlmIntegrationsList.tsx` — card-based integration picker (used in existing page)
- `lib/hooks/llm-feature-config.ts` — ZenStack hooks for LlmFeatureConfig CRUD
- `lib/hooks/project-llm-integration.ts` — hooks for project-LLM assignment
- `lib/llm/constants.ts` — LLM_FEATURES array with all 7 features

### Established Patterns
- Project settings pages use Card layout with sections
- Data fetching via ZenStack hooks (useFindMany*, useCreate*, useUpdate*, useDelete*)
- Permission checks via useProjectPermissions or access level checks

### Integration Points
- AI Models settings page (page.tsx) — add new card/section
- LlmFeatureConfig hooks — wire up CRUD operations
- PromptResolver's resolveIntegration() already reads LlmFeatureConfig at Level 1

</code_context>

<specifics>
## Specific Ideas

- Issue #128: "Project admins can override per-prompt LLM assignments at the project level via the AI Models settings page (via LlmFeatureConfig)"
- Resolution chain: Project LlmFeatureConfig > PromptConfigPrompt > Project default
- LlmFeatureConfig.enabled field exists but is not checked by resolveIntegration — this UI should set enabled=true when creating an override

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
