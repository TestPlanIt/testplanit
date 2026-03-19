---
phase: 09-authentication-e2e-and-api-tests
plan: 03
subsystem: testing
tags: [vitest, react-testing-library, auth, signin, signup, 2fa, component-tests]

# Dependency graph
requires: []
provides:
  - Component tests for signin page (form rendering, error states, 2FA dialog)
  - Component tests for signup page (validation, error states, duplicate email)
  - Component tests for 2FA setup page (loading, QR code, error states, verify step)
  - Component tests for 2FA verify page (OTP input, backup toggle, error, sign-out)
affects: [auth, testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "document.elementFromPoint mock required for input-otp library in jsdom (vi.fn returning null)"
    - "vi.hoisted() required for mocks used in vi.mock() factory functions to avoid hoisting errors"
    - "vi.stubGlobal for fetch override when beforeEach global.fetch assignment isn't picked up"
    - "Exact string matching for getByRole(button, {name}) when translation keys contain ambiguous substrings"

key-files:
  created:
    - testplanit/app/[locale]/signin/signin.test.tsx
    - testplanit/app/[locale]/signup/signup.test.tsx
    - testplanit/app/[locale]/auth/two-factor-setup/two-factor-setup.test.tsx
    - testplanit/app/[locale]/auth/two-factor-verify/two-factor-verify.test.tsx
  modified: []

key-decisions:
  - "Used exact translation key strings (e.g., 'common.actions.verify') for button selectors — more stable than regex when keys contain overlapping substrings"
  - "Mocked document.elementFromPoint in each 2FA test file to prevent input-otp library jsdom crash"
  - "Used vi.hoisted() for signOut mock in 2FA verify test to prevent ReferenceError from vi.mock hoisting"

patterns-established:
  - "Component tests co-located with page files per project convention"
  - "Session clearing effects require async act+setTimeout(0) to trigger before asserting form render"

requirements-completed: [AUTH-07]

# Metrics
duration: 35min
completed: 2026-03-19
---

# Phase 9 Plan 3: Auth Page Component Tests Summary

**Vitest component tests for signin, signup, 2FA setup, and 2FA verify pages covering form rendering, validation errors, loading states, and 2FA dialog flows using React Testing Library**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-03-19T01:39:00Z
- **Completed:** 2026-03-19T02:14:35Z
- **Tasks:** 2 of 2
- **Files modified:** 4 created

## Accomplishments

- Created 7 signin tests: form render, signup link, empty-field validation, invalid credentials error, 2FA dialog trigger, loading state, 2FA setup redirect
- Created 6 signup tests: form render, signin link, password mismatch, short name validation, duplicate email error, successful registration redirect
- Created 6 two-factor-setup tests: loading spinner, QR code display after API, error on setup failure, verify step structure, OTP container render, disabled verify button
- Created 8 two-factor-verify tests: OTP input render, disabled button, sign-out button, backup code toggle, toggle back to authenticator, error on invalid code, backup code length validation, signOut call

## Task Commits

Each task was committed atomically:

1. **Task 1: Signin and signup page component tests** - `e5bc6fc3` (test)
2. **Task 2: 2FA setup and verify page component tests** - `1cdb0f7e` (test)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `testplanit/app/[locale]/signin/signin.test.tsx` - 7 tests for signin page: form, errors, 2FA dialog, loading state
- `testplanit/app/[locale]/signup/signup.test.tsx` - 6 tests for signup page: form, validation, duplicate email
- `testplanit/app/[locale]/auth/two-factor-setup/two-factor-setup.test.tsx` - 6 tests for 2FA setup flow
- `testplanit/app/[locale]/auth/two-factor-verify/two-factor-verify.test.tsx` - 8 tests for 2FA verify page

## Decisions Made

- Used exact translation key strings for button selectors (e.g., `"auth.twoFactorVerify.useBackupCode"`) instead of regex patterns — the mock `useTranslations` returns the key itself as the string, and regex patterns matching "verify" also matched toggle buttons containing "twoFactor**Verify**" in their keys
- Used `vi.hoisted()` for the `mockSignOut` function in the 2FA verify test to prevent `ReferenceError: Cannot access 'mockSignOut' before initialization` caused by Vitest's hoisting of `vi.mock()` calls above variable declarations
- Added `document.elementFromPoint` mock at module level to prevent `TypeError: document.elementFromPoint is not a function` from the input-otp library's internal timer callback in jsdom
- Used `vi.stubGlobal("fetch", ...)` instead of `global.fetch = ...` assignment in specific tests where timing-sensitive mock overrides were needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed input-otp library crash in jsdom via document.elementFromPoint mock**
- **Found during:** Task 1 (signin test — 2FA dialog test)
- **Issue:** input-otp library calls `document.elementFromPoint` on timer tick, which is not implemented in jsdom, causing an unhandled exception that failed tests
- **Fix:** Added `document.elementFromPoint = vi.fn().mockReturnValue(null)` at module level in affected test files
- **Files modified:** signin.test.tsx, two-factor-setup.test.tsx, two-factor-verify.test.tsx
- **Verification:** Tests pass with no unhandled errors
- **Committed in:** e5bc6fc3, 1cdb0f7e

**2. [Rule 1 - Bug] Fixed vi.mock hoisting error for signOut mock**
- **Found during:** Task 2 (2FA verify tests)
- **Issue:** `const mockSignOut = vi.fn()` declared after `vi.mock()` call which is hoisted to top, causing `ReferenceError: Cannot access 'mockSignOut' before initialization`
- **Fix:** Used `vi.hoisted(() => ({ mockUpdateSession: vi.fn(), mockSignOut: vi.fn() }))` to declare mocks at hoist time
- **Files modified:** two-factor-verify.test.tsx
- **Verification:** Test file loads and all 8 tests pass
- **Committed in:** 1cdb0f7e

**3. [Rule 1 - Bug] Fixed ambiguous button selectors using regex that matched translation keys**
- **Found during:** Task 2 (2FA verify tests)
- **Issue:** Regex `/common\.actions\.verify|verify/i` matched both the verify button and toggle buttons because translation keys like `auth.twoFactorVerify.useBackupCode` contain "Verify" as a substring
- **Fix:** Changed all button selectors to use exact string matching (`name: "common.actions.verify"`) instead of regex
- **Files modified:** two-factor-verify.test.tsx
- **Verification:** `getByRole` no longer throws "Found multiple elements" error
- **Committed in:** 1cdb0f7e

---

**Total deviations:** 3 auto-fixed (all Rule 1 bugs)
**Impact on plan:** All fixes necessary for tests to pass correctly. No scope creep.

## Issues Encountered

- The signin page component has a `sessionCleared` state that gates form rendering — required `act(async () => setTimeout(r, 0))` to allow the useEffect to run before asserting form visibility
- The 2FA setup test for error display required `vi.stubGlobal` rather than `global.fetch =` assignment to ensure the mock was picked up correctly

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 auth page component tests are passing (27 total tests across 4 files)
- Test patterns established: document.elementFromPoint mock, vi.hoisted, exact translation key selectors
- Ready for next plan in Phase 9

---
*Phase: 09-authentication-e2e-and-api-tests*
*Completed: 2026-03-19*
