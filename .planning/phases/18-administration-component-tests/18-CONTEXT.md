# Phase 18: Administration Component Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Vitest component tests for admin UI: QueueManagement, ElasticsearchAdmin, audit log viewer (ADM-12) and user edit form, group edit form, role permissions matrix (ADM-13).

</domain>

<decisions>
## Implementation Decisions

### Test Strategy
- Vitest with React Testing Library, mock ZenStack hooks and API responses
- Test all states: loading, empty, error, populated
- Follow patterns from Phase 11/13/16 component tests
- vi.hoisted() for stable mock references

### Claude's Discretion
- Exact component selection and mock shapes
- Test file organization

</decisions>

<code_context>
## Existing Code Insights

### Key Components
- Queue: app/[locale]/admin/queues/ — QueueManagement, QueueJobsView
- Elasticsearch: app/[locale]/admin/elasticsearch/ — ElasticsearchAdmin
- Audit logs: app/[locale]/admin/audit-logs/
- User edit: app/[locale]/admin/users/
- Group edit: app/[locale]/admin/groups/
- Roles: app/[locale]/admin/roles/

### Existing Tests
- app/[locale]/admin/app-config/AddAppConfig.spec.tsx, EditAppConfig.spec.tsx, page.spec.tsx — admin component test patterns
- app/api/admin/queues/api-token-auth.test.ts, tenant-filtering.test.ts — queue-related tests

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

*Phase: 18-administration-component-tests*
*Context gathered: 2026-03-19*
