# Phase 1: LLM Tag Analysis - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Backend service that analyzes entity content (test cases, test runs, sessions) and produces tag suggestions using the existing LLM infrastructure. Includes smart batching, prompt configuration, and tag matching logic. Does NOT include API routes, background job processing, or UI — those are later phases.

</domain>

<decisions>
## Implementation Decisions

### Prompt Strategy
- Tags are **categorical** — describe what the entity IS about (e.g., 'login', 'regression', 'API', 'security'), not workflow or priority labels
- **No limit** on suggestions per entity — AI suggests as many as it finds relevant, user filters during review (Phase 3)
- **Supplement existing tags** — include already-tagged entities but only suggest tags they don't already have; existing tags sent in context so AI avoids re-suggesting them
- Prompt follows existing pattern: register in `LLM_FEATURES`, add `FALLBACK_PROMPTS` entry, wire into `PromptResolver`

### Batching Logic
- **Dynamic batch budget** from `LlmProviderConfig.maxTokensPerRequest` — use ~60-70% for entity content, rest for system prompt + tag list + output
- **Truncate oversized entities** — if a single entity exceeds the budget, include it but truncate content to fit (some context > no context)
- **Sequential batch processing** — one batch at a time, simpler and more predictable; easier to cancel mid-process
- **Chars/4 token estimation** — matches existing pattern in `LlmManager` stream tracking; no external tokenizer dependency

### Entity Content Extraction
- **Plain text extraction** from Tiptap JSON fields — strip all formatting, extract just text content; token-efficient
- **Test cases**: name + folder path (useful categorization context) + steps (step text + expected result text) + all custom field values
- **Test runs and sessions**: own metadata fields only (name, description, field values) — do NOT include linked test cases or session results

### Tag Matching
- **Fuzzy matching** to prevent near-duplicate tags — normalize AI suggestions against existing tags (case-insensitive at minimum, consider Levenshtein or similar for close variants like 'auth' vs 'authentication')
- **Neutral bias** — AI suggests whatever fits best; no instruction to prefer existing over new tags
- Fuzzy match happens post-LLM-response: match AI output against existing tag list, flag close matches as existing rather than new

### Claude's Discretion
- AI response JSON schema design (two separate lists vs single list with type indicators)
- Exact fuzzy matching algorithm and threshold
- System prompt wording and structure (following established JSON-only output pattern)
- How to handle custom fields of different types (select, multiselect, checkbox — extract display values vs raw values)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches following existing LLM feature patterns in the codebase.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `LlmManager` (lib/llm/services/llm-manager.service.ts): Singleton with `chat()` method, handles adapter selection, usage tracking, rate limiting
- `PromptResolver` (lib/llm/services/prompt-resolver.service.ts): 3-tier prompt chain (project > default > fallback)
- `LLM_FEATURES` + `LLM_FEATURE_LABELS` (lib/llm/constants.ts): Feature registry — add `AUTO_TAG` here
- `FALLBACK_PROMPTS` (lib/llm/services/fallback-prompts.ts): Hard-coded fallback prompts per feature
- `LlmRequest` type (lib/llm/types/index.ts): Standard request interface with messages, model, temperature, userId, projectId, feature

### Established Patterns
- All LLM features use JSON-only output with `CRITICAL: respond with ONLY valid JSON` instruction
- Features are registered as constants, not dynamic strings
- Temperature varies by feature (0.1 for parsing, 0.3 for selection, 0.7 for generation)
- `userPrompt` is separate from `systemPrompt` — system sets instructions, user provides the data
- Existing stream token estimation uses `Math.ceil(fullContent.length / 4)` — same heuristic for batching

### Integration Points
- `LlmProviderConfig.maxTokensPerRequest` — source for dynamic batch budget
- `Tags` model — query all non-deleted tags to build the existing tag list for the prompt
- `RepositoryCases` with includes: `steps`, `caseFieldValues` (with `field` for field name), `folder` (for path), `tags` (for existing tags)
- `Sessions` and `TestRuns` — similar pattern with their own field values and tags relations
- `RepositoryFolders` — tree structure for folder path reconstruction

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-llm-tag-analysis*
*Context gathered: 2026-03-07*
