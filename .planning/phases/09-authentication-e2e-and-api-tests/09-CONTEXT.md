# Phase 9: Authentication E2E and API Tests - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify all authentication flows end-to-end and confirm API token behavior. Covers: sign-in/sign-out, sign-up with email verification, 2FA (TOTP + backup codes), SSO (Google, Microsoft, SAML), magic link, password change, session persistence, and API token auth. Component tests for auth pages. Does NOT cover admin SSO management (Phase 17) or integration OAuth flows (Phase 21).

</domain>

<decisions>
## Implementation Decisions

### E2E Auth Flow Strategy
- Mock SSO at NextAuth provider level — intercept OAuth callbacks with test tokens, no real provider needed
- Generate real TOTP codes from seeded 2FA secret — seed user with known secret, generate valid TOTP in test code
- Intercept magic link via DB token lookup or API request interception — bypass actual email delivery
- Use Playwright storage state for session persistence — login, save state, reload, verify still authenticated

### Test Data & Isolation
- Use ApiHelper.createUser() in beforeEach — matches existing pattern, auto-cleanup after each test
- Test "no access" / deactivated users by creating user then updating access level via API
- Each test creates its own users — full isolation, no test interdependencies
- Create API tokens via API route, test auth header enforcement — matches real usage pattern

### Coverage Boundaries
- Component tests for 4 main auth pages: signin, signup, 2FA setup, 2FA verify
- Do NOT test NextAuth internals (callbacks, JWT config) — test observable behavior only
- Test all user-visible error states: wrong password, expired token, disabled account, rate limited, invalid 2FA code
- Test email verification E2E via DB token lookup — create user, read verification token from DB, visit verification URL

### Claude's Discretion
- Exact mock implementation details for SSO providers
- TOTP library choice for generating test codes
- Test file organization within e2e/tests/auth/

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/page-objects/signin.page.ts`: SigninPage class with goto(), fillCredentials(), submit(), login(), verifyErrorMessage()
- `e2e/fixtures/api.fixture.ts`: ApiHelper with createUser(), deleteUser(), cleanup tracking
- `e2e/fixtures/index.ts`: Extended Playwright test with api, projectId, adminUserId fixtures
- `e2e/global-setup.ts`: DB seed + admin auth state to .auth/admin.json
- `lib/api-token-auth.ts`: authenticateApiToken(), extractBearerToken(), hasBearerToken()
- `lib/auth-security.ts`: CSRF tokens, state verification, redirect validation, rate limiting

### Established Patterns
- Storage state for unauthenticated tests: `test.use({ storageState: { cookies: [], origins: [] } })`
- Unique test data via timestamps: `test-user-${Date.now()}@domain.com`
- Page object pattern for form interactions
- API helper cleanup in afterAll/afterEach

### Integration Points
- Auth pages: signin, signup, two-factor-setup, two-factor-verify, verify-email, link-sso
- Auth API routes: signup, send-magic-link, logout, jwt, saml/*, two-factor/*
- API token routes: app/api/api-tokens
- Existing E2E tests: auth.spec.ts (basic smoke), signup.spec.ts (form validation + happy path)
- Existing unit tests: signup.test.ts, two-factor.test.ts, api-token-auth.test.ts, auth-security.test.ts

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

*Phase: 09-authentication-e2e-and-api-tests*
*Context gathered: 2026-03-18*
