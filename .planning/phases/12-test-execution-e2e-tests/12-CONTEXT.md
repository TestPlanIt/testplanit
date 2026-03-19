# Phase 12: Test Execution E2E Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify all test run creation and execution workflows end-to-end. Covers: run creation wizard, step-by-step case execution with result recording, bulk status updates, case assignment, run completion workflow, multi-configuration runs, and JUnit XML import via API. Does NOT cover run UI components (Phase 13).

</domain>

<decisions>
## Implementation Decisions

### Coverage Strategy
- Gap-fill approach — 4 existing specs cover configuration combobox, edit config, multi-config selection, and summary
- RUN-05 (multi-config) is partially covered by test-run-multi-config-selection.spec.ts — verify and fill gaps
- RUN-01 (creation wizard), RUN-02 (case execution), RUN-03 (bulk status), RUN-04 (completion), RUN-06 (JUnit import) are gaps

### E2E Test Approach
- Use existing ApiHelper to create test data (projects, cases, runs)
- Test run creation wizard: navigate UI, select cases, set configuration, create run
- Case execution: open run, select case, record step results, verify status updates
- JUnit import: use API directly (POST /api/junit/import or /api/test-results/import) — this is an API-level test within the E2E framework
- Bulk status: select multiple cases in a run, apply status change

### Test Organization
- New spec files in testplanit/e2e/tests/test-runs/
- Follow existing naming pattern: test-run-*.spec.ts

### Claude's Discretion
- Exact test file organization and naming
- Which JUnit XML format details to test
- How to handle run completion status enforcement specifics

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/fixtures/api.fixture.ts`: ApiHelper with createTestRun, createTestRunCase helpers
- 4 existing test-run specs for patterns
- `e2e/page-objects/` — may have run-related page objects

### Established Patterns
- Configuration combobox tests use ApiHelper for setup
- Multi-config tests create configuration groups via API

### Integration Points
- Test run pages: app/[locale]/projects/runs/[projectId]/[runId]/
- API routes: /api/test-runs/*, /api/test-results/import, /api/junit/import
- Run creation: likely via UI dialog from test runs list page

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-test-execution-e2e-tests*
*Context gathered: 2026-03-19*
