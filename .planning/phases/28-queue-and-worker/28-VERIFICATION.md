---
phase: 28-queue-and-worker
verified: 2026-03-20T12:30:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 28: Queue and Worker Verification Report

**Phase Goal:** The copy/move BullMQ worker processes jobs end-to-end, carrying over all case data and handling version history correctly, before any API or UI is built on top
**Verified:** 2026-03-20T12:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A copied case in the target project contains all original steps, custom field values, tags, issue links, and attachment records (pointing to the same S3 URLs) | VERIFIED | Worker creates steps (line 386), caseFieldValues (line 406), tags via connect (line 432-438), issues via connect (line 441-447), attachments with `url: attachment.url` (line 421). Unit tests DATA-01 through DATA-05 all pass (5038 tests pass total). |
| 2 | A copied case starts at version 1 in the target project with no prior version history | VERIFIED | Worker calls `createTestCaseVersionInTransaction(tx, newCase.id, { version: 1, creatorId: job.data.userId })` on copy path (line 458-461). Test DATA-07 verifies this. |
| 3 | A moved case in the target project retains its full version history from the source project | VERIFIED | Worker fetches source versions separately then recreates each `repositoryCaseVersions` row with `repositoryCaseId: newCase.id` and `projectId: job.data.targetProjectId` but preserves `staticProjectId`, `staticProjectName`, and all snapshot fields (lines 466-502). Tests DATA-06 verify projectId update and staticProjectId preservation. |
| 4 | Shared step groups are recreated as proper SharedStepGroups in the target project with all items copied | VERIFIED | `resolveSharedStepGroup` helper creates `sharedStepGroup` rows with `items: { create: sourceGroup.items.map(...) }` in target projectId (lines 84-98). Deduplication via `sharedGroupMap` ensures multiple source cases sharing a group produce exactly one target group. Tests DATA-08 verify both creation and deduplication. |
| 5 | When a shared step group name already exists in the target, the worker correctly applies the user-chosen resolution (reuse existing or create new) | VERIFIED | `resolveSharedStepGroup` checks `sharedStepGroupResolution`: "reuse" returns existing group id without creating; "create_new" creates with `${sourceGroup.name} (copy)` suffix (lines 74-98). Tests DATA-09 verify both paths. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `testplanit/lib/queueNames.ts` | COPY_MOVE_QUEUE_NAME constant | VERIFIED | Line 12: `export const COPY_MOVE_QUEUE_NAME = "copy-move";` |
| `testplanit/lib/queues.ts` | getCopyMoveQueue lazy initializer | VERIFIED | Lines 428-449: full lazy initializer with `attempts: 1`, proper error handler. Re-exported at line 21. `copyMoveQueue: getCopyMoveQueue()` in `getAllQueues()` at line 467. |
| `testplanit/workers/copyMoveWorker.ts` | BullMQ processor for copy/move jobs | VERIFIED | 661 lines (>200 minimum). Exports `processor`, `startWorker`, `CopyMoveJobData`, `CopyMoveJobResult`. All copy/move logic implemented. |
| `testplanit/package.json` | Worker script registration | VERIFIED | Line 36: `"worker:copy-move": "dotenv -- tsx workers/copyMoveWorker.ts"`. Line 41: `"pnpm worker:copy-move"` appended to `workers` concurrently command. |
| `testplanit/workers/copyMoveWorker.test.ts` | Unit tests for copy-move worker | VERIFIED | 1,123 lines (>300 minimum). All 9 DATA requirements covered. 5038 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `copyMoveWorker.ts` | `lib/queueNames.ts` | `import COPY_MOVE_QUEUE_NAME` | WIRED | Line 10: `import { COPY_MOVE_QUEUE_NAME } from "../lib/queueNames";` — used at lines 597, 601, 617, 619. |
| `copyMoveWorker.ts` | `lib/multiTenantPrisma.ts` | `getPrismaClientForJob(job.data)` | WIRED | Lines 3-9: full import. Line 250: `validateMultiTenantJobData(job.data)`. Line 253: `getPrismaClientForJob(job.data)`. |
| `copyMoveWorker.ts` | `lib/services/testCaseVersionService.ts` | `createTestCaseVersionInTransaction` | WIRED | Line 12: import. Line 458: called inside transaction with `(tx, newCase.id, { version: 1, ... })`. |
| `copyMoveWorker.test.ts` | `copyMoveWorker.ts` | `import { processor, startWorker }` | WIRED | Lines 84-90: `vi.mock("../lib/services/testCaseVersionService", ...)`. Dynamic import in `loadWorker()` calls `mod.startWorker()` and uses `mod.processor`. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DATA-01 | 28-01-PLAN.md, 28-02-PLAN.md | Steps carried over to target | SATISFIED | Worker lines 373-395; test "DATA-01: should create steps in target case" passes |
| DATA-02 | 28-01-PLAN.md, 28-02-PLAN.md | Custom field values with option ID resolution | SATISFIED | Worker lines 397-414; `resolveFieldValue` handles Dropdown/MultiSelect; tests DATA-02 pass |
| DATA-03 | 28-01-PLAN.md, 28-02-PLAN.md | Tags connected by global ID | SATISFIED | Worker lines 431-439; test "DATA-03: should connect tags by ID" passes |
| DATA-04 | 28-01-PLAN.md, 28-02-PLAN.md | Issues connected by global ID | SATISFIED | Worker lines 441-449; test "DATA-04: should connect issues by ID" passes |
| DATA-05 | 28-01-PLAN.md, 28-02-PLAN.md | Attachments by URL reference (no re-upload) | SATISFIED | Worker lines 416-429; `url: attachment.url` preserved; test "DATA-05" passes |
| DATA-06 | 28-01-PLAN.md, 28-02-PLAN.md | Move preserves full version history | SATISFIED | Worker lines 463-506; versions recreated with updated FKs and preserved static fields; tests DATA-06 pass |
| DATA-07 | 28-01-PLAN.md, 28-02-PLAN.md | Copy starts at version 1 with fresh history | SATISFIED | Worker lines 452-461; `createTestCaseVersionInTransaction` called with version 1; test DATA-07 passes |
| DATA-08 | 28-01-PLAN.md, 28-02-PLAN.md | Shared step groups recreated in target project | SATISFIED | `resolveSharedStepGroup` helper with deduplication; tests DATA-08 pass including deduplication case |
| DATA-09 | 28-01-PLAN.md, 28-02-PLAN.md | User-chosen resolution for name collisions | SATISFIED | "reuse" and "create_new" paths in `resolveSharedStepGroup`; tests DATA-09 (reuse and create_new) pass |

**Orphaned requirements check:** No requirements assigned to Phase 28 in REQUIREMENTS.md traceability table beyond DATA-01 through DATA-09. All 9 accounted for.

### Anti-Patterns Found

No blockers or stubs detected.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `copyMoveWorker.ts` | 571-573 | `droppedLinkCount = 0` — cross-project link counting not implemented, always reports 0 | Info | Intentional per plan: links are dropped silently, count reported as 0. Not a behavioral defect. |

### Human Verification Required

None. All success criteria are verifiable programmatically through unit tests, code inspection, and schema cross-referencing.

### Locked Behavioral Constraints (Verified)

| Constraint | Status | Evidence |
|------------|--------|---------|
| `attempts: 1` on queue (no retry — partial retries create duplicates) | VERIFIED | `queues.ts` line 439 |
| `concurrency: 1` on worker (prevent ZenStack v3 deadlocks) | VERIFIED | `copyMoveWorker.ts` line 601 |
| Rollback via `deleteMany(createdTargetIds)` on any failure | VERIFIED | Lines 531-540; rollback test passes |
| Move soft-deletes source ONLY after all copies succeed | VERIFIED | Lines 543-551 (after try/catch); test "should soft-delete source cases only after all copies succeed" passes |
| Cancellation checked between cases (not just pre-start) | VERIFIED | Lines 344-349; cancellation tests pass |
| Comments carried over on move only (not copy) | VERIFIED | Lines 291-303 (`operation === "move"` conditional for comments fetch); test "should NOT copy comments on copy operation" passes |
| ES sync is fire-and-forget after loop (not inside transaction) | VERIFIED | Lines 556-568; test "should not fail job if ES sync fails" passes |

### Commits Verified

All three commits from SUMMARY.md confirmed present in git log:
- `42ccfd45` — feat(28-01): register copy-move BullMQ queue infrastructure
- `de8b993b` — feat(28-01): implement copyMoveWorker processor for cross-project copy/move
- `52f8f715` — test(28-02): add comprehensive unit tests for copy-move worker processor

### Test Run

**Command:** `cd testplanit && pnpm test -- --run workers/copyMoveWorker.test.ts`
**Result:** 5038 tests passed across 299 test files (full suite run). No failures.

---

_Verified: 2026-03-20T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
