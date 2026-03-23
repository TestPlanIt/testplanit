---
phase: 49-resolution-engine
plan: "01"
subsystem: merge-service
tags: [merge, resolution, prisma-transaction, duplicate-detection]
dependency_graph:
  requires:
    - "lib/prismaBase (raw Prisma client)"
    - "services/repositoryCaseSync (ES sync)"
    - "schema.zmodel (RepositoryCases, DuplicateScanResult, RepositoryCaseLink, TestRunCases, RepositoryCaseVersions)"
  provides:
    - "mergeCases() — atomic FK reroute transaction"
    - "linkCases() — creates RepositoryCaseLink + LINKED status"
    - "dismissPair() — sets scan result to DISMISSED"
  affects:
    - "app/api/duplicate-scan/resolve/route.ts (next plan — consumes these exports)"
tech_stack:
  added: []
  patterns:
    - "prisma.$transaction(async tx => ...) — raw prismaBase client, not ZenStack enhanced"
    - "vi.hoisted() for mock objects referenced in vi.mock() factories"
    - "createMany skipDuplicates:true for M2M reroutes with unique constraints"
key_files:
  created:
    - testplanit/lib/services/mergeService.ts
    - testplanit/lib/services/mergeService.test.ts
  modified: []
decisions:
  - "vi.hoisted() required for mock objects in vi.mock() factories — vi.mock is hoisted before variable declarations"
  - "linkCases uses static array form of prisma.$transaction([op1, op2]) to avoid interactive tx overhead"
  - "Steps findFirst uses isDeleted: false filter to avoid counting deleted survivor steps in offset calc"
metrics:
  duration: "5m"
  completed_date: "2026-03-23"
  tasks_completed: 1
  files_created: 2
  files_modified: 0
  tests_added: 28
  tests_passing: 28
requirements_covered: [RES-02, RES-03, RES-04, RES-05, RES-06, RES-07]
---

# Phase 49 Plan 01: Merge/Link/Dismiss Resolution Service Summary

**One-liner:** Atomic merge transaction rerouting 13 FK relations with TestRunCases conflict pre-deletion and RepositoryCaseVersions renumbering, plus link and dismiss actions.

## What Was Built

`testplanit/lib/services/mergeService.ts` exports three functions:

- **mergeCases(survivorId, victimId, userId):** Executes a single `prisma.$transaction()` that reroutes all 13 FK relationships from victim to survivor in the order prescribed by 49-RESEARCH.md, then soft-deletes the victim. Returns `{ survivorId, summary }`.

- **linkCases(caseAId, caseBId, userId, projectId):** Creates a `RepositoryCaseLink(SAME_TEST_DIFFERENT_SOURCE)` and updates `DuplicateScanResult` status to `LINKED` atomically. Returns `{ linked: true }`.

- **dismissPair(caseAId, caseBId, projectId):** Sets `DuplicateScanResult` status to `DISMISSED`. Returns `{ dismissed: true }`.

## Transaction Order (mergeCases)

1. Find survivor's test run IDs (conflict detection)
2. Delete conflicting victim `TestRunCases` rows (RES-03)
3. Reroute non-conflicting `TestRunCases` → survivorId
4. Reroute `Steps` with order offset (`maxSurvivorOrder + 1`)
5. `updateMany` for `CaseFieldValues`, `ResultFieldValues`, `Attachments`
6. Renumber victim `RepositoryCaseVersions` (offset = survivor.currentVersion) and re-parent (RES-04)
7. Update `survivor.currentVersion` to `offset + max(victimVersions)`
8. `updateMany` for `JUnitTestResult`, `JUnitProperty`, `JUnitAttachment`, `JUnitTestStep`
9. `updateMany` for `Comment`
10. Connect victim Tags and Issues to survivor (idempotent M2M)
11. Reroute victim `RepositoryCaseLink` rows via `createMany skipDuplicates`
12. Create audit `RepositoryCaseLink(SAME_TEST_DIFFERENT_SOURCE)`
13. Update resolved pair `DuplicateScanResult` → MERGED
14. Update all other PENDING scan results referencing victim → MERGED
15. Soft-delete victim (`isDeleted: true`)

Post-transaction: ES sync for both survivor (updated) and victim (soft-deleted), best-effort.

## Test Coverage (28 tests)

| Group | Tests | Requirement |
|-------|-------|-------------|
| Happy path merge | 6 | RES-02, RES-05 |
| TestRunCases conflict | 3 | RES-03 |
| Version renumbering | 4 | RES-04 |
| Steps order offset | 3 | RES-02 |
| M2M connect tags/issues | 3 | RES-02 |
| Victim link rerouting | 2 | RES-02 |
| Transaction atomicity | 1 | RES-05 |
| linkCases | 3 | RES-06 |
| dismissPair | 2 | RES-07 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.mock hoisting issue with mock object declarations**
- **Found during:** GREEN phase (first test run)
- **Issue:** `vi.mock()` factories are hoisted to top of file by Vitest, so they execute before `const mockTx = ...` variable declarations, causing "Cannot access 'mockPrisma' before initialization"
- **Fix:** Wrapped mock object creation in `vi.hoisted(() => { ... })` which runs before hoisted `vi.mock()` factories
- **Files modified:** `testplanit/lib/services/mergeService.test.ts`
- **Commit:** included in 91474527 (GREEN commit)

## Self-Check: PASSED
