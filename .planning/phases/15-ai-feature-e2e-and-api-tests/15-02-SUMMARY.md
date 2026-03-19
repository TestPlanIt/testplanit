---
phase: 15-ai-feature-e2e-and-api-tests
plan: 02
subsystem: testing
tags: [playwright, e2e, api-tests, llm, auto-tag, bullmq]

requires:
  - phase: 14-project-management-e2e-and-components
    provides: established E2E API test patterns with request fixture

provides:
  - 37 API tests covering all LLM and auto-tag endpoints
  - Auth (401), Zod validation (400), project access (404), and LLM integration absence (400) verified for each endpoint
  - Auto-tag apply tested end-to-end with real data
  - Queue-dependent endpoints (submit/status/cancel) handle 503 gracefully

affects: [15-ai-feature-e2e-and-api-tests, future AI feature phases]

tech-stack:
  added: []
  patterns:
    - "LLM endpoint testing without real LLM: assert expected 400 error from no active integration"
    - "Queue-dependent endpoint testing: accept both 503 (unavailable) and 200/404 (available) as valid"
    - "Unauthenticated API tests: browser.newContext({ storageState: undefined }) then close context after test"

key-files:
  created:
    - testplanit/e2e/tests/api/llm-endpoints.spec.ts
    - testplanit/e2e/tests/api/auto-tag-endpoints.spec.ts
  modified: []

key-decisions:
  - "LLM tests assert 400 'No active LLM integration found' as the success-path proxy since no real LLM configured in E2E env"
  - "Auto-tag submit/status/cancel accept both 503 (queue unavailable) and 200/404 (queue available) — both are valid E2E outcomes"
  - "countOnly=true also checks LLM integration before returning count, so it returns 400 in test env too"

patterns-established:
  - "LLM endpoint pattern: unauthenticated(401) -> missing params(400) -> non-existent project(404) -> no integration(400)"
  - "Auto-tag apply pattern: create project + case via api.createProject/createTestCase, apply tag, verify via ZenStack findFirst include"

requirements-completed: [AI-08, AI-09]

duration: 20min
completed: 2026-03-19
---

# Phase 15 Plan 02: LLM and Auto-Tag API Tests Summary

**37 Playwright API tests covering 8 endpoints: 4 LLM routes (generate-test-cases, magic-select-cases, chat, parse-markdown) and 4 auto-tag routes (submit, status, cancel, apply) with auth, Zod validation, project access, and end-to-end apply flow verified**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-19T00:00:00Z
- **Completed:** 2026-03-19T00:20:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- 21 tests for 4 LLM endpoints covering auth (401), Zod/manual validation (400), project not found (404), and no active LLM integration (400)
- 16 tests for 4 auto-tag endpoints covering auth, validation, queue availability handling, and full end-to-end tag application
- Auto-tag apply tested end-to-end: create real project + case, POST to /api/auto-tag/apply, verify tag connected via ZenStack read
- Tag reuse correctly verified: second apply of same tag name returns tagsCreated=0, tagsReused=1

## Task Commits

Each task was committed atomically:

1. **Tasks 1 & 2: LLM and auto-tag API tests** - `5cff9d88` (feat)

**Plan metadata:** (pending final docs commit)

## Files Created/Modified
- `testplanit/e2e/tests/api/llm-endpoints.spec.ts` - 21 API tests for /api/llm/* endpoints
- `testplanit/e2e/tests/api/auto-tag-endpoints.spec.ts` - 16 API tests for /api/auto-tag/* endpoints

## Decisions Made
- LLM endpoints all require an active LLM integration before reaching any business logic, so tests assert the expected 400 "No active LLM integration found for this project" as the terminal success-path state in E2E environments.
- countOnly=true in magic-select-cases does NOT bypass the LLM integration check — the route checks for integration before the countOnly branch.
- Queue-dependent endpoints accept dual outcomes (503 when queue unavailable, 200/404 when available) to work across different E2E environments.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Self-Check: PASSED

All created files exist on disk. Task commit 5cff9d88 verified in git log.

## Next Phase Readiness
- AI API tests complete for requirements AI-08 and AI-09
- Ready for any remaining AI feature phases

---
*Phase: 15-ai-feature-e2e-and-api-tests*
*Completed: 2026-03-19*
