# Phase 36: Admin Prompt Editor LLM Selector - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Add per-feature LLM integration and model override selectors to the admin prompt config editor. Each feature accordion gains an LLM integration dropdown and a model selector. The prompt config list/table shows a summary indicator when prompts within a config use mixed LLM integrations.

</domain>

<decisions>
## Implementation Decisions

### UI Layout
- LLM Integration selector goes at the TOP of each feature accordion section (before system prompt)
- Model override selector appears next to or below the integration selector
- When no integration is selected, show "Project Default" placeholder text
- A "Clear" option allows reverting to project default

### Data Flow
- PromptConfigPrompt already has llmIntegrationId and modelOverride fields (Phase 34)
- Form data shape: prompts.{feature}.llmIntegrationId and prompts.{feature}.modelOverride
- Available integrations fetched via useFindManyLlmIntegration hook (active, not deleted)
- Available models for selected integration fetched via LlmManager.getAvailableModels or from LlmProviderConfig.availableModels

### Mixed Integration Indicator
- On the prompt config list/table, show a badge/indicator when prompts in a config reference different LLM integrations
- e.g., "Mixed LLMs" or a count like "3 LLMs" vs showing the single integration name when all use the same one

### Claude's Discretion
- Exact visual design of selectors (shadcn Select, Combobox, etc.)
- How to display available models (dropdown, text input with suggestions, etc.)
- Badge design for mixed indicator
- Whether to show integration provider icon/badge alongside name

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/[locale]/admin/prompts/PromptFeatureSection.tsx` — accordion per feature, uses useFormContext()
- `app/[locale]/admin/prompts/` — full admin prompt editor page
- `components/ui/select.tsx` — shadcn Select component
- `lib/hooks/llm-integration.ts` — ZenStack hooks for LlmIntegration CRUD
- `lib/hooks/prompt-config-prompt.ts` — ZenStack hooks for PromptConfigPrompt

### Established Patterns
- Form fields use react-hook-form with `useFormContext()` and field names like `prompts.{feature}.systemPrompt`
- Admin pages follow consistent layout with Card, CardHeader, CardContent from shadcn
- Select components use shadcn Select with SelectTrigger, SelectContent, SelectItem

### Integration Points
- PromptFeatureSection.tsx is the component to modify for per-feature selectors
- Admin prompt list page needs the mixed indicator
- Form submission already handles PromptConfigPrompt create/update — new fields will flow through

</code_context>

<specifics>
## Specific Ideas

- Issue #128 mockup shows: `LLM Integration: [OpenAI (GPT-4o) ▼] [Model: gpt-4o ▼]` at top of each feature section
- When clearing, the field should become null/undefined (not empty string)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
