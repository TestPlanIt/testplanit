---
phase: 21-integrations-e2e-components-and-api-tests
plan: 01
subsystem: testing
tags: [playwright, e2e, integrations, jira, github, azure-devops, simple-url, issues]

# Dependency graph
requires:
  - phase: 17-administration-e2e-tests
    provides: admin E2E patterns including group/role and API setup
  - phase: 19-reporting-e2e-and-component-tests
    provides: unauthenticated test pattern (storageState cookies/origins empty)
provides:
  - E2E tests for integration CRUD via /api/integrations custom endpoint
  - E2E tests for test-connection endpoint (SIMPLE_URL and external providers)
  - E2E tests for project integration linking via ZenStack REST API
  - E2E tests for issue create, link, unlink, sync cycle with SIMPLE_URL
  - E2E tests for external provider error shapes (GitHub, Jira, Azure DevOps)
  - Auth enforcement tests for all integration and issue endpoints
affects:
  - future integration component tests (know which endpoints work end-to-end)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Integration creation uses /api/integrations custom endpoint (not ZenStack REST API) because it handles credential encryption
    - ZenStack v3 requires relation connect syntax for Issue creation (integration: { connect: { id } } not integrationId)
    - External provider test-connection returns success:false JSON (not crash/500) when credentials invalid
    - unauthenticated incognito context pattern reused from Phase 19

key-files:
  created:
    - testplanit/e2e/tests/integrations/integrations-setup.spec.ts
    - testplanit/e2e/tests/integrations/integrations-issues.spec.ts
  modified:
    - testplanit/app/api/issues/[issueId]/link/route.ts
    - testplanit/app/api/issues/[issueId]/unlink/route.ts

key-decisions:
  - "Spec files placed in testplanit/e2e/tests/integrations/ (not testplanit/e2e/) because playwright.config.ts testDir is ./tests — plan path was relative to project root but E2E tests require subdirectory under tests/"
  - "ZenStack v3 Issue create requires relation connect syntax: integration: { connect: { id } }, project: { connect: { id } } — scalar FK fields (integrationId, projectId) rejected by ZenStack REST API"
  - "Link/unlink routes used wrong Prisma relation names (testCase, session, testRun) instead of schema names (repositoryCases, sessions, testRuns) — auto-fixed as Rule 1 bug"

patterns-established:
  - "Custom API endpoints (/api/integrations) tested via page.request.post/get directly — ZenStack REST API used for relational data setup only"
  - "External provider test-connection asserts error shape (success:false + error string) not just failure status — confirms graceful degradation pattern"
  - "Serial mode with test.describe.configure + beforeAll for shared integration/project state within each describe block"

requirements-completed: [INTG-01, INTG-02, INTG-03]

# Metrics
duration: ~60min
completed: 2026-03-19
---

# Phase 21 Plan 01: Integration Setup and Issue Operations E2E Tests Summary

**36 E2E tests covering integration CRUD, test-connection endpoint, project linking, and full SIMPLE_URL issue lifecycle with auth enforcement across all endpoints**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-03-19T19:00:00Z
- **Completed:** 2026-03-19T20:00:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- 20 integration setup tests: admin creates Jira/GitHub/Azure DevOps/SIMPLE_URL integrations, test-connection returns correct shapes, project linking verified via ZenStack REST API, code repo integration linking for INTG-03
- 16 issue operations tests: SIMPLE_URL issue create+link+unlink cycle works end-to-end, external provider endpoints return expected error shapes (not crashes), sync handles 404 gracefully, auth enforcement across all 5 endpoints
- Auto-fixed bug in link/unlink routes: relation names used in Prisma update were wrong (singular camelCase) vs schema plurals (repositoryCases, sessions, testRuns, testRunResults, testRunStepResults)

## Task Commits

Each task was committed atomically:

1. **Task 1: Integration setup E2E tests** - `4b8fec7a` (feat)
2. **Task 2: Issue operations E2E tests + bug fix** - `95d279c5` (feat)

## Files Created/Modified
- `testplanit/e2e/tests/integrations/integrations-setup.spec.ts` - Admin integration CRUD, test-connection, project linking, code repo (INTG-01, INTG-02, INTG-03)
- `testplanit/e2e/tests/integrations/integrations-issues.spec.ts` - Issue create/link/unlink/sync cycle, external provider error shapes, auth enforcement
- `testplanit/app/api/issues/[issueId]/link/route.ts` - Bug fix: corrected Prisma relation field names
- `testplanit/app/api/issues/[issueId]/unlink/route.ts` - Bug fix: corrected Prisma relation field names

## Decisions Made
- Spec files placed in `testplanit/e2e/tests/integrations/` subdirectory (plan specified `testplanit/e2e/` root) because `playwright.config.ts` has `testDir: ./tests` and test discovery only finds files there
- ZenStack REST API requires relation connect syntax for `issue/create` — scalar FK fields (`integrationId`, `projectId`) rejected
- Integration cleanup uses `beforeAll`/`afterAll` with unique `uniqueId` suffix to prevent test pollution in serial mode

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Spec files placed in e2e/tests/integrations/ not e2e/**
- **Found during:** Task 1 (creating integrations-setup.spec.ts)
- **Issue:** Plan specified `testplanit/e2e/integrations-setup.spec.ts` but playwright.config.ts testDir is `./tests`, so tests at root are not discovered
- **Fix:** Created `testplanit/e2e/tests/integrations/` directory and placed both files there
- **Files modified:** Directory structure only
- **Verification:** E2E runner discovered and executed all tests correctly
- **Committed in:** 4b8fec7a (Task 1 commit)

**2. [Rule 1 - Bug] Fixed wrong relation names in issue link/unlink routes**
- **Found during:** Task 2 (issue link test failed with 500 — ZenStack: "Unknown argument testCase")
- **Issue:** `/api/issues/[issueId]/link/route.ts` and `unlink/route.ts` used Prisma relation names `testCase`, `session`, `testRun`, `testRunResult`, `testRunStepResult` but schema.zmodel defines them as `repositoryCases`, `sessions`, `testRuns`, `testRunResults`, `testRunStepResults`
- **Fix:** Updated both routes to use correct plural schema relation names; also fixed `disconnect: true` (invalid for many-to-many) to `disconnect: { id: parseInt(entityId) }`
- **Files modified:** `testplanit/app/api/issues/[issueId]/link/route.ts`, `testplanit/app/api/issues/[issueId]/unlink/route.ts`
- **Verification:** Issue link and unlink tests pass; SIMPLE_URL full cycle confirmed end-to-end
- **Committed in:** 95d279c5 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking path fix, 1 bug fix)
**Impact on plan:** Both necessary for test execution. Bug fix improves correctness of link/unlink API endpoints beyond just tests.

## Issues Encountered
- ZenStack v3 REST API for `issue/create` rejects scalar FK fields (`integrationId`, `projectId`) — must use `integration: { connect: { id } }` and `project: { connect: { id } }` syntax (consistent with known ZenStack v3 migration learnings)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Integration setup and issue operation endpoints verified end-to-end
- Bug in link/unlink routes fixed — ManageExternalIssues and similar components should now work correctly
- Ready for Phase 21 Plan 02 (integration component tests)

---
*Phase: 21-integrations-e2e-components-and-api-tests*
*Completed: 2026-03-19*
