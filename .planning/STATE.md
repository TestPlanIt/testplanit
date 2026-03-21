---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Comprehensive Test Coverage
status: completed
last_updated: "2026-03-21T21:17:59.641Z"
last_activity: "2026-03-21 — Completed 39-01: per-prompt LLM and per-feature override documentation"
progress:
  total_phases: 25
  completed_phases: 23
  total_plans: 56
  completed_plans: 59
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Per-Prompt LLM Configuration

## Current Position

Phase: 39 of 39 (Documentation)
Plan: 39-01 complete
Status: Complete — all phases and plans done
Last activity: 2026-03-21 — Completed 39-01: per-prompt LLM and per-feature override documentation

## Accumulated Context

### Decisions

(Carried from previous milestone)

- Worker uses raw `prisma` (not `enhance()`); ZenStack access control gated once at API entry only
- Unique constraint errors detected via string-matching err.info?.message for "duplicate key" (not err.code === "P2002")
- [Phase 34-schema-and-migration]: No onDelete:Cascade on PromptConfigPrompt.llmIntegration relation — deleting LLM integration sets llmIntegrationId to NULL, preserving prompts
- [Phase 34-schema-and-migration]: Index added on PromptConfigPrompt.llmIntegrationId following LlmFeatureConfig established pattern
- [Phase 35-resolution-chain]: Prompt resolver called before resolveIntegration so per-prompt LLM fields are available to the 3-tier chain
- [Phase 35-resolution-chain]: Explicit-integration endpoints (chat, test, admin chat) unchanged - client-specified integration takes precedence over server-side resolution chain
- [Phase 36-admin-prompt-editor-llm-selector]: llmIntegrations column uses Map<id,name> to collect unique integrations across prompts, renders three states: Project Default (size 0), single badge (size 1), N LLMs badge (size N)
- [Phase 36-01]: __clear__ sentinel used in Select to represent null since shadcn Select cannot natively represent null values; clearing integration also clears modelOverride
- [Phase 37-project-ai-models-overrides]: FeatureOverrides component fetches its own LlmFeatureConfig and PromptConfigPrompt data — page.tsx passes only integrations and projectDefaultIntegration as props
- [Phase 38-02]: Use createForWorker (not getInstance) for resolveIntegration tests to avoid singleton state bleed between tests
- [Phase 38-export-import-and-testing]: [Phase 38-01]: Export uses llmIntegrationName (human-readable) not raw ID for portability; import resolves names against active integrations only, sets null with unresolvedIntegrations reporting on miss
- [Phase 38-03]: Use api.createProject() for projectId in AI models tests; projectId fixture defaults to 1 which does not exist in E2E database
- [Phase 38-03]: __clear__ sentinel in LLM Integration select renders as 'Project Default (clear)' per en-US translation, not 'Project Default'
- [Phase 39-01]: Documentation updated in-place on existing pages — no new sidebar entries or pages needed; resolution chain section uses explicit anchor for cross-referencing

### Pending Todos

None yet.

### Blockers/Concerns

None yet.
