# Phase 22: Custom API Route Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

API tests for all custom (non-ZenStack-generated) API endpoints. Covers: project endpoints, test run endpoints, session endpoints, milestone endpoints, share link endpoints, report builder endpoints, admin endpoints, search/tag/issue counts, file upload/download, and health/metadata. Tests use Playwright request fixture or Vitest with mocked dependencies.

</domain>

<decisions>
## Implementation Decisions

### Test Strategy
- E2E API tests (Playwright request fixture) for endpoints that need real DB state
- Vitest unit tests for route handlers that can be isolated with mocks
- Many existing route tests already exist — gap-fill approach: check what's covered first
- Existing: model route test, signup, 2FA, api-tokens, bulk-edit, issue-counts, import, queue auth/tenant

### Coverage Approach
- CAPI-01: project endpoints (cases/bulk-edit, fetch-many, folders/stats)
- CAPI-02: test run endpoints (summary, attachments, import, completed, summaries)
- CAPI-03: session endpoints (summary)
- CAPI-04: milestone endpoints (descendants, forecast, summary)
- CAPI-05: share link endpoints (access, password-verify, report data)
- CAPI-06: report builder endpoints
- CAPI-07: admin endpoints (elasticsearch, queues, trash, user management)
- CAPI-08: search, tag/issue count aggregation
- CAPI-09: file upload/download
- CAPI-10: health, metadata, OpenAPI docs

### Claude's Discretion
- Which endpoints get E2E vs unit tests
- Mock depth for complex endpoints
- Test organization

</decisions>

<code_context>
## Existing Code Insights

### Existing Route Tests (10 files)
- app/api/model/[...path]/route.test.ts
- app/api/auth/signup/signup.test.ts
- app/api/auth/two-factor/two-factor.test.ts
- app/api/api-tokens/route.test.ts
- app/api/users/[userId]/route.test.ts
- app/api/projects/[projectId]/cases/bulk-edit/route.test.ts
- app/api/projects/issue-counts/route.test.ts
- app/api/repository/import/route.test.ts
- app/api/admin/queues/api-token-auth.test.ts
- app/api/admin/queues/tenant-filtering.test.ts

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 22-custom-api-route-tests*
*Context gathered: 2026-03-19*
