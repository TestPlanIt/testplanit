---
phase: 23-general-components
plan: 02
subsystem: components
tags: [tests, comments, attachments, onboarding, vitest]
dependency_graph:
  requires: []
  provides:
    - CommentEditor component tests
    - CommentList component tests
    - MentionSuggestion component tests
    - AttachmentsDisplay component tests
    - UploadAttachments component tests
    - NextStepOnboarding component tests
  affects: []
tech_stack:
  added: []
  patterns:
    - vi.hoisted() for stable mock refs in nextstepjs provider tests
    - Named export import guard (named vs default export discovery)
    - Capturing cardComponent from mocked nextstepjs NextStep to test TourCard
    - getAllByText for components rendering same text in multiple DOM locations
key_files:
  created:
    - testplanit/components/comments/CommentEditor.test.tsx
    - testplanit/components/comments/CommentList.test.tsx
    - testplanit/components/comments/MentionSuggestion.test.tsx
    - testplanit/components/AttachmentsDisplay.test.tsx
    - testplanit/components/UploadAttachments.test.tsx
    - testplanit/components/onboarding/NextStepOnboarding.test.tsx
  modified: []
decisions:
  - NextStepOnboarding named export: component uses `export function NextStepOnboarding` not default — import must use named import syntax
  - nextstepjs mock captures cardComponent: mock NextStep stores cardComponent ref via vi.hoisted() so TourCard tests can render it independently
  - AttachmentsDisplay name rendering: attachment name appears in multiple DOM locations (title div + preview + name field), use getAllByText not getByText
metrics:
  duration: 13 min
  completed_date: "2026-03-19"
  tasks: 2
  files: 6
---

# Phase 23 Plan 02: Comment System, Attachment, and Onboarding Tests Summary

Tests for comment system components (CommentEditor, CommentList, MentionSuggestion), attachment components (AttachmentsDisplay, UploadAttachments), and onboarding tour (NextStepOnboarding with TourCard).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Comment system component tests | fd9337bd | CommentEditor.test.tsx, CommentList.test.tsx, MentionSuggestion.test.tsx |
| 2 | Attachment and onboarding component tests | b21a2f05 | AttachmentsDisplay.test.tsx, UploadAttachments.test.tsx, NextStepOnboarding.test.tsx |

## Test Coverage

**CommentEditor** (9 tests): renders editor area, submit button state (enabled/disabled by isEmpty), onSubmit call, cancel button present/absent, loading spinner, disabled states.

**CommentList** (14 tests): empty state, comment editor rendering, comment list population, comment count in header, edit/delete visibility per user (creator vs other vs admin), createComment action call, new comment added to list, delete removes comment, entityType-specific ID in createComment.

**MentionSuggestion** (14 tests): renders user names and emails, null name falls back to email, secondary email display, destructive badge for non-project-members, no badge for members, empty list shows noUsersFound, command called on click with correct user data, keyboard navigation (ArrowDown/ArrowUp/Enter/unknown) via ref.onKeyDown, returns false for unhandled keys, avatar rendering.

**AttachmentsDisplay** (15 tests): empty array renders null, attachment names rendered, preview component present, download link for non-uri-list, no download for uri-list, file size label, preventEditing hides delete trigger, deferredMode shows delete trigger, onSelect called on click, name/createdBy labels, user name cell, deferred mode editable name input, description textarea.

**UploadAttachments** (15 tests): file input present, card in normal mode, no card in compact mode, multiple attribute, single mode, disabled state, onFileSelect called, file names shown after selection, remove file, accept prop, label present, compact label, initialFiles seeding, invalid type error, no error for valid type.

**NextStepOnboarding** (14 tests): renders without crash, renders NextStepProvider, loading state, hasCompletedWelcomeTour false/true, passes cardComponent. **TourCard** (8 tests): title/content rendered, skip button calls skipTour, Next button calls nextStep, Finish on last step, no Previous on first step, Previous calls prevStep on step > 0, progress indicator format.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Named vs default import for NextStepOnboarding**
- **Found during:** Task 2, all tests failing with "Element type is invalid: got undefined"
- **Issue:** `NextStepOnboarding` is a named export (`export function NextStepOnboarding`) but test used `import NextStepOnboarding from "..."` (default import), yielding `undefined` as the component type
- **Fix:** Changed to `import { NextStepOnboarding } from "./NextStepOnboarding"`
- **Files modified:** testplanit/components/onboarding/NextStepOnboarding.test.tsx
- **Commit:** b21a2f05

**2. [Rule 1 - Bug] CommentList comment count text fragmented across elements**
- **Found during:** Task 1
- **Issue:** `{t("comments.title")} (${comments.length})` renders as sibling text nodes inside h3, `getByText("(1)")` fails
- **Fix:** Used `screen.getByRole("heading").textContent` to check the full heading text
- **Files modified:** testplanit/components/comments/CommentList.test.tsx
- **Commit:** fd9337bd

**3. [Rule 1 - Bug] MentionSuggestion second button class assertion used incorrect regex**
- **Found during:** Task 1
- **Issue:** Regex `/^.*bg-accent(?!\s*text-accent).*$/` incorrectly matched "hover:bg-accent" class on non-selected buttons
- **Fix:** Split className by space and check for direct "bg-accent" class (without hover: prefix)
- **Files modified:** testplanit/components/comments/MentionSuggestion.test.tsx
- **Commit:** fd9337bd

**4. [Rule 2 - Missing mock] MentionSuggestion useNextStep needs setCurrentStep**
- **Found during:** Task 2
- **Issue:** `NextStepController` in the component calls `setCurrentStep` from `useNextStep()`, mock was missing this method
- **Fix:** Added `setCurrentStep: vi.fn()` to the `useNextStep` mock
- **Files modified:** testplanit/components/onboarding/NextStepOnboarding.test.tsx
- **Commit:** b21a2f05

**5. [Rule 2 - Missing mock] ApplicationArea enum missing SharedSteps/Reporting/Settings values**
- **Found during:** Task 2
- **Issue:** Component uses `ApplicationArea.SharedSteps`, `ApplicationArea.Reporting`, `ApplicationArea.Settings` for permission checks
- **Fix:** Added those values to the `@prisma/client` mock
- **Files modified:** testplanit/components/onboarding/NextStepOnboarding.test.tsx
- **Commit:** b21a2f05

## Key Decisions

- `vi.hoisted()` for `mockNextStepCardComponent` ref — stable object reference allows capturing `cardComponent` from the mocked `NextStep` during render, enabling `TourCard` to be tested without exporting it
- `AttachmentsDisplay` test skips `onRemove` prop testing since the component no longer supports direct delete (only `deferredMode` deletes). Plan acceptance criteria mentioned `onRemove` but actual component prop is `onPendingChanges` in deferred mode.
- `UploadAttachments` uses `URL.createObjectURL` mock to avoid jsdom File URL errors in thumbnail generation

## Self-Check: PASSED

- All 6 test files created and verified on disk
- Both task commits (fd9337bd, b21a2f05) confirmed in git log
- All 82 tests pass via `pnpm vitest run`
