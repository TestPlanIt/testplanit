---
phase: 18-administration-component-tests
plan: "02"
subsystem: admin-component-tests
tags: [testing, vitest, admin, users, groups, roles, component-tests]
dependency_graph:
  requires: []
  provides: [EditUser component tests, EditGroup component tests, EditRoles component tests]
  affects: [ADM-13]
tech_stack:
  added: []
  patterns:
    - vi.hoisted() for stable mock refs to prevent OOM infinite re-renders in components with useEffect dependencies
    - Mock @prisma/client enums for jsdom test environment
    - Module-scoped mutable variables for per-test mock state (e.g. useEmptyAssignments flag, stableLoadingState.isLoading)
    - fireEvent over userEvent for Checkbox interactions in permissions matrix
key_files:
  created:
    - testplanit/app/[locale]/admin/users/EditUser.spec.tsx
    - testplanit/app/[locale]/admin/groups/EditGroup.spec.tsx
    - testplanit/app/[locale]/admin/roles/EditRoles.spec.tsx
  modified: []
decisions:
  - "vi.hoisted() required for stable array/object mock refs — new instances per render trigger infinite useEffect loops (OOM crash)"
  - "Module-level mutable variables (useEmptyAssignments, stableLoadingState) used for per-test mock state variation without vi.doMock"
  - "@prisma/client ApplicationArea mock required since enum values are iterated at module evaluation time via Object.values()"
metrics:
  duration: "25 min"
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_created: 3
---

# Phase 18 Plan 02: EditUser, EditGroup, and EditRoles Component Tests Summary

Three Vitest component spec files for admin form modals, covering EditUserModal, EditGroupModal, and EditRoleModal with form rendering, validation, submit behavior, and modal-specific features.

## Tasks Completed

### Task 1: EditUserModal and EditGroupModal component tests

**EditUser.spec.tsx** (6 tests):
- Renders SquarePen edit button
- Opens dialog with pre-filled name and email
- Shows validation error when name is empty
- Submits PATCH fetch request with correct payload
- isActive switch disabled when editing self (user.id === session.user.id)
- Cancel closes dialog

**EditGroup.spec.tsx** (7 tests):
- Renders edit button
- Opens dialog with group name pre-filled
- Shows assigned users list when data is loaded
- Shows "no users assigned" message when assignment list is empty
- Validates empty group name — mutation not called
- Remove user button removes user from displayed list
- Submit calls updateGroup mutation with correct data

**Commit:** 47e11218

### Task 2: EditRoleModal permissions matrix component tests

**EditRoles.spec.tsx** (12 tests):
- Renders edit button
- Opens dialog with role name pre-filled and permissions table
- Permissions table shows rows for all ApplicationArea enum values
- Table headers present: Add/Edit, Delete, Complete column headers
- canAddEdit shows '-' for ClosedTestRuns and ClosedSessions rows
- canDelete shows '-' for Documentation and Tags rows
- canClose shown only for TestRuns and Sessions (switch in those rows)
- Loading skeleton renders when isLoading is true (no table rendered)
- isDefault switch disabled when role already has isDefault: true
- Submit calls updateRole and upsertRolePermission mutations
- Validates empty role name — mutations not called
- Select-all canAddEdit checkbox sends canAddEdit: true to upsert calls

**Commit:** 5abae400

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] EditGroup OOM crash due to unstable mock data references**
- **Found during:** Task 1 (EditGroup tests)
- **Issue:** Mock hooks returning `data: []` as new array instances per render caused infinite `useEffect` re-renders in EditGroupModal (the effect depends on `allUsers` and `groupAssignments`), leading to heap OOM crash in Vitest worker
- **Fix:** Used `vi.hoisted()` to create stable array references (`stableAllUsers`, `stableGroupAssignments`, `stableEmptyAssignments`) shared via closure. Used module-level mutable variable (`useEmptyAssignments`) to control per-test variation.
- **Files modified:** `testplanit/app/[locale]/admin/groups/EditGroup.spec.tsx`

**2. [Rule 1 - Bug] @prisma/client ApplicationArea must be mocked for jsdom**
- **Found during:** Task 2 (EditRoles tests)
- **Issue:** `EditRoles.tsx` calls `Object.values(ApplicationArea)` at module evaluation time; without mocking `@prisma/client`, the Prisma client import would fail in jsdom
- **Fix:** Added `vi.mock("@prisma/client", ...)` with full ApplicationArea enum values
- **Files modified:** `testplanit/app/[locale]/admin/roles/EditRoles.spec.tsx`

**3. [Rule 1 - Bug] Test referenced non-existent ApplicationArea key "TestCases"**
- **Found during:** Task 2 (EditRoles tests) — first run
- **Issue:** Test was checking for text "TestCases" but the actual enum key is "TestCaseRepository"
- **Fix:** Updated assertion to use "TestCaseRepository"
- **Files modified:** `testplanit/app/[locale]/admin/roles/EditRoles.spec.tsx`

## Verification

All 25 tests pass:

```
Test Files: 3 passed
Tests: 25 passed
```

- EditUser.spec.tsx: 6 tests
- EditGroup.spec.tsx: 7 tests
- EditRoles.spec.tsx: 12 tests

## Self-Check: PASSED
