---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Comprehensive Test Coverage
status: completed
last_updated: "2026-03-21T20:42:48.105Z"
last_activity: 2026-03-21 — Milestone v0.17.0 roadmap created (6 phases, 19 requirements)
progress:
  total_phases: 25
  completed_phases: 20
  total_plans: 52
  completed_plans: 54
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.
**Current focus:** v0.17.0 Per-Prompt LLM Configuration

## Current Position

Phase: 36 of 39 (Admin Prompt Editor LLM Selector)
Plan: 36-01 complete
Status: In progress — Phase 36 Plan 01 complete
Last activity: 2026-03-21 — Completed 36-01: admin prompt editor LLM integration and model override selectors

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

### Pending Todos

None yet.

### Blockers/Concerns

None yet.
