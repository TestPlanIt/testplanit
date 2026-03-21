---
phase: 36-admin-prompt-editor-llm-selector
plan: 01
subsystem: admin-ui
tags: [llm, prompts, admin, form, selector]
dependency_graph:
  requires: [34-01, 35-01]
  provides: [per-prompt-llm-integration-selector-ui]
  affects: [admin-prompts-page]
tech_stack:
  added: []
  patterns: [useFindManyLlmIntegration, react-hook-form-setValue, shadcn-Select]
key_files:
  created: []
  modified:
    - testplanit/app/[locale]/admin/prompts/PromptFeatureSection.tsx
    - testplanit/app/[locale]/admin/prompts/AddPromptConfig.tsx
    - testplanit/app/[locale]/admin/prompts/EditPromptConfig.tsx
    - testplanit/messages/en-US.json
decisions:
  - "__clear__ sentinel value used in Select to distinguish clear-action from unset, since shadcn Select cannot represent null natively"
  - "Integration selector clears modelOverride when integration is cleared, preventing stale model value"
  - "modelOverride selector disabled when no integration selected to prevent invalid state"
metrics:
  duration: ~8 minutes
  completed: "2026-03-21"
  tasks_completed: 2
  files_modified: 4
---

# Phase 36 Plan 01: Admin Prompt Editor LLM Selector Summary

**One-liner:** Per-prompt LLM integration and model override selectors added to each feature accordion in the admin prompt config editor, with full save/load in Add and Edit dialogs.

## What Was Built

Each feature accordion in the admin prompt config editor (Add and Edit dialogs) now shows two selectors at the top:

1. **LLM Integration** — dropdown of active integrations (fetched via `useFindManyLlmIntegration`), with "Project Default (clear)" option to revert to null
2. **Model Override** — dropdown of models from the selected integration's `llmProviderConfig.availableModels`, disabled when no integration is selected, with "Integration Default (clear)" option

Both fields are wired into the form schemas (`llmIntegrationId: z.number().nullable().optional()`, `modelOverride: z.string().nullable().optional()`), default values, and submit handlers for both Add and Edit dialogs. The Edit dialog pre-populates from existing prompt data on open.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add LLM integration and model override selectors to PromptFeatureSection | 79e8e783 | PromptFeatureSection.tsx, en-US.json |
| 2 | Wire llmIntegrationId and modelOverride into Add and Edit form schemas and submit handlers | 65b8a5a1 | AddPromptConfig.tsx, EditPromptConfig.tsx |

## Decisions Made

- Used `__clear__` sentinel value in Select `onValueChange` to distinguish a "clear to null" action from a normal selection, since shadcn's Select cannot natively represent `null` as a value
- Clearing the integration also clears `modelOverride` to prevent a stale model value from persisting against a different integration
- Model override selector is disabled when `selectedIntegrationId` is null/falsy, enforcing the dependency between the two fields

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- PromptFeatureSection.tsx: FOUND
- AddPromptConfig.tsx: FOUND
- EditPromptConfig.tsx: FOUND
- Commit 79e8e783: FOUND
- Commit 65b8a5a1: FOUND
