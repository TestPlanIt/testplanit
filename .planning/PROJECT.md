# TestPlanIt - AI Bulk Auto-Tagging

## What This Is

An AI-powered bulk tagging feature for TestPlanIt that lets users automatically suggest and apply tags to test cases, test runs, and sessions. Uses the existing LLM integration infrastructure to analyze entity content and recommend both existing and new tags.

## Core Value

Users can quickly organize large numbers of test artifacts with meaningful tags without manual effort, while retaining full control through a review step before any tags are applied.

## Requirements

### Validated

(None yet -- ship to validate)

### Active

- [ ] AI bulk tagging for test cases, test runs, and sessions
- [ ] Smart batching to balance cost and accuracy
- [ ] Review dialog before applying suggested tags
- [ ] New tag creation when AI suggests tags that don't exist
- [ ] Entry points: bulk actions on list views + tags management page

### Out of Scope

- Individual entity "suggest tags" button -- not needed for v1, focused on bulk
- Auto-apply without review -- always require user confirmation
- Cross-project tagging -- scoped to single project

## Context

- Existing LLM infrastructure: adapters for OpenAI, Anthropic, Gemini, Azure, Ollama, Custom
- Prompt resolution chain: project-specific > system default > hard-coded fallback
- LLM feature registry in `lib/llm/constants.ts`, usage tracking, rate limiting
- Tags model (`Tags`) with many-to-many relations to `RepositoryCases`, `Sessions`, `TestRuns`
- BullMQ + Redis/Valkey worker infrastructure for background jobs
- Tags management page at `app/[locale]/tags/page.tsx`

## Constraints

- **LLM context window**: Entities must be smart-batched to fit within model limits
- **Existing patterns**: Must follow established LLM feature patterns (constants, fallback prompts, prompt resolver)
- **ZenStack**: Data access must respect existing access control policies
- **i18n**: UI strings must use en-US.json translation keys

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Review before apply | Users need control over AI suggestions; prevents bad tags | -- Pending |
| Smart batching | Balance between cost (fewer calls) and accuracy (enough context per entity) | -- Pending |
| New tag creation | AI shouldn't be limited to existing tags; new tags shown with "new" badge | -- Pending |
| Project-scoped | Tags are meaningful within project context; cross-project adds complexity | -- Pending |
| BullMQ for bulk | Large selections (50+ entities) need background processing with progress | -- Pending |

---
*Last updated: 2026-03-07 after milestone initialization*
