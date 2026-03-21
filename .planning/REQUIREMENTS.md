# Requirements: TestPlanIt

**Defined:** 2026-03-21
**Core Value:** Teams can plan, execute, and track testing across manual and automated workflows in one place — with AI assistance to reduce repetitive work.

## v0.17.0 Requirements

Requirements for per-prompt LLM configuration (issue #128). Each maps to roadmap phases.

### Schema

- [x] **SCHEMA-01**: PromptConfigPrompt supports an optional `llmIntegrationId` foreign key to LlmIntegration
- [x] **SCHEMA-02**: PromptConfigPrompt supports an optional `modelOverride` string field
- [x] **SCHEMA-03**: Database migration adds both fields with proper FK constraint and index

### Prompt Resolution

- [x] **RESOLVE-01**: PromptResolver returns per-prompt LLM integration ID and model override when set
- [x] **RESOLVE-02**: When no per-prompt LLM is set, system falls back to project default integration (existing behavior preserved)
- [x] **RESOLVE-03**: Resolution chain enforced: project LlmFeatureConfig > PromptConfigPrompt assignment > project default integration

### Admin UI

- [x] **ADMIN-01**: Admin prompt editor shows per-feature LLM integration selector dropdown alongside existing prompt fields
- [x] **ADMIN-02**: Admin prompt editor shows per-feature model override selector (models from selected integration)
- [x] **ADMIN-03**: Prompt config list/table shows summary indicator when prompts use mixed LLM integrations

### Project Settings UI

- [x] **PROJ-01**: Project AI Models page allows project admins to override per-prompt LLM assignments per feature via LlmFeatureConfig
- [x] **PROJ-02**: Project AI Models page displays the effective resolution chain per feature (which LLM will actually be used and why)

### Export/Import

- [x] **EXPORT-01**: Per-prompt LLM assignments (integration reference + model override) are included in prompt config export/import

### Compatibility

- [x] **COMPAT-01**: Existing projects and prompt configs without per-prompt LLM assignments continue to work without changes

### Testing

- [x] **TEST-01**: Unit tests cover PromptResolver 3-tier resolution chain (per-prompt, project override, project default fallback)
- [x] **TEST-02**: Unit tests cover LlmFeatureConfig override behavior
- [x] **TEST-03**: E2E tests cover admin prompt editor LLM integration selector workflow
- [x] **TEST-04**: E2E tests cover project AI Models per-feature override workflow

### Documentation

- [x] **DOCS-01**: User-facing documentation for configuring per-prompt LLM integrations in admin prompt editor
- [x] **DOCS-02**: User-facing documentation for project-level per-feature LLM overrides on AI Models settings page

## Future Requirements

None — issue #128 is fully scoped above.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Named LLM "roles" (high_quality, fast, balanced) | Over-engineered for current needs — issue #128 Alternative Option 2, could layer on top later |
| Per-prompt temperature/maxTokens override at project level | LlmFeatureConfig already has these fields; wiring them is separate work |
| Shared cross-project test case library | Larger architectural change, out of scope per issue #79 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHEMA-01 | Phase 34 | Complete |
| SCHEMA-02 | Phase 34 | Complete |
| SCHEMA-03 | Phase 34 | Complete |
| RESOLVE-01 | Phase 35 | Complete |
| RESOLVE-02 | Phase 35 | Complete |
| RESOLVE-03 | Phase 35 | Complete |
| COMPAT-01 | Phase 35 | Complete |
| ADMIN-01 | Phase 36 | Complete |
| ADMIN-02 | Phase 36 | Complete |
| ADMIN-03 | Phase 36 | Complete |
| PROJ-01 | Phase 37 | Complete |
| PROJ-02 | Phase 37 | Complete |
| EXPORT-01 | Phase 38 | Complete |
| TEST-01 | Phase 38 | Complete |
| TEST-02 | Phase 38 | Complete |
| TEST-03 | Phase 38 | Complete |
| TEST-04 | Phase 38 | Complete |
| DOCS-01 | Phase 39 | Complete |
| DOCS-02 | Phase 39 | Complete |

**Coverage:**
- v0.17.0 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after initial definition*
