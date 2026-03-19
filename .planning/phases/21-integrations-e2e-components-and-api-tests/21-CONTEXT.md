# Phase 21: Integrations E2E, Components, and API Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E, component, and API tests for third-party integrations: issue tracker setup (Jira, GitHub, Azure DevOps), issue operations (create, link, sync), code repositories, and integration UI components. All with mocked external APIs.

</domain>

<decisions>
## Implementation Decisions

### Strategy
- All external APIs mocked (Jira, GitHub, Azure DevOps, GitLab, Bitbucket)
- E2E tests: integration setup wizard, issue linking from test cases
- Component tests: UnifiedIssueManager, CreateIssueDialog, SearchIssuesDialog, integration config forms
- API tests: /api/integrations/* endpoints with mocked external services
- Existing unit tests cover adapters thoroughly (11 adapter test files) — focus on UI and API layer

### Claude's Discretion
- Mock response shapes for each provider
- Which integration config forms to test
- Code repository setup depth

</decisions>

<code_context>
## Existing Code Insights

### Existing Tests
- lib/integrations/adapters/*.test.ts — 11 adapter unit tests
- lib/integrations/IntegrationManager.test.ts
- lib/integrations/cache/IssueCache.test.ts

### Integration Points
- Admin integrations: app/[locale]/admin/integrations/
- Project integrations: app/[locale]/projects/settings/[projectId]/integrations
- Issue components: components/issues/
- API: /api/integrations/*, /api/issues/*

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

*Phase: 21-integrations-e2e-components-and-api-tests*
*Context gathered: 2026-03-19*
