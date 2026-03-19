# Phase 16: AI Component Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Vitest component tests for AI feature UI components: AutoTagWizardDialog, AutoTagReviewDialog, AutoTagProgress, TagChip (AI-06) and QuickScript dialog, template selector, AI preview pane (AI-07). All with mocked data/responses.

</domain>

<decisions>
## Implementation Decisions

### Test Strategy
- Vitest with React Testing Library — mock ZenStack hooks and LLM responses
- Test all states: loading, empty, error, success for each component
- AutoTag components: wizard steps, review dialog accept/reject, progress bar states
- QuickScript: dialog open, template selection, AI toggle, preview pane content

### Claude's Discretion
- Exact component selection and mock shapes
- Test file organization

</decisions>

<code_context>
## Existing Code Insights

### Key Components
- components/auto-tag/AutoTagWizardDialog.tsx, AutoTagReviewDialog.tsx, AutoTagProgress.tsx, TagChip.tsx
- QuickScript dialog likely in components or app/[locale]/projects/repository area

### Patterns from Phase 13
- MagicSelectDialog.test.tsx shows state machine testing pattern for AI dialogs
- vi.hoisted() for stable mock references in useEffect dependencies

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 16-ai-component-tests*
*Context gathered: 2026-03-19*
