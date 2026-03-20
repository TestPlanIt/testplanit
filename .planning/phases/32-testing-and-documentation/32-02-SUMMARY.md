---
phase: 32-testing-and-documentation
plan: "02"
subsystem: docs
tags: [docusaurus, copy-move, user-guide, markdown]

requires:
  - phase: 31-entry-points
    provides: Three entry points for CopyMoveDialog (toolbar, context menu, bulk edit modal)
  - phase: 30-dialog-ui-and-polling
    provides: CopyMoveDialog three-step wizard with template/workflow/collision handling

provides:
  - User-facing documentation for copy/move feature at docs/docs/copy-move-test-cases.md
  - Covers all entry points, conflict handling, data carry-over, and troubleshooting

affects: []

tech-stack:
  added: []
  patterns:
    - "Docusaurus front matter with sidebar_position for docs ordering"

key-files:
  created:
    - docs/docs/copy-move-test-cases.md
  modified: []

key-decisions:
  - "sidebar_position: 11 (following import-export.md at position 10)"
  - "No screenshots in v0.17.0 docs — text is sufficient per plan discretion"
  - "Shared step groups section added based on actual CopyMoveDialog component (not in plan outline but factually accurate)"

patterns-established:
  - "Doc pages follow import-export.md pattern: front matter, intro, overview, getting started, detailed sections, tables, troubleshooting"

requirements-completed: [DOCS-01]

duration: 1min
completed: 2026-03-20
---

# Phase 32 Plan 02: Copy/Move Test Cases Documentation Summary

**Docusaurus user guide for cross-project copy/move covering three entry points, three-step wizard workflow, template/workflow/collision conflict handling, and data carry-over tables**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-20T23:05:16Z
- **Completed:** 2026-03-20T23:06:32Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `docs/docs/copy-move-test-cases.md` (129 lines) with complete Docusaurus front matter
- Documents all three entry points: repository toolbar, right-click context menu, bulk edit modal
- Covers three-step wizard flow: target selection, configure (compatibility + options), progress/results
- Explains template compatibility, workflow state mapping, naming collision resolution, and shared step group handling
- Includes data carry-over table and copy vs move differences table
- Adds troubleshooting section for four common issues

## Task Commits

Each task was committed atomically:

1. **Task 1: Create copy/move user documentation** - `d3fda4b8` (docs)

**Plan metadata:** (pending final commit)

## Files Created/Modified

- `docs/docs/copy-move-test-cases.md` - User-facing documentation for the copy/move feature published in the Docusaurus docs site

## Decisions Made

- Set `sidebar_position: 11` to place this page directly after `import-export.md` (position 10), keeping related data-management topics together.
- Added a Shared Step Groups section based on what the CopyMoveDialog component actually renders — the plan outline did not include it but it is factually part of the workflow and needed for completeness.
- No screenshots included per plan discretion note ("text is sufficient for v0.17.0").

## Deviations from Plan

None - plan executed exactly as written. One minor addition: documented the Shared Step Groups configuration option found in CopyMoveDialog.tsx, which was present in the actual component but not in the plan's template outline. This is factually accurate content, not scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DOCS-01 satisfied: user documentation published for copy/move feature
- Phase 32 plan 02 complete — all documentation requirements for v0.17.0 copy/move feature are satisfied
- Phase 32 plan 01 (E2E tests) is the remaining deliverable for this phase

---
*Phase: 32-testing-and-documentation*
*Completed: 2026-03-20*
