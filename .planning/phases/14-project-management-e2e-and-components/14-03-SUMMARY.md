---
phase: 14-project-management-e2e-and-components
plan: 03
subsystem: testing
tags: [vitest, react-testing-library, component-tests, hooks, project-management, milestones]

# Dependency graph
requires:
  - phase: 13-run-components-sessions-e2e-and-session-components
    provides: established vi.hoisted() patterns, useTranslations mock, ZenStack hook mock patterns
provides:
  - ProjectCard component tests (active/completed/loading states, count rendering)
  - ProjectMenu component tests (sections, permissions, collapsed state, active links)
  - ProjectQuickSelector component tests (popover, search, navigation, empty/loading)
  - MilestoneItemCard component tests (null guard, dropdown by role, state-based actions)
  - Extended useProjectPermissions hook tests (edge cases, caching, refetch behavior)
affects: [15-project-management-e2e-part2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.hoisted() for stable mock refs preventing infinite re-render loops in component tests"
    - "useTranslations mock returns last key segment for readable assertions"
    - "Accordion/DropdownMenu mocked as always-open for action visibility testing"
    - "Popover mock with stateful open/close via React.cloneElement prop injection"

key-files:
  created:
    - testplanit/components/ProjectCard.test.tsx
    - testplanit/components/ProjectMenu.test.tsx
    - testplanit/components/ProjectQuickSelector.test.tsx
    - testplanit/app/[locale]/projects/milestones/[projectId]/MilestoneItemCard.test.tsx
  modified:
    - testplanit/hooks/useProjectPermissions.test.tsx

key-decisions:
  - "ProjectMenu active link check: split className by space and compare cls === 'bg-primary' to avoid false match on 'hover:bg-primary/10' substring"
  - "MilestoneItemCard DropdownMenu mocked as always-rendered (not gated on open state) to enable dropdown item assertions without simulating trigger click"
  - "MilestoneItemCard forecast fetch mocked via vi.stubGlobal('fetch') returning 404 to suppress errors while keeping useEffect active"

patterns-established:
  - "Active link detection: split className.split(' ').some(cls => cls === 'bg-primary') for exact class match"
  - "Permission-conditional section test: first call to useProjectPermissions mock returns deny, subsequent calls return allow"
  - "Milestone action assertions: map dropdown-item textContent, check includes() for translated last key segment"

requirements-completed: [PROJ-07, PROJ-08, PROJ-09]

# Metrics
duration: 6min
completed: 2026-03-19
---

# Phase 14 Plan 03: Project Component and Hook Tests Summary

**Vitest component tests for ProjectCard, ProjectMenu, ProjectQuickSelector, MilestoneItemCard, and extended useProjectPermissions edge-case coverage (96 tests total, all passing)**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-19T13:36:53Z
- **Completed:** 2026-03-19T13:43:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- 17 tests for ProjectCard covering active/completed styling, count rendering (milestones, runs, sessions, cases, issues), loading state for issue counts, MemberList, and DateFormatter
- 23 tests for ProjectMenu covering all three accordion sections, permission-based visibility (ADMIN/PROJECTADMIN/USER/settings perms), collapsed state, active link highlighting with exact class match, and link hrefs
- 16 tests for ProjectQuickSelector covering popover open/close, project list rendering, iconUrl images, completed indicator, navigation on select (project + view-all), empty state, and loading state
- 26 tests for MilestoneItemCard covering null guards, status badge, dropdown visibility by access role, state-based action sets (not-started/started/completed), callback invocations, disabled Reopen for completed parent, level/compact props
- 6 new edge-case tests extending useProjectPermissions: projectId=0 (falsy guard), refetch on projectId change, refetch on area change, network exception (TypeError), and cache hit (no redundant fetch)

## Task Commits

Each task was committed atomically:

1. **Task 1: ProjectCard, ProjectMenu, ProjectQuickSelector tests** - `0543c4e6` (test)
2. **Task 2: MilestoneItemCard tests + useProjectPermissions extension** - `f8b1b3c5` (test)

## Files Created/Modified
- `testplanit/components/ProjectCard.test.tsx` - 17 tests for ProjectCard component
- `testplanit/components/ProjectMenu.test.tsx` - 23 tests for ProjectsMenu component
- `testplanit/components/ProjectQuickSelector.test.tsx` - 16 tests for ProjectQuickSelector
- `testplanit/app/[locale]/projects/milestones/[projectId]/MilestoneItemCard.test.tsx` - 26 tests for MilestoneItemCard
- `testplanit/hooks/useProjectPermissions.test.tsx` - Extended with 6 new tests (total: 14)

## Decisions Made
- Active link class detection uses `className.split(" ").some(cls => cls === "bg-primary")` to avoid a false positive from the `hover:bg-primary/10` substring match
- MilestoneItemCard DropdownMenu mocked as always-rendered so dropdown items are unconditionally present in the DOM — avoids needing to simulate trigger click
- Forecast fetch stubbed via `vi.stubGlobal("fetch")` returning 404 to silence console.error without suppressing the useEffect lifecycle entirely

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Active link assertion initially used `.toContain("bg-primary")` which matched the `hover:bg-primary/10` hover class. Fixed with exact split-class check. [Rule 1 auto-fix — no separate commit needed, fixed within same task run]

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 5 test files passing with 96 tests total
- PROJ-07, PROJ-08, PROJ-09 requirements complete
- Ready for Phase 14 plan 04 (if applicable) or next phase

---
*Phase: 14-project-management-e2e-and-components*
*Completed: 2026-03-19*
