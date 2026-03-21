---
plan: "30-02"
phase: 30-dialog-ui-and-polling
status: complete
started: "2026-03-20"
completed: "2026-03-20"
duration: "15min"
---

# Plan 30-02 Summary: CopyMoveDialog Three-Step Wizard

## What Was Built

Three-step wizard dialog (`CopyMoveDialog.tsx`) for cross-project copy/move:
- **Step 1 (Target):** AsyncCombobox project picker (searchable, proper popover), AsyncCombobox folder picker (searchable + hierarchical with depth indentation)
- **Step 2 (Configure):** Copy/Move radio with descriptions, template/workflow compatibility warnings (yellow/red alerts), collision list with skip/rename, shared step group resolution
- **Step 3 (Progress):** Progress bar with X of Y text, cancel button, completion summary with expandable error list, "View in target project" link

Follows ImportCasesWizard pattern: numbered step circles (1-2-3) with connecting lines, `DialogDescription` per step, unified `DialogFooter` with ChevronLeft/ChevronRight navigation.

## Key Files

### Created
- `testplanit/components/copy-move/CopyMoveDialog.tsx` — 648-line three-step wizard
- `testplanit/components/copy-move/CopyMoveDialog.test.tsx` — 16 component tests

### Modified
- `testplanit/messages/en-US.json` — i18n keys under `components.copyMove`
- `testplanit/components/ui/async-combobox.tsx` — placeholder hover contrast fix
- `testplanit/app/api/repository/copy-move/schemas.ts` — hasSourceDeleteAccess → hasSourceUpdateAccess
- `testplanit/app/api/repository/copy-move/preflight/route.ts` — soft-delete permission check (update, not delete)
- `testplanit/app/api/repository/copy-move/route.ts` — soft-delete permission check

## Decisions

- Used AsyncCombobox for both project and folder pickers instead of inline Command/FolderSelect
- Move permission checks use canAddEdit (update) instead of delete access — move = soft-delete
- Wizard stepper matches ImportCasesWizard pattern (numbered circles, not pill buttons)
- Dialog widened to max-w-3xl with scrollable content area

## Self-Check: PASSED

All 16 CopyMoveDialog tests pass. All 5092 tests in full suite pass. Visual verification approved by user.
