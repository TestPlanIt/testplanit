# Phase 34: Schema and Migration - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Add optional `llmIntegrationId` FK and `modelOverride` string field to the PromptConfigPrompt model in schema.zmodel. Generate migration and validate ZenStack generation succeeds. Confirm LlmFeatureConfig model has correct fields and access rules for project admins.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

All implementation choices are at Claude's discretion — pure infrastructure phase.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `schema.zmodel` — PromptConfigPrompt model at ~line 3195
- LlmFeatureConfig model already exists at ~line 3286 with llmIntegrationId, model, temperature, maxTokens fields
- LlmIntegration model at ~line 2406 (Int id, autoincrement)

### Established Patterns
- FK relations use `@relation(fields: [...], references: [...], onDelete: Cascade)` pattern
- Optional relations use `?` suffix on both field and relation
- ZenStack access control uses `@@allow` and `@@deny` rules
- Indexes added via `@@index([field])` directive

### Integration Points
- `pnpm generate` runs ZenStack + Prisma generation
- Generated hooks in `lib/hooks/` auto-created by ZenStack
- Migration via `prisma migrate dev`

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
