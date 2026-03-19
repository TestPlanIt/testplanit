---
phase: 20-search-e2e-and-component-tests
plan: "02"
subsystem: search
tags: [component-tests, search, vitest]
dependency_graph:
  requires: []
  provides: [GlobalSearchSheet component tests, FacetedSearchFilters component tests]
  affects: [SRCH-04 requirements coverage]
tech_stack:
  added: []
  patterns: [vi.hoisted for stable mock refs, mocked Accordion for always-expanded content, mocked Sheet for open-conditional rendering]
key_files:
  created:
    - testplanit/components/GlobalSearchSheet.test.tsx
    - testplanit/components/search/FacetedSearchFilters.test.tsx
  modified: []
key_decisions:
  - "Mocked Sheet/SheetContent to render children only when open=true (avoids Radix portal issues in jsdom)"
  - "Mocked Accordion to always render content expanded (avoids jsdom Radix expand/collapse issues)"
  - "Used vi.hoisted() for all hook mock refs in FacetedSearchFilters to prevent OOM from infinite useEffect re-renders"
  - "isAdmin mock in FacetedSearchFilters tests via ~/utils mock (component imports from ~/utils, not ~/utils/permissions)"
  - "Admin session mutation pattern: mutate mockSessionHolder.session before render for each test"
metrics:
  duration: ~10 min
  completed: "2026-03-19T17:02:14Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 20 Plan 02: Search Component Tests Summary

Component tests for GlobalSearchSheet and FacetedSearchFilters covering SRCH-04 requirements.

## What Was Built

### Task 1: GlobalSearchSheet component tests (7df67a86)

12 tests covering:
- Renders sheet content when open, hides when closed
- Sheet title and help button presence
- Navigation for all 7 entity types: REPOSITORY_CASE, TEST_RUN, SESSION, PROJECT, ISSUE, MILESTONE, SHARED_STEP
- Admin trash navigation for deleted items when admin user
- Normal entity navigation for deleted items when non-admin user

### Task 2: FacetedSearchFilters component tests (21c0820d)

11 tests covering:
- Filter container renders
- Project checkboxes from useFindManyProjects data
- Project checkbox toggle calls onFiltersChange with projectIds
- Tag checkboxes from useFindManyTags data
- Tag checkbox toggle calls onFiltersChange with tagIds
- Include deleted switch hidden for non-admin, visible for admin
- Include deleted toggle calls onFiltersChange with includeDeleted: true
- Clear all button resets filters
- Entity type badge and multiple entity types

## Verification Results

All 222 test files (4042 tests) pass including:
- components/GlobalSearchSheet.test.tsx (12 tests)
- components/search/FacetedSearchFilters.test.tsx (11 tests)
- components/UnifiedSearch.test.tsx (26 tests) — SRCH-02 verified
- components/search/CustomFieldDisplay.test.tsx — SRCH-05 verified
- components/search/DateTimeDisplay.test.tsx — SRCH-05 verified
- components/search/UserDisplay.test.tsx — SRCH-05 verified

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED
