# Phase 11: Repository Components and Hooks - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Create Vitest component tests for repository UI components and hook tests for repository-related data hooks. Covers: test case editor (TipTap, custom fields, steps, attachments), repository table (sorting, pagination, column visibility, view switching), folder tree/breadcrumbs, and repository data hooks. Does NOT cover E2E tests (Phase 10 — done).

</domain>

<decisions>
## Implementation Decisions

### Component Test Strategy
- Thorough coverage with edge cases — error states, empty states, loading states per user decision
- Use React Testing Library patterns matching existing component tests in the codebase
- Mock ZenStack hooks (useFindMany*, useCreate*, etc.) since these are component-level tests
- Mock next-intl translations using existing vitest.setup.tsx patterns
- Test rendering, user interactions (clicks, inputs), and data display

### Existing Component Tests to Reference
- `app/[locale]/projects/repository/[projectId]/BulkEditModal.test.tsx` — existing pattern for repository component tests
- `app/[locale]/projects/repository/[projectId]/ImportCasesWizard.test.tsx` — wizard component test pattern
- `app/[locale]/projects/repository/[projectId]/LastTestResultCell.test.tsx` — cell component pattern
- `app/[locale]/projects/repository/[projectId]/ProjectRepository.filter-clearing.test.tsx` — filter behavior pattern
- `hooks/useRepositoryCasesWithFilteredFields.test.ts` — existing hook test pattern
- `components/tiptap/TipTapEditor.test.tsx` — existing TipTap test

### Hook Test Strategy
- Test useRepositoryCasesWithFilteredFields and related hooks with mock data
- Verify data transformation, filtering, and state management logic
- Use renderHook from @testing-library/react

### Claude's Discretion
- Exact component selection within each category (test the most complex/important ones)
- Mock implementation details
- Test file organization

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `vitest.setup.tsx`: Global mocks for next/navigation, next-auth/react, next-intl, matchMedia, ResizeObserver
- Existing component test patterns in repository directory
- `hooks/useRepositoryCasesWithFilteredFields.test.ts` and `.integration.test.tsx` — hook test patterns

### Established Patterns
- Co-located test files: `ComponentName.test.tsx` next to the component
- Mock pattern: vi.mock() for external modules, vi.fn() for callbacks
- Render + query pattern: render(<Component {...props} />), screen.getByText/getByRole

### Integration Points
- Test case editor: components within `app/[locale]/projects/repository/[projectId]/`
- Repository table: uses DataTable from `components/tables/DataTable`
- Folder tree: custom component in repository area
- Breadcrumbs: `components/BreadcrumbComponent`

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

*Phase: 11-repository-components-and-hooks*
*Context gathered: 2026-03-19*
