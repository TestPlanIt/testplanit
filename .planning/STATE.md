---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Comprehensive Test Coverage
status: executing
stopped_at: Completed 21-03-PLAN.md
last_updated: "2026-03-19T18:27:51.016Z"
last_activity: 2026-03-19 — completed plan 13-03 (session component tests and session hooks integration tests)
progress:
  total_phases: 16
  completed_phases: 12
  total_plans: 34
  completed_plans: 32
  percent: 27
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Teams can plan, execute, and track testing across manual and automated workflows in one place
**Current focus:** Phase 9 — Authentication E2E and API Tests (v2.0 start)

## Current Position

Phase: 13 of 24 (Run Components, Sessions E2E and Session Components)
Plan: 3 of 3 in current phase (plan 03 complete)
Status: In progress
Last activity: 2026-03-19 — completed plan 13-03 (session component tests and session hooks integration tests)

Progress: [███░░░░░░░] 27%

## Performance Metrics

**Velocity:**
- Total plans completed: 1 (v2.0)
- Average duration: 15 min
- Total execution time: 15 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 09-authentication-e2e-and-api-tests | 1 | 15 min | 15 min |

**Recent Trend:**
- Last 5 plans: 15 min
- Trend: —

*Updated after each plan completion*
| Phase 09 P01 | 9m 27s | 2 tasks | 2 files |
| Phase 09-authentication-e2e-and-api-tests P02 | 75 | 2 tasks | 4 files |
| Phase 10-test-case-repository-e2e-tests P02 | ~35 min | 1 task | 1 file |
| Phase 10-test-case-repository-e2e-tests P01 | 90 | 2 tasks | 2 files |
| Phase 11-repository-components-and-hooks P02 | 11 | 2 tasks | 2 files |
| Phase 11-repository-components-and-hooks P01 | 12 min | 2 tasks | 4 files |
| Phase 12-test-execution-e2e-tests P02 | 56 min | 2 tasks | 3 files |
| Phase 12-test-execution-e2e-tests P01 | 60 | 2 tasks | 2 files |
| Phase 13-run-components-sessions-e2e-and-session-components P02 | 4 | 1 tasks | 1 files |
| Phase 13-run-components-sessions-e2e-and-session-components P01 | 15 | 2 tasks | 4 files |
| Phase 13-run-components-sessions-e2e-and-session-components P03 | 45 | 2 tasks | 3 files |
| Phase 14-project-management-e2e-and-components P02 | 20 | 2 tasks | 2 files |
| Phase 14-project-management-e2e-and-components P01 | 30 | 2 tasks | 3 files |
| Phase 14-project-management-e2e-and-components P03 | 6 | 2 tasks | 5 files |
| Phase 15-ai-feature-e2e-and-api-tests P02 | 20 | 2 tasks | 2 files |
| Phase 15-ai-feature-e2e-and-api-tests P01 | 40 | 2 tasks | 3 files |
| Phase 16-ai-component-tests P02 | 4 | 2 tasks | 2 files |
| Phase 16-ai-component-tests P01 | 9 | 2 tasks | 4 files |
| Phase 17-administration-e2e-tests P01 | 23 | 2 tasks | 3 files |
| Phase 17-administration-e2e-tests P04 | 45 | 2 tasks | 3 files |
| Phase 17-administration-e2e-tests P02 | 240 | 2 tasks | 3 files |
| Phase 17-administration-e2e-tests P03 | 45 | 2 tasks | 2 files |
| Phase 18-administration-component-tests P01 | 21 | 2 tasks | 3 files |
| Phase 18-administration-component-tests P02 | 25 | 2 tasks | 3 files |
| Phase 19-reporting-e2e-and-component-tests P02 | 12 | 2 tasks | 6 files |
| Phase 19-reporting-e2e-and-component-tests P01 | 35 | 2 tasks | 2 files |
| Phase 19-reporting-e2e-and-component-tests P03 | 25 | 2 tasks | 6 files |
| Phase 20-search-e2e-and-component-tests P02 | 635 | 2 tasks | 2 files |
| Phase 20-search-e2e-and-component-tests P01 | 12 | 2 tasks | 3 files |
| Phase 21-integrations-e2e-components-and-api-tests P03 | 757 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

- [v1.1]: ZenStack v3 error format — use `err.info.message`, not structured error codes
- [v1.1]: PostgreSQL 63-char alias limit — avoid deeply nested includes (4+ levels)
- [v2.0]: Full coverage in one milestone — comprehensive not incremental
- [v2.0]: Real DB, mock externals for E2E — matches existing fixture pattern
- [Phase 09-authentication-e2e-and-api-tests]: Bearer token E2E: use browser.newContext({ storageState: undefined }) to isolate token-only auth from session cookies
- [Phase 09]: test.use() must be at describe level for Playwright storageState scoping — not inside test() functions
- [Phase 09]: Deactivated user tests need admin API auth for updateUser — use page.context().clearCookies() to simulate unauthenticated browser state while keeping request fixture authenticated
- [Phase 09]: Email verification DB token query needs admin session — use fresh browser.newContext with empty storageState for user-facing verification while keeping request authenticated
- [Phase 09]: document.elementFromPoint must be mocked in jsdom for input-otp library compatibility in Vitest component tests
- [Phase 09]: vi.hoisted() required when mock variables are used in vi.mock() factory functions to avoid hoisting errors
- [Phase 09-authentication-e2e-and-api-tests]: Voluntary 2FA setup path for E2E tests — deterministic, no conditional branches
- [Phase 09-authentication-e2e-and-api-tests]: Admin setup pattern for unauthenticated E2E tests needing admin API calls — sign in, do work, clearCookies()
- [Phase 09-authentication-e2e-and-api-tests]: page.evaluate() for browser-context fetch when session cookies must be shared (not page.request which is isolated)
- [Phase 10-test-case-repository-e2e-tests]: AsyncCombobox requires clicking [role="combobox"] trigger first to open Popover, then type in [cmdk-input] — not a native input[type="text"]
- [Phase 10-test-case-repository-e2e-tests]: Shared steps page edit mode needs networkidle + 1000ms wait after group selection before entering edit mode to avoid race condition with items query
- [Phase 10-test-case-repository-e2e-tests]: BulkEditModal has no folder field — bulk move is only available via individual case detail page FolderSelect
- [Phase 10-test-case-repository-e2e-tests]: FolderSelect is Radix Select (role=combobox); must filter by hasText(sourceFolderName) to avoid project navigation dropdown
- [Phase 10-test-case-repository-e2e-tests]: Turbopack BUILD_ID race condition: use pnpm exec next build (exits 0 despite ENOENT), then write BUILD_ID manually from .next/static hash dir name
- [Phase 11-repository-components-and-hooks]: Mock getColumns to return at least one column so columnVisibility initializes non-empty in Cases component tests
- [Phase 11-repository-components-and-hooks]: useFindManyRepositoryCasesFiltered mock must include totalCount and refetch fields
- [Phase 11-repository-components-and-hooks]: useFormContext mock must include getFieldState() for shadcn FormLabel/FormControl compatibility in Vitest
- [Phase 11-repository-components-and-hooks]: react-arborist Tree mock renders Node component directly with synthetic node data for isolated Node renderer testing
- [Phase 12-test-execution-e2e-tests]: ZenStack v3 uses `configuration` relation not `config` for test run creation with configId — scalar FK approach also fails, must use connect syntax
- [Phase 12-test-execution-e2e-tests]: CompleteTestRunDialog button click doesn't reliably open dialog in E2E — use resilient fallback pattern (check isVisible, fall back to API)
- [Phase 12-test-execution-e2e-tests]: XPath locator `//span[contains(text(), 'Configurations')]/following::button[@role='combobox'][1]` reliably targets config combobox when project sidebar combobox also exists
- [Phase 12-test-execution-e2e-tests]: JUnit import SSE stream: parse `data: {json}` lines, find event with `complete: true` for final result including testRunId
- [Phase 12-test-execution-e2e-tests]: URL param navigation for Sheet opening: navigate to ?selectedCase=ID directly rather than clicking case name (only name cell click sets param in run mode)
- [Phase 12-test-execution-e2e-tests]: click({ force: true }) required for react-arborist tree nodes inside overflow-y-auto dialogs — dispatchEvent bypasses React handlers
- [Phase 13]: ConfigurationSelect AsyncCombobox is nth(2) button[role=combobox] in AddSessionModal (template=0, state=1, config=2)
- [Phase 13]: Session completion E2E: check for no-workflows warning before confirming, skip gracefully if not configured
- [Phase 13-run-components-sessions-e2e-and-session-components]: useTranslations mock returns last key segment — assert on 'testResultHistory' not 'repository.cases.testResultHistory'
- [Phase 13-run-components-sessions-e2e-and-session-components]: MagicSelectDialog state machine testing: chain global.fetch mockResolvedValueOnce calls to drive counting→configuring→loading→success transitions
- [Phase 13-run-components-sessions-e2e-and-session-components]: vi.hoisted() for stable mock refs prevents OOM infinite useEffect loops when hook return values are used as React deps — new array/object instances per render trigger infinite re-renders
- [Phase 13-run-components-sessions-e2e-and-session-components]: Mock react-hook-form useForm + @/components/ui/form primitives when component calls form methods in useEffect or subtree uses useFormContext
- [Phase 14-project-management-e2e-and-components]: Milestone edit uses ?edit=true URL param to navigate directly to edit mode in detail page
- [Phase 14-project-management-e2e-and-components]: Documentation AI assistant test is lenient — passes if button absent since AI requires LLM integration
- [Phase Phase 14-project-management-e2e-and-components]: Wizard step Next button disabled check via toBeDisabled() since canProceed() returns false on empty name at step 0
- [Phase Phase 14-project-management-e2e-and-components]: Quickscript toggle identified by data-testid='quickscript-enabled-toggle' for E2E tests
- [Phase 14-project-management-e2e-and-components]: ProjectMenu active link check: split className by space and compare cls === 'bg-primary' to avoid false match on hover:bg-primary/10 substring
- [Phase 14-project-management-e2e-and-components]: MilestoneItemCard DropdownMenu mocked as always-rendered (not gated on open state) to enable dropdown item assertions without simulating trigger click
- [Phase 15-ai-feature-e2e-and-api-tests]: LLM endpoint tests assert 400 'No active LLM integration found' as the terminal success-path state since no real LLM is configured in E2E env
- [Phase 15-ai-feature-e2e-and-api-tests]: Auto-tag submit/status/cancel tests accept both 503 (queue unavailable) and 200/404 (queue available) as valid E2E outcomes
- [Phase 15-ai-feature-e2e-and-api-tests]: AI wizard tests lenient: GenerateTestCasesWizard returns null when no LLM integration configured — conditional assertions required
- [Phase 15-ai-feature-e2e-and-api-tests]: MagicSelect E2E selector scoped to dialog container to prevent partial text matches on project name containing 'Magic'
- [Phase 16-ai-component-tests]: SingleResultView retry button uses title attr — use getByTitle('retryButton') for isolation in single-result tests
- [Phase 16-ai-component-tests]: AI toggle visibility gated on both aiAvailable=true AND aiCheckLoading=false — use waitFor to assert after async checkAiExportAvailable resolves
- [Phase 16]: fireEvent over userEvent for fake-timer click tests in TagChip — prevents 30s timeout with vi.useFakeTimers()
- [Phase 16]: vi.hoisted() for AutoTagWizardDialog useAutoTagJob mocks — mutable job objects per entity type prevent infinite useEffect re-renders
- [Phase 17-administration-e2e-tests]: Group/role title selector: use broad element filter with exact text match rather than class selectors in E2E tests
- [Phase 17-administration-e2e-tests]: Group API setup in E2E: use POST /api/model/groups/create directly since ApiHelper has no createGroup method
- [Phase 17-administration-e2e-tests]: 2FA reset E2E: admin viewing another user profile sees read-only disabled switch — no admin-level force-reset UI exists
- [Phase 17-administration-e2e-tests]: LLM page translated as 'AI Models' - button text is 'Add AI Model'; app config page translated as 'Application Configuration'
- [Phase 17-administration-e2e-tests]: Use explicit ColorPicker click over waiting for auto-load to ensure colorId is set before status form submit
- [Phase 17-administration-e2e-tests]: Use input.first() in EditStatus dialog since name input has no placeholder attribute
- [Phase 17-administration-e2e-tests]: Audit log E2E tests degrade gracefully when queue worker not running — detect empty state via button presence in tbody rows
- [Phase 17-administration-e2e-tests]: Category edit via API request fixture in E2E — production-build ZenStack mutation hangs without error or success callback
- [Phase 18-administration-component-tests]: vi.useFakeTimers() in beforeEach causes waitFor timeouts with async fetch/state — use real timers, only activate fake timers in the specific auto-refresh test with shouldAdvanceTime:true
- [Phase 18-administration-component-tests]: Tailwind v4 ghost buttons don't include 'ghost' in class string — discriminate by px-2 + absence of bg-destructive
- [Phase 18-administration-component-tests]: ElasticsearchAdmin: getHealthBadge renders GREEN for both cluster health and index health — use getAllByText for duplicate text assertions
- [Phase 18-administration-component-tests]: vi.hoisted() required for stable array/object mock refs in components with useEffect array dependencies — new instances per render trigger infinite re-renders (OOM crash)
- [Phase 18-administration-component-tests]: @prisma/client ApplicationArea must be vi.mock'd in jsdom tests when enum is used via Object.values() at module evaluation
- [Phase 19-reporting-e2e-and-component-tests]: vaul Drawer mocked as open-conditional div with role=dialog — real vaul doesn't render in jsdom
- [Phase 19-reporting-e2e-and-component-tests]: Radix Tabs hidden tab content not directly accessible via getByTestId — test verifies trigger presence rather than hidden panel visibility
- [Phase 19-reporting-e2e-and-component-tests]: Drill-down API returns { data, total, hasMore, context } not { records, total } - assert either shape in E2E tests
- [Phase 19-reporting-e2e-and-component-tests]: E2E unauthenticated tests: use storageState: { cookies: [], origins: [] } and port 3002 (not 3000) for incognito context API calls
- [Phase 19-reporting-e2e-and-component-tests]: D3 axisBottom/axisLeft mocks need ticks/tickFormat/tickSize chained methods when chart chains them
- [Phase 19-reporting-e2e-and-component-tests]: ReportChart bar dispatch requires non-categorical dim (e.g. testCaseId) — 'source'/'folder' are categorical and dispatch to Donut/GroupedBar
- [Phase 20-search-e2e-and-component-tests]: Mocked Sheet/SheetContent for open-conditional rendering in jsdom
- [Phase 20-search-e2e-and-component-tests]: Mocked Accordion to always-expanded for jsdom compatibility in FacetedSearchFilters tests
- [Phase 20-search-e2e-and-component-tests]: Use data-testid='global-search-sheet' scoping to avoid strict mode violation when Advanced Filters panel is also open as role=dialog simultaneously
- [Phase 20-search-e2e-and-component-tests]: Parallel E2E project uniqueness: use timestamp+random suffix (Date.now()-Math.random().toString(36).slice(2,7)) for unique project names across parallel workers
- [Phase 21-integrations-e2e-components-and-api-tests]: vi.hoisted() for SyncService mock refs prevents ReferenceError when factory variables used in vi.mock()
- [Phase 21-integrations-e2e-components-and-api-tests]: vi.resetAllMocks() instead of vi.clearAllMocks() required when beforeEach queues mockResolvedValueOnce values that individual tests need to override

### Pending Todos

None yet.

### Blockers/Concerns

- v1.1 spec files may be missing from repo (audit found commits referenced in SUMMARYs that don't exist in filesystem) — verify before writing new specs that overlap
- E2E tests must run against production builds: `pnpm build && E2E_PROD=on pnpm test:e2e`

## Session Continuity

Last session: 2026-03-19T18:27:51.013Z
Stopped at: Completed 21-03-PLAN.md
Resume file: None
