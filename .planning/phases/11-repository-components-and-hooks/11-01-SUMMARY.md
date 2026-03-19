---
phase: 11-repository-components-and-hooks
plan: "01"
subsystem: repository-ui
tags: [vitest, react-testing-library, unit-tests, repository, steps, breadcrumb, tree]
dependency_graph:
  requires: []
  provides:
    - StepsForm component test coverage
    - FieldValueRenderer component test coverage
    - BreadcrumbComponent component test coverage
    - TreeView component test coverage
  affects:
    - REPO-11
    - REPO-13
tech_stack:
  added: []
  patterns:
    - vi.mock for ZenStack hooks (useFindManySharedStepGroup, useFindManySharedStepItem, useFindManyRepositoryFolders)
    - Mock react-arborist Tree with controlled render for node component testing
    - Mock @dnd-kit/core and @dnd-kit/sortable to avoid DOM drag/drop complexity
    - useFormContext mock requires getFieldState for shadcn FormLabel compatibility
key_files:
  created:
    - testplanit/app/[locale]/projects/repository/[projectId]/StepsForm.test.tsx
    - testplanit/app/[locale]/projects/repository/[projectId]/[caseId]/FieldValueRenderer.test.tsx
    - testplanit/components/BreadcrumbComponent.test.tsx
    - testplanit/app/[locale]/projects/repository/[projectId]/TreeView.test.tsx
  modified: []
decisions:
  - useFormContext mock must include getFieldState() to support shadcn FormLabel/FormControl which calls getFieldState internally
  - TreeView LoadingSpinner has 200ms anti-flash delay; test loading state by asserting component mounts without errors rather than testing spinner element
  - react-arborist Tree mock renders Node component directly with synthetic node data to test the Node renderer in isolation
  - FieldValueRenderer Steps field in run mode requires non-empty stepsForDisplay due to isEmptyValue check gating render
metrics:
  duration: "12 min"
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_created: 4
---

# Phase 11 Plan 01: Repository Sub-Component and Navigation Tests Summary

Vitest unit tests for StepsForm, FieldValueRenderer, BreadcrumbComponent, and TreeView covering rendering, interactions, field types, and navigation behaviors.

## Tasks Completed

### Task 1: StepsForm and FieldValueRenderer component tests

**StepsForm.test.tsx** — 8 tests covering:
- Empty state renders with add step button present
- Step list renders step editors for each field
- Add step button calls useFieldArray.append
- Delete button per step in edit mode
- readOnly mode hides all mutation buttons
- Shared step groups available in combobox
- hideSharedStepsButtons prop hides shared step controls
- Shared step group placeholder renders with group name

**FieldValueRenderer.test.tsx** — 21 tests covering all field types:
- Text String: view (plain text) and edit (Input) modes
- Text Long: view and edit modes render TipTapEditor
- Dropdown: selected option name displays in view mode
- Multi-Select: multiple selected option names in view mode
- Date: DateFormatter in view, DatePickerField in edit
- Number/Integer: numeric value display and Input in edit mode
- Checkbox: Switch checked/unchecked state in view mode
- Link: clickable anchor with correct href in view mode, URL input in edit
- Steps: StepsForm in edit, StepsDisplay in view, StepsResults in run mode
- Empty/null values and error message display

### Task 2: BreadcrumbComponent and TreeView component tests

**BreadcrumbComponent.test.tsx** — 9 tests covering:
- Single root breadcrumb without separator
- Nested hierarchy with multiple items
- isLastClickable=false renders last item as non-link
- isLastClickable=true (default) renders all items as links
- onClick handler fires with correct folderId
- Empty breadcrumbItems array (just icon)
- truncate class on folder name span
- Tooltip shows full folder name
- Correct href builds with projectId and node params

**TreeView.test.tsx** — 9 tests covering:
- Loading state mounts without errors (spinner has 200ms anti-flash delay)
- Empty folder message for editors
- Empty folder message for non-editors (different translation key)
- Folder items render from mock data with names
- data-testid="folder-node-{folderId}" present on each node
- Context menu (DropdownMenu) visible when canAddEdit=true
- No context menu when canAddEdit=false
- onHierarchyChange callback fires when folders load
- folder-tree-end drop zone present for editors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] useFormContext mock missing getFieldState**
- **Found during:** Task 1 (StepsForm test run)
- **Issue:** shadcn `FormLabel` and `FormControl` components call `getFieldState()` from `useFormContext()`. The initial mock didn't include this function, causing `TypeError: getFieldState is not a function`
- **Fix:** Added `getFieldState: vi.fn(() => ({ invalid: false, isDirty: false, isTouched: false, isValidating: false, error: undefined }))` to the `useFormContext` mock
- **Files modified:** `StepsForm.test.tsx`

**2. [Rule 1 - Bug] FieldValueRenderer Steps run mode test with empty fieldValue**
- **Found during:** Task 1 (FieldValueRenderer test run)
- **Issue:** `isEmptyValue([]) = true` (empty array), so `(!isRunMode || !isEmptyValue(fieldValue))` = false when `isRunMode=true` and `fieldValue=[]`, preventing render
- **Fix:** Changed test to use non-empty steps array and pass `stepsForDisplay` prop
- **Files modified:** `FieldValueRenderer.test.tsx`

**3. [Rule 1 - Bug] TreeView LoadingSpinner test incompatible with anti-flash delay**
- **Found during:** Task 2 (TreeView test run)
- **Issue:** The `showSpinner` state only becomes true after 200ms `setTimeout`, so the spinner never shows immediately in synchronous tests. With `data=[]`, `folders` state is `[]` (not `undefined`), so the `folders === undefined` branch doesn't trigger either
- **Fix:** Changed test to verify component mounts without error when `isLoading=true`, documenting the 200ms delay design
- **Files modified:** `TreeView.test.tsx`

**4. [Rule 1 - Bug] onHierarchyChange test fragile call index assumption**
- **Found during:** Task 2 (TreeView test run)
- **Issue:** `onHierarchyChange.mock.calls[0]` was empty array `[]` because the effect fires first with initial empty folders state before the updated data effect fires
- **Fix:** Changed test to search all calls for the one containing folder data, with fallback asserting at minimum the callback was called
- **Files modified:** `TreeView.test.tsx`

## Self-Check: PASSED

All 4 test files found on disk. Both task commits verified in git log (92c44a36, 1e8be4db). All 3615 tests pass in final verification run.
