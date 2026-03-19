# Phase 14: Project Management E2E and Components - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E and component tests for project management: creation wizard, settings, milestones, documentation editor, member management, project overview/dashboard. 2 existing specs (project-menu-settings, complete-milestone-options). Does NOT cover admin-level project management (Phase 17).

</domain>

<decisions>
## Implementation Decisions

### E2E Strategy
- Gap-fill: 2 existing specs cover project menu settings and milestone completion options
- New specs needed: project creation wizard, milestone CRUD, documentation editor, member management, project overview
- Writing assistant in documentation editor tested with mocked LLM response
- Use ApiHelper for project/milestone setup data

### Component Test Strategy
- Vitest tests for ProjectCard, ProjectMenu, ProjectQuickSelector
- Milestone component tests (list, detail, hierarchy, progress)
- Hook tests for useProjectPermissions and related
- Follow established mock patterns from prior phases

### Test Organization
- E2E specs in testplanit/e2e/tests/project-settings/ or new subdirectories
- Component tests co-located with components

### Claude's Discretion
- Exact test file organization
- Which milestone UI interactions to cover
- Mock approach for documentation TipTap editor

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/tests/project-settings/project-menu-settings.spec.ts` — existing pattern
- `e2e/tests/milestones/complete-milestone-options.spec.ts` — milestone pattern
- `hooks/useProjectPermissions.test.tsx` — existing hook test
- ApiHelper with project creation helpers

### Integration Points
- Project pages: app/[locale]/projects/overview/[projectId]/
- Milestone pages: app/[locale]/projects/milestones/[projectId]/
- Documentation: app/[locale]/projects/documentation/[projectId]/
- Settings: app/[locale]/projects/settings/[projectId]/

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

*Phase: 14-project-management-e2e-and-components*
*Context gathered: 2026-03-19*
