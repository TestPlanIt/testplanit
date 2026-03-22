---
phase: 38-export-import-and-testing
plan: 03
subsystem: testing
tags: [e2e, playwright, llm, admin, prompt-config, ai-models, feature-overrides]

# Dependency graph
requires:
  - phase: 36-admin-prompt-editor-llm-selector
    provides: admin prompt editor with LLM integration selector per feature
  - phase: 37-project-ai-models-overrides
    provides: project AI Models feature overrides table with per-feature select
provides:
  - E2E tests for admin prompt editor LLM selector workflow (select, save, reload verify, clear)
  - E2E tests for project AI Models per-feature override workflow (assign, verify badge, clear)
affects: [38-export-import-and-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "API-first test setup: create project via api.createProject() instead of relying on hardcoded projectId fixture"
    - "Translation-aware option matching: use exact translated text ('Project Default (clear)') not conceptual name"

key-files:
  created:
    - testplanit/e2e/tests/admin/prompt-configurations/prompt-llm-selector.spec.ts
    - testplanit/e2e/tests/projects/settings/ai-models-overrides.spec.ts
  modified: []

key-decisions:
  - "Use api.createProject() for projectId in ai-models tests — the projectId fixture defaults to 1, which does not exist in the seeded E2E database"
  - "Option text for __clear__ sentinel is 'Project Default (clear)' per en-US.json translation, not 'Project Default'"
  - "Created testplanit/e2e/tests/projects/settings/ directory as a new subdirectory following the plan's file specification"

patterns-established:
  - "When testing project-scoped pages, create a fresh project via api.createProject() to get a valid ID"
  - "When selecting shadcn Select items with sentinel values, verify translation key value not assumed text"

requirements-completed: [TEST-03, TEST-04]

# Metrics
duration: 7min
completed: 2026-03-21
---

# Phase 38 Plan 03: Prompt LLM Selector and AI Models Overrides E2E Tests Summary

**Playwright E2E tests for admin prompt editor LLM selector workflow and project AI Models per-feature override table, covering select/save/reload/clear flows for both UIs**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-21T20:15:00Z
- **Completed:** 2026-03-21T20:22:00Z
- **Tasks:** 2
- **Files modified:** 2 created

## Accomplishments
- E2E test verifies admin can select an LLM integration for a prompt feature, save, reload, and see it pre-selected
- E2E test verifies admin can clear an LLM integration (select "Project Default (clear)") and it saves as null after reload
- E2E test verifies project admin can assign a per-feature LLM override and see "Project Override" badge with effective LLM name
- E2E test verifies project admin can clear a per-feature override and the badge/X button disappear
- E2E test verifies the feature overrides table shows all 7 LLM features

## Task Commits

Each task was committed atomically:

1. **Task 1: E2E tests for admin prompt editor LLM selector** - `0f9d7b3c` (feat)
2. **Task 2: E2E tests for project AI Models per-feature overrides** - `ba031c7f` (feat)

**Plan metadata:** (final commit hash will be added after docs commit)

## Files Created/Modified
- `testplanit/e2e/tests/admin/prompt-configurations/prompt-llm-selector.spec.ts` - Two E2E tests for admin prompt editor: select integration + save, clear integration + save
- `testplanit/e2e/tests/projects/settings/ai-models-overrides.spec.ts` - Three E2E tests for project AI Models: show all 7 features, assign override, clear override

## Decisions Made
- Used `api.createProject()` for project-scoped AI models tests — the `projectId` fixture defaults to `1` which does not exist in the E2E seeded database (seeded project IDs are auto-incremented to 40000+ range)
- Option label for the `__clear__` sentinel in the LLM Integration selector is `"Project Default (clear)"` per `messages/en-US.json` key `admin.prompts.projectDefault`, not `"Project Default"` (which is the placeholder text from `admin.prompts.llmIntegrationPlaceholder`)
- Created `testplanit/e2e/tests/projects/settings/` as a new subdirectory as specified by the plan's `files_modified` field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected option text for __clear__ sentinel from "Project Default" to "Project Default (clear)"**
- **Found during:** Task 1 (prompt-llm-selector.spec.ts test execution)
- **Issue:** Test clicked `page.getByRole("option", { name: "Project Default" })` but the actual option text is "Project Default (clear)" per `admin.prompts.projectDefault` translation key; the placeholder "Project Default" is a different translation key (`admin.prompts.llmIntegrationPlaceholder`)
- **Fix:** Changed option name to `"Project Default (clear)"` to match the actual rendered text
- **Files modified:** testplanit/e2e/tests/admin/prompt-configurations/prompt-llm-selector.spec.ts
- **Verification:** Test passes after fix
- **Committed in:** `0f9d7b3c` (Task 1 commit)

**2. [Rule 1 - Bug] Replaced hardcoded projectId fixture with api.createProject() for AI models tests**
- **Found during:** Task 2 (ai-models-overrides.spec.ts test execution)
- **Issue:** `projectId` fixture defaults to `1` but E2E seeded project IDs are in the 40000+ range; FK constraint violations on `linkLlmToProject` and 404 on page navigation
- **Fix:** Used `api.createProject()` to create a fresh project in each test, getting a valid dynamic ID
- **Files modified:** testplanit/e2e/tests/projects/settings/ai-models-overrides.spec.ts
- **Verification:** All 3 tests pass after fix
- **Committed in:** `ba031c7f` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs — test selector and fixture mismatch)
**Impact on plan:** Both auto-fixes necessary for test correctness. No scope creep.

## Issues Encountered
- The `projectId: 1` fixture is a placeholder default value that doesn't correspond to a real seeded project — tests needing project-scoped pages should always create their own project via API

## Next Phase Readiness
- TEST-03 and TEST-04 coverage complete
- Both test files are passing against the production build
- No blockers for remaining phase 38 plans

---
*Phase: 38-export-import-and-testing*
*Completed: 2026-03-21*

## Self-Check: PASSED

- FOUND: testplanit/e2e/tests/admin/prompt-configurations/prompt-llm-selector.spec.ts
- FOUND: testplanit/e2e/tests/projects/settings/ai-models-overrides.spec.ts
- FOUND: .planning/phases/38-export-import-and-testing/38-03-SUMMARY.md
- FOUND: commit 0f9d7b3c (Task 1)
- FOUND: commit ba031c7f (Task 2)
