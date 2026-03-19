# Phase 20: Search E2E and Component Tests - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

E2E and component tests for search: global search (Cmd+K), advanced operators, faceted filters, search result components. 1 existing advanced-search-operators.spec.ts. Repository search specs exist but are separate (Phase 10).

</domain>

<decisions>
## Implementation Decisions

### Coverage Strategy
- Gap-fill: advanced-search-operators.spec.ts exists (SRCH-02 partial)
- New specs: global search (Cmd+K), faceted search filters
- Component tests: UnifiedSearch, GlobalSearchSheet, search result components, FacetedSearchFilters
- Existing component tests: UnifiedSearch.test.tsx, CustomFieldDisplay.test.tsx, DateTimeDisplay.test.tsx, etc.

### Claude's Discretion
- Test organization and mock approach
- Which existing component tests to extend vs create new

</decisions>

<code_context>
## Existing Code Insights

### Existing Tests
- e2e/tests/search/advanced-search-operators.spec.ts
- components/UnifiedSearch.test.tsx
- components/search/CustomFieldDisplay.test.tsx, DateTimeDisplay.test.tsx, ProjectNameDisplay.test.tsx, SearchResultComponents.test.tsx, TestCaseSearchResult.test.tsx, UserDisplay.test.tsx
- e2e/page-objects/unified-search.page.ts

### Integration Points
- Global search: components/GlobalSearchSheet, UnifiedSearch
- Search API: /api/search
- Faceted filters: components/search/FacetedSearchFilters

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

*Phase: 20-search-e2e-and-component-tests*
*Context gathered: 2026-03-19*
