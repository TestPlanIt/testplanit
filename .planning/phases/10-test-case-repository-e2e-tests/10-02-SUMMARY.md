---
phase: 10-test-case-repository-e2e-tests
plan: 02
subsystem: e2e-tests
tags: [e2e, shared-steps, repository, REPO-06]
dependency_graph:
  requires: []
  provides: [shared-steps-crud-e2e-coverage]
  affects: [REPO-06-requirement]
tech_stack:
  added: []
  patterns: [playwright-test, api-fixture-isolation, testid-selectors, async-combobox-interaction]
key_files:
  created:
    - testplanit/e2e/tests/repository/Test Repository Management/shared-steps.spec.ts
  modified: []
decisions:
  - AsyncCombobox in Playwright requires clicking the Button trigger (role=combobox) first to open the Popover, then typing in the CommandInput ([cmdk-input] selector) — not a native text input
  - Steps form in edit mode needs a networkidle wait + timeout before entering edit mode to ensure API items have fully loaded before form reset occurs
  - Shared step group deletion uses soft-delete (isDeleted: true) so the group disappears from the filtered list but is not hard-deleted
metrics:
  duration: "approx 35 min (including multiple build retries)"
  completed: "2026-03-19T03:10:00Z"
  tasks: 1
  files: 1
---

# Phase 10 Plan 02: Shared Steps Management E2E Tests Summary

**One-liner:** Playwright E2E tests for shared step group CRUD, edit, delete, and test case usage covering REPO-06 gap.

## What Was Built

Created `testplanit/e2e/tests/repository/Test Repository Management/shared-steps.spec.ts` with 5 tests covering the dedicated shared steps management page (`/en-US/projects/shared-steps/{projectId}`).

**Gap closed:** The existing `steps-display.spec.ts` only tested rendering of shared steps within test case detail views. The new tests cover the management UI.

## Tests Created

| Test | Description | Key Actions |
|------|-------------|-------------|
| Create Shared Step Group via UI | Opens ManualSharedStepsDialog, fills group name, adds 2 steps, saves | Clicks `manual-shared-steps-btn`, fills `manual-group-name-input`, uses `add-step-button`, saves via `save-manual-shared-steps-btn` |
| Edit Shared Step Group Name and Steps | Selects group, enters edit mode, renames, edits step text, adds step | Uses `edit-group-name-btn-main`, `edit-group-name-input-main`, `save-group-btn` |
| Delete Shared Step Group | Selects group, clicks delete, confirms | Uses `delete-group-btn`, `confirm-delete-group-btn` |
| Use Shared Step Group in Test Case | Creates project/case/group via API, adds shared steps to case via UI | Clicks `addSharedSteps` button, interacts with AsyncCombobox, saves test case |
| Shared Step Group Steps Count Reflects Updates | Creates group with 2 steps, adds 1 more, verifies count changes to 3 | Uses `group-steps-count` testid to verify before/after |

## Decisions Made

- **AsyncCombobox interaction pattern:** The `AsyncCombobox` renders a Popover trigger (`role=combobox`) that must be clicked to open the command palette. The search input uses `[cmdk-input]` selector rather than `input[type="text"]`. This pattern will be reused in any test that interacts with async comboboxes.

- **Edit mode load timing:** When selecting a group on the shared steps page, clicking the Edit button immediately after may cause the form to reset with an empty items array (race condition with the items query). Fix: wait for `networkidle` + 1s timeout before entering edit mode, then verify existing step editors are visible.

## All Tests Pass

Combined run with `steps-display.spec.ts` (12 total):
```
5 passed (shared-steps.spec.ts)
7 passed (steps-display.spec.ts)
12 passed total (28s)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AsyncCombobox interaction required popover click before text input**
- **Found during:** Task 1 (test 4 "Use Shared Step Group in Test Case")
- **Issue:** Test tried `locator('input[type="text"]')` inside alertdialog but AsyncCombobox renders a Button trigger that opens a Popover with CommandInput
- **Fix:** Click `[role="combobox"]` trigger first, then type in `[cmdk-input]`
- **Files modified:** shared-steps.spec.ts

**2. [Rule 1 - Bug] Edit mode race condition with items loading**
- **Found during:** Task 1 (test 5 "Shared Step Group Steps Count Reflects Updates")
- **Issue:** `step-editor-2` not found because items hadn't loaded before form was reset in edit mode
- **Fix:** Added `waitForLoadState("networkidle")` + 1000ms timeout before clicking Edit, plus explicit assertions that step-editor-0 and step-editor-1 are visible
- **Files modified:** shared-steps.spec.ts

## Build Notes

The project's Turbopack production build (`output: standalone`) exhibits a non-deterministic ENOENT failure during manifest file creation. This is a pre-existing issue unrelated to this plan's changes. Required 3 build attempts to succeed. The E2E test suite itself ran successfully once a valid build was obtained.

## Self-Check: PASSED

- shared-steps.spec.ts: FOUND
- 10-02-SUMMARY.md: FOUND
- commit 3acc6322: FOUND
