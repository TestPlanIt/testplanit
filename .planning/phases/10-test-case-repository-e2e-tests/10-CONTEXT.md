# Phase 10: Test Case Repository E2E Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify all test case repository workflows end-to-end. The repository already has 27 E2E spec files with strong coverage. This phase focuses on gap-filling — running existing tests to establish baseline, identifying failures or missing coverage, and writing new tests only where needed. Does NOT cover component or hook tests (Phase 11).

</domain>

<decisions>
## Implementation Decisions

### Coverage Strategy
- Gap-fill only — do NOT rewrite existing tests that work
- Run the full existing repository test suite first to establish baseline and find failures
- Read each existing spec file before deciding what's missing
- Write new tests only for coverage gaps identified after reading existing tests

### Existing Coverage Map (27 specs already exist)
- REPO-01 (CRUD): test-case-management.spec.ts — likely covers most; verify all field types
- REPO-02 (Folders): folder-creation, folder-edit, folder-delete — 3 specs exist
- REPO-03 (Bulk ops): bulk-operations.spec.ts — exists
- REPO-04 (Search/filter): search-filter, field-filters, custom-fields — 3 specs exist
- REPO-05 (Import/export): export-import, markdown-export-import, markdown-paste-and-import — 3 specs exist
- REPO-06 (Shared steps): steps-display.spec.ts exists but may only cover display, not shared step CRUD/versioning — LIKELY GAP
- REPO-07 (Version history): version-history.spec.ts — exists
- REPO-08 (Tags): tags.spec.ts — exists
- REPO-09 (Issues): issues.spec.ts — exists
- REPO-10 (Drag-drop, tree nav): drag-drop.spec.ts, tree-navigation.spec.ts — 2 specs exist

### Test Organization
- Add new tests to existing spec files or adjacent new files in the same directory structure
- Do NOT refactor existing tests — only add missing coverage
- Maintain the existing `testplanit/e2e/tests/repository/` directory structure

### Key Gap Areas to Investigate
- Shared steps CRUD and versioning (REPO-06) — steps-display.spec.ts may only cover rendering
- Custom fields with ALL field types (REPO-01) — case-creation-with-fields.spec.ts may not cover every type
- Nested folder hierarchy operations (REPO-02) — existing specs may test flat operations only

### Claude's Discretion
- Exact test organization for new gap-fill tests
- Whether to extend existing spec files or create new ones
- Which existing test failures to fix vs skip

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 27 existing E2E spec files in `testplanit/e2e/tests/repository/`
- `e2e/page-objects/repository/repository.page.ts`: RepositoryPage class
- `e2e/page-objects/repository/test-case.page.ts`: TestCasePage class
- `e2e/fixtures/api.fixture.ts`: ApiHelper with createCase, createFolder, createTag, cleanup
- case-creation-with-fields.spec.ts and result-creation-with-fields.spec.ts for field-specific tests

### Established Patterns
- Tests use page objects for repository interactions
- ApiHelper creates test data (cases, folders, tags) with auto-cleanup
- Tests are organized by feature within `Test Repository Management/` subdirectory

### Integration Points
- Repository pages: app/[locale]/projects/repository/[projectId]/
- Shared steps page: app/[locale]/projects/shared-steps/[projectId]/
- API routes: /api/repository/import, /api/model/RepositoryCases/*, /api/model/SharedStepGroup/*

</code_context>

<specifics>
## Specific Ideas

No specific requirements — gap-fill approach driven by what existing tests already cover.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-test-case-repository-e2e-tests*
*Context gathered: 2026-03-19*
