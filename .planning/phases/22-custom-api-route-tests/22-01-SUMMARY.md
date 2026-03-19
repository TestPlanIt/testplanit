---
phase: 22-custom-api-route-tests
plan: "01"
subsystem: api-routes
tags: [testing, api, vitest, unit-tests]
dependency_graph:
  requires: []
  provides: [CAPI-01, CAPI-02, CAPI-03]
  affects: []
tech_stack:
  added: []
  patterns:
    - vi.mock("next-auth") + vi.mock("~/lib/prisma") + vi.mock("~/server/auth") for route testing
    - S3Client class-based mock (not vi.fn().mockImplementation) for constructor compatibility
    - auditBulkCreate must mockResolvedValue(undefined) since route calls .catch() on return value
    - SSE stream routes: readSseResponse helper parses "data: {json}" lines for assertion
key_files:
  created:
    - testplanit/app/api/projects/[projectId]/cases/fetch-many/route.test.ts
    - testplanit/app/api/projects/[projectId]/folders/stats/route.test.ts
    - testplanit/app/api/sessions/[sessionId]/summary/route.test.ts
    - testplanit/app/api/test-runs/[testRunId]/summary/route.test.ts
    - testplanit/app/api/test-runs/attachments/route.test.ts
    - testplanit/app/api/test-runs/completed/route.test.ts
    - testplanit/app/api/test-runs/summaries/route.test.ts
    - testplanit/app/api/test-results/import/route.test.ts
  modified: []
decisions:
  - "S3Client vitest mock must use class keyword syntax, not vi.fn().mockImplementation, to satisfy new MockConstructor check"
  - "auditBulkCreate mock must return a Promise (mockResolvedValue) since route.ts calls .catch() on result at line 912"
  - "SSE import route reads through ReadableStream via Response.text() for SSE event assertions in vitest"
metrics:
  duration: "~12 min"
  completed: "2026-03-19"
  tasks_completed: 2
  files_created: 8
---

# Phase 22 Plan 01: Custom API Route Tests Summary

Vitest unit tests for 8 custom Next.js API route handlers covering project case fetching, folder statistics, test run summaries, attachments, completed runs, batch summaries, test result import, and session summaries.

## What Was Built

### Task 1: Project Endpoint and Session Summary Route Tests (CAPI-01, CAPI-03)

**fetch-many/route.test.ts** (15 tests) — POST route for fetching multiple repository cases by ID:
- Auth: 401 on null session, 401 on session without user ID
- Validation: 400 on non-numeric projectId, 400 on missing/invalid caseIds
- Project access: 404 on denied access, simplified query for ADMIN, OR-clause query for non-admin
- Success: cases + totalCount returned, caseIds ordering maintained, BigInt attachment sizes serialized to strings, pagination via skip/take
- Error: 500 on DB failure

**folders/stats/route.test.ts** (12 tests) — GET route for folder case hierarchy counts:
- Auth: 401 on null session, 401 on session without user ID
- Validation: 400 on non-numeric projectId
- Not found: 404 when project doesn't exist
- Access: 403 when user not in accessible projects
- Success: stats array with directCaseCount + totalCaseCount, correct hierarchy calculation (child counts bubble up to parent), all folders included
- runId param: testRunCases used when runId present, repositoryCases used otherwise
- Error: 500 on DB failure

**sessions/[sessionId]/summary/route.test.ts** (13 tests) — GET route for session summary data:
- Auth: 401 on null session, 401 on session without user
- Validation: 400 on non-numeric sessionId
- Not found: 404 when session not found
- Success: full SessionSummaryData shape, totalElapsed calculation (sum of result.elapsed), BigInt commentsCount to number, results with issueIds, sessionIssues array, result issue linking, estimate from session, empty results handling

### Task 2: Test Run Endpoint Route Tests (CAPI-02)

**test-runs/[testRunId]/summary/route.test.ts** (14 tests) — GET route for test run summary:
- Auth: 401/400/404 cases
- Regular run: TestRunSummaryData shape, workflowType, completionRate calculation, BigInt elapsed/commentsCount conversion, issues with projectIds, forecastManual override
- JUnit run: junitSummary field present, totalTests/failures/skipped calculated from aggregates

**test-runs/attachments/route.test.ts** (10 tests) — POST route for file uploads to S3:
- Auth: 401 without session/token, 401 with invalid token, pass-through with valid API token
- Validation: 400 no files, 400 missing testRunId, 400 invalid testRunId, 400 zero/negative testRunId
- Not found: 404 on nonexistent test run
- Success: summary shape returned, attachment record linked to test run and user
- Config: 500 when AWS_BUCKET_NAME missing

**test-runs/completed/route.test.ts** (11 tests) — GET paginated completed test runs:
- Auth: 401 cases
- Success: CompletedTestRunsResponse shape, totalCount/pageCount calculation, isCompleted=true filter, search filter, manual/automated runType filters, pagination (skip/take), completedAt:desc ordering
- Error: 500 on DB failure

**test-runs/summaries/route.test.ts** (10 tests) — GET batch summaries for multiple test runs:
- Auth: 401 cases
- Validation: 400 missing testRunIds, 400 all-invalid IDs, 400 >100 IDs
- Success: empty summaries on not found, summaries keyed by ID, comma-separated ID parsing, invalid ID skipping
- Error: 500 on DB failure

**test-results/import/route.test.ts** (9 tests) — POST SSE stream for test result import:
- Auth: 401 JSON response when no session/token, pass-through with valid API token
- SSE stream: text/event-stream content type, progress events + complete event with testRunId, error on missing fields, error on undetectable format, test run creation, test run reuse, error on type mismatch, error on missing template

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] S3Client mock constructor failure in attachments tests**
- **Found during:** Task 2
- **Issue:** `vi.fn().mockImplementation(() => ({ send: vi.fn() }))` fails Vitest's `new MockConstructor` check — S3Client is used with `new` keyword
- **Fix:** Changed to `class MockS3Client { send = mockS3Send; }` pattern
- **Files modified:** testplanit/app/api/test-runs/attachments/route.test.ts
- **Commit:** 3ca96671

**2. [Rule 1 - Bug] auditBulkCreate().catch() fails when mock returns undefined**
- **Found during:** Task 2
- **Issue:** import/route.ts line 912 calls `auditBulkCreate(...).catch(...)` which requires the return value to be a Promise; vi.fn() returns undefined
- **Fix:** Changed `auditBulkCreate: vi.fn()` to `auditBulkCreate: vi.fn().mockResolvedValue(undefined)`
- **Files modified:** testplanit/app/api/test-results/import/route.test.ts
- **Commit:** 3ca96671

## Self-Check: PASSED

All 8 test files found on disk. Both task commits verified (4c0b6aac, 3ca96671). 4532 tests pass across 268 test files.
