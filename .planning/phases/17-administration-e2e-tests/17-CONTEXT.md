# Phase 17: Administration E2E Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E tests for all admin management workflows. 10 existing specs cover users, templates/fields, SSO email config, and prompts. This phase fills gaps for: groups, roles, SSO providers, workflows, statuses, configurations, audit logs, elasticsearch, LLM integrations, and app config. Does NOT cover admin component unit tests (Phase 18).

</domain>

<decisions>
## Implementation Decisions

### Coverage Strategy
- Gap-fill: 10 existing admin specs already cover users (ADM-01 partial), templates/fields
- ADM-01 partially covered by user-profile.spec.ts and user-updates.spec.ts — add deactivation, reset 2FA, revoke API keys
- ADM-02 through ADM-11 are new gaps requiring new spec files

### Test Organization
- New specs in testplanit/e2e/tests/admin/ following existing subdirectory pattern
- Each admin area gets its own spec file

### Claude's Discretion
- Exact spec file naming and organization
- Which admin operations require complex setup vs simple navigation tests
- Elasticsearch and queue admin tests may be limited by environment availability

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 10 existing admin specs for patterns
- ApiHelper with user, project, and template helpers
- Admin pages all under app/[locale]/admin/

### Integration Points
- Admin pages: /admin/users, /admin/groups, /admin/roles, /admin/sso, /admin/workflows, /admin/statuses, /admin/configurations, /admin/audit-logs, /admin/elasticsearch, /admin/llm, /admin/app-config

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

*Phase: 17-administration-e2e-tests*
*Context gathered: 2026-03-19*
