---
phase: 09-authentication-e2e-and-api-tests
plan: "01"
subsystem: e2e-tests
tags: [e2e, authentication, signin, signout, signup, email-verification, playwright]
dependency_graph:
  requires: []
  provides: [AUTH-01-coverage, AUTH-02-coverage]
  affects: [e2e-test-suite]
tech_stack:
  added: []
  patterns: [page-object-model, fixture-based-api-cleanup, nested-describe-storagestate]
key_files:
  created:
    - testplanit/e2e/tests/auth/signin-signout.spec.ts
    - testplanit/e2e/tests/auth/signup-email-verification.spec.ts
  modified: []
key_decisions:
  - "Nested describe blocks for storageState scoping — test.use() must be at describe level not inside test()"
  - "Deactivated user test uses default admin storageState with page.context().clearCookies() for browser unauthenticated state"
  - "Email verification test uses admin request context for DB token query while fresh browser context simulates real user"
  - "Single pnpm test:e2e invocation for both files — playwright webServer lifecycle kills server between invocations"
metrics:
  duration: "9m 27s"
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_created: 2
---

# Phase 9 Plan 01: Authentication Core E2E Tests Summary

**One-liner:** Playwright E2E tests for credential sign-in/sign-out and signup+email-verification flows using page-object model with api fixture cleanup.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Sign-in and sign-out E2E tests | 68fda5e4 | `testplanit/e2e/tests/auth/signin-signout.spec.ts` |
| 2 | Sign-up and email verification E2E tests | c146177b | `testplanit/e2e/tests/auth/signup-email-verification.spec.ts` |

## What Was Built

### `testplanit/e2e/tests/auth/signin-signout.spec.ts` (230 lines)

Six tests covering `AUTH-01` requirements:

1. **Sign-in with valid credentials redirects to home** — Creates test user via api fixture, logs in via SigninPage, asserts URL leaves /signin
2. **Sign-in with invalid password shows error** — Attempts wrong password, asserts errorMessage visible, URL stays on /signin
3. **Sign-in with non-existent email shows error** — Uses random email, asserts error shown
4. **Deactivated user cannot sign in** — Creates user, calls api.updateUser({ isActive: false }), clears browser cookies, asserts sign-in denied
5. **Sign-out clears session and redirects to signin** — Uses admin session, clicks user menu, clicks sign-out, asserts redirect to /signin, asserts /projects now redirects to /signin
6. **Session persists across page refresh** — Logs in, calls page.reload(), asserts still authenticated

### `testplanit/e2e/tests/auth/signup-email-verification.spec.ts` (211 lines)

Three tests covering `AUTH-02` requirements:

1. **Complete signup and email verification via real verification URL** — Creates unverified user via api.createUser, queries DB via admin request context for emailVerifToken, opens fresh browser context, navigates to `/en-US/verify-email?token=...&email=...`, waits for auto-submit, then confirms verified user can sign in without being redirected to verify-email
2. **Unverified user sees verify-email page after sign-in** — Creates user with emailVerified: false, signs in, asserts redirect to /verify-email and page title visible
3. **Resend verification email button exists** — Creates unverified user, signs in, asserts resend button on verify-email page

## Test Results

All 9 tests pass when run together:

```
9 passed (28.0s)
```

Individual verification (both files in one invocation, production build):
```bash
cd testplanit && pnpm build && E2E_PROD=on pnpm test:e2e \
  e2e/tests/auth/signin-signout.spec.ts \
  e2e/tests/auth/signup-email-verification.spec.ts
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test.use()` must be at describe level, not inside test()**
- **Found during:** Task 1 initial run (all 6 tests failed with "SyntaxError: Error reading storage state")
- **Issue:** Original code placed `test.use({ storageState: { cookies: [], origins: [] } })` inside each `test()` function — Playwright silently ignores `test.use()` inside test functions; it must be called at `describe` level. The tests were still inheriting the global admin.json storageState.
- **Fix:** Restructured into nested describe blocks — "Unauthenticated sign-in flows" with `test.use()` at describe level, "Deactivated user access" separate block, "Authenticated sign-out flow" separate block.
- **Files modified:** `testplanit/e2e/tests/auth/signin-signout.spec.ts`
- **Commit:** 68fda5e4

**2. [Rule 1 - Bug] Deactivated user test `api.updateUser()` failed with "Unauthorized" in unauthenticated describe block**
- **Found during:** Task 1 second run (1 test failed: "Failed to update user: Unauthorized")
- **Issue:** `api.updateUser()` uses `PATCH /api/users/${userId}` which requires admin session. When test is in the unauthenticated describe block (storageState: empty), both page and request fixture have no auth cookies. The `createUser` call succeeded (public signup endpoint), but `updateUser` to deactivate the user requires admin auth.
- **Fix:** Moved deactivated user test to its own describe block WITHOUT storageState override (uses default admin session), then calls `page.context().clearCookies()` before navigating to signin, giving a browser-level unauthenticated state while keeping the API request context authenticated.
- **Files modified:** `testplanit/e2e/tests/auth/signin-signout.spec.ts`
- **Commit:** 68fda5e4

**3. [Rule 1 - Bug] Email verification test `request` fixture lacks admin auth in unauthenticated describe block**
- **Found during:** Task 2 design phase
- **Issue:** The plan specified using `request.get('/api/model/user/findFirst')` with empty storageState, but that endpoint requires admin auth. The request fixture inherits storageState from test.use(), so empty storageState means no admin cookies.
- **Fix:** Kept the email verification test in the outer describe block (no storageState override, uses admin session from project config), then created a fresh `browser.newContext({ storageState: { cookies: [], origins: [] } })` for the browser navigation to simulate an unauthenticated user visiting the verify-email URL. This gives the request fixture admin auth for the DB query while the browser page is unauthenticated.
- **Files modified:** `testplanit/e2e/tests/auth/signup-email-verification.spec.ts`
- **Commit:** c146177b

**4. [Rule 1 - Bug] admin.json storage state file had corrupt JSON (double-brace `}}` at end)**
- **Found during:** Task 1 very first run
- **Issue:** The global setup had previously written a corrupted admin.json with an extra `}` at the end, causing Playwright to fail with "SyntaxError: Error reading storage state from admin.json: Unexpected non-whitespace character after JSON at position 1801"
- **Fix:** Manually fixed the file by removing the extra trailing brace. The file was valid after subsequent global-setup runs.
- **Files modified:** `testplanit/e2e/.auth/admin.json` (pre-existing bug, not in plan scope)

## Infrastructure Note

The playwright webServer lifecycle kills the server process between test invocations. Running multiple separate `pnpm test:e2e` commands in quick succession causes the second run's global-setup to fail connecting to the server. This is pre-existing infrastructure behavior — tests must be run in a single `pnpm test:e2e` invocation to share the server lifecycle.

## Self-Check: PASSED

- [x] `testplanit/e2e/tests/auth/signin-signout.spec.ts` — FOUND
- [x] `testplanit/e2e/tests/auth/signup-email-verification.spec.ts` — FOUND
- [x] `.planning/phases/09-authentication-e2e-and-api-tests/09-01-SUMMARY.md` — FOUND
- [x] Commit 68fda5e4 — FOUND
- [x] Commit c146177b — FOUND
