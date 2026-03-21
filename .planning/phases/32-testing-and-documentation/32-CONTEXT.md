# Phase 32: Testing and Documentation - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds E2E tests for the copy/move feature and user-facing documentation. Unit tests for the worker (criteria 3-4) were already completed in Phase 28 — this phase covers E2E flows and docs only.

</domain>

<decisions>
## Implementation Decisions

### E2E Tests
- E2E tests verify the full copy and move workflows end-to-end
- Must run against production build per CLAUDE.md: `pnpm build && E2E_PROD=on pnpm test:e2e`
- Test copy with data carry-over verification (steps, tags, attachments, field values in target)
- Test template compatibility warning flow for both admin (auto-assign) and non-admin (warning only)
- Test workflow state mapping (name-match and default fallback)
- Mock external APIs as needed (LLM, Jira, etc.) but use real PostgreSQL with seeded data

### Documentation
- User-facing docs go in `docs/docs/` directory
- Create `docs/docs/copy-move-test-cases.md` covering:
  - How to copy/move test cases (toolbar, context menu, bulk action entry points)
  - Template and workflow conflict handling
  - Naming collision resolution
  - What data is carried over vs. what's different (comments, version history, shared steps)

### Unit Tests (Already Done)
- Worker unit tests completed in Phase 28 (copyMoveWorker.test.ts) — criteria 3-4 satisfied
- No additional unit tests needed in this phase

### Claude's Discretion
- E2E test data setup and seed data strategy
- Documentation formatting and section ordering
- Whether to add screenshots to docs

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/` directory with existing Playwright test patterns
- `e2e/fixtures/` with ApiHelper and page objects
- `e2e/global-setup.ts` for DB seeding
- `docs/docs/import-export.md` — related feature docs to follow pattern

### Integration Points
- New E2E test files in `e2e/tests/` directory
- New doc file in `docs/docs/copy-move-test-cases.md`

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the acceptance criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
