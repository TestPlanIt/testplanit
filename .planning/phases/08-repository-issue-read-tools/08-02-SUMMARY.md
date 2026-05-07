---
phase: 08-repository-issue-read-tools
plan: 02
subsystem: mcp-server
tags: [mcp, issues, read-tools, dual-mode-xor, multi-array-truncation]
requires:
  - "Phase 6: cases/shared.ts extractProseMirrorText"
  - "Phase 6: api.ts zenstack RPC client + errors.ts mapHttpErrorToToolResult"
provides:
  - "testplanit_issues_find_by_key (ISSUE-01)"
  - "testplanit_issues_list (ISSUE-02)"
  - "testplanit_issues_get (ISSUE-03)"
  - "testplanit_issues_list_links (ISSUE-04, 7-way XOR)"
  - "ISSUE_ROW_INCLUDE / ISSUE_DETAIL_INCLUDE / mapIssueRow / mapIssueDetail (issues/shared.ts)"
  - "registerIssues + IssuesDeps barrel (registry wiring deferred to plan 08-05)"
affects:
  - packages/mcp-server/src/tools/issues/* (new directory)
tech-stack:
  added: []
  patterns:
    - "Phase 7 D7-12 inline-with-truncation widened to multi-array per D8-06"
    - "Phase 7 D7-11 dual-mode XOR widened from 2-way (sessions/findings) to 7-way"
    - "Phase 6 'as const satisfies Prisma.<Model><Include|Select>' typed-include guard"
key-files:
  created:
    - "packages/mcp-server/src/tools/issues/shared.ts (178 lines) — typed includes + Issue mappers"
    - "packages/mcp-server/src/tools/issues/find-by-key.ts (95 lines) — ISSUE-01 with multi-match fallback"
    - "packages/mcp-server/src/tools/issues/list.ts (90 lines) — ISSUE-02 project-scoped paginated list"
    - "packages/mcp-server/src/tools/issues/get.ts (94 lines) — ISSUE-03 with multi-array truncation"
    - "packages/mcp-server/src/tools/issues/links.ts (260 lines) — ISSUE-04 7-way XOR dual-mode"
    - "packages/mcp-server/src/tools/issues/index.ts (43 lines) — registerIssues barrel"
    - "packages/mcp-server/src/tools/issues/find-by-key.test.ts (264 lines, 8 tests)"
    - "packages/mcp-server/src/tools/issues/list.test.ts (225 lines, 8 tests)"
    - "packages/mcp-server/src/tools/issues/get.test.ts (396 lines, 13 tests)"
    - "packages/mcp-server/src/tools/issues/links.test.ts (438 lines, 16 tests)"
  modified: []
decisions:
  - "Rule 1 deviation: testRunStepResults hasIsDeleted=true (schema reality) — plan asserted column was absent"
metrics:
  duration: "12m 12s"
  completed: "2026-05-07"
  tasks_completed: 4
  commits: 7
  tests_added: 45
---

# Phase 8 Plan 02: Issues Domain Read Tools Summary

Issue read surface for the MCP server — four composable tools (find-by-key,
list, get, list_links) with multi-match fallback, multi-array truncation, and
7-way XOR dual-mode graph traversal. Registry wiring deferred to plan 08-05.

## Tools Shipped

| Tool                              | Requirement | File                                                                  | Registration line |
| --------------------------------- | ----------- | --------------------------------------------------------------------- | ----------------- |
| `testplanit_issues_find_by_key`   | ISSUE-01    | `packages/mcp-server/src/tools/issues/find-by-key.ts`                 | `registerTool` at line 28 |
| `testplanit_issues_list`          | ISSUE-02    | `packages/mcp-server/src/tools/issues/list.ts`                        | `registerTool` at line 24 |
| `testplanit_issues_get`           | ISSUE-03    | `packages/mcp-server/src/tools/issues/get.ts`                         | `registerTool` at line 21 |
| `testplanit_issues_list_links`    | ISSUE-04    | `packages/mcp-server/src/tools/issues/links.ts`                       | `registerTool` at line 156 |

All four are exported via `packages/mcp-server/src/tools/issues/index.ts`
through `registerIssues(server, deps)`. Wiring into the central
`registerAll` registry (plan 08-05) is **not** in this plan's scope.

## Tasks Completed

| Task | Name                                                      | Commit     |
| ---- | --------------------------------------------------------- | ---------- |
| 1    | issues/shared.ts — typed includes + Issue mappers         | `877d6cc6` |
| 2    | find-by-key.ts + list.ts (TDD RED → GREEN)                | `e9722cdf` (RED), `f41077cb` (GREEN) |
| 3    | get.ts with multi-array truncation (TDD RED → GREEN)      | `d18800e1` (RED), `0ed77838` (GREEN) |
| 4    | links.ts 7-way XOR + index.ts barrel (TDD RED → GREEN)    | `1a045f3b` (RED), `48285f7d` (GREEN) |

7 commits total: 1 task-1 commit + 6 RED/GREEN pairs across tasks 2–4.

## Test Counts

| File                       | Tests passed |
| -------------------------- | ------------ |
| `find-by-key.test.ts`      | 8 / 8        |
| `list.test.ts`             | 8 / 8        |
| `get.test.ts`              | 13 / 13      |
| `links.test.ts`            | 16 / 16      |
| **issues/ subtotal**       | **45 / 45**  |
| Full mcp-server suite      | **481 / 481** (zero regressions) |

`pnpm --filter @testplanit/mcp-server typecheck` exit 0 at every commit.

## Threat-Model Mitigations Exercised

| Threat ID            | Mitigation                                                                                                                  | Verified by                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T-08-IDOR            | `z.number().int().positive()` on every numeric ID input across all 4 tools                                                  | Zod input schemas + DoS-cap test in `list.test.ts` (limit > 100 rejects)             |
| T-08-DoS             | `MAX_LIMIT = 100` clamp on list + list_links; `MULTI_MATCH_TAKE = 5` hard cap on find_by_key; sub-include `take: 101` on get | `list.test.ts` "limit > 100 rejected"; `find-by-key.ts` const; `shared.ts` constant  |
| T-08-TOKEN-REDACT    | Every catch routes through `mapHttpErrorToToolResult`; tpi_*** scrub                                                        | Token-redaction test in each of 4 test files (`expect(text).not.toContain("tpi_")`)  |
| T-08-SOFT-DELETE     | Read-only phase; per-test grep guard verifies zero `delete`/`deleteMany` operation strings                                  | `find-by-key.test.ts`, `list.test.ts`, `get.test.ts`, `links.test.ts` — 4 grep tests |
| T-08-PITFALL-7       | `integration: { select: { provider: true } }` only — `externalSystem` derived in mapper; literal `externalSystem: true` absent from `shared.ts` | grep `externalSystem: true` returns 0 in `issues/*.ts`                               |
| T-08-NONDET-TRUNC    | Each of 3 sub-includes carries explicit `orderBy: [{ createdAt: "desc" }, { id: "desc" }]`                                  | `get.test.ts` "Sub-includes carry deterministic orderBy" — asserts all 3             |
| T-08-XOR-CONFUSION   | Symmetric handler-side validation rejects `{}`, `{both modes}`, `{multiple inbound}`, `{issueId without target}`, `{inbound with target}` | 5 distinct rejection tests in `links.test.ts` (1–5)                                  |
| T-08-R2-STEPSTATUS   | Outbound `testRunStepResults` select uses `stepStatus` relation (not `status`); reintroducing `status: true` would TS2353   | `links.test.ts` "outbound target=testRunStepResults" — asserts select.stepStatus and select.status undefined |

## Deviations from Plan

### Rule 1 (Bug Fix) — TestRunStepResults isDeleted column

**Found during:** Task 4 (links.ts implementation)

**Issue:** The plan stated three times that `TestRunStepResults` does NOT
carry an `isDeleted` column:
- Behavior section line: "TestRunStepResults does NOT carry `isDeleted` —
  confirmed Phase 7"
- Test 13 specification: "asserts where omits `isDeleted: false` inside `some`"
- Plan-checker comment: "the model doesn't carry it"

This is factually wrong. Verified via two sources:
1. `testplanit/schema.zmodel:2443` declares `isDeleted Boolean @default(false)`
   on `TestRunStepResults`.
2. Phase 7's existing `runs/shared.ts:151` already filters
   `stepResults: { where: { isDeleted: false } }` — the prior phase's invariant.

**Fix applied:** In `links.ts`, both descriptor entries for
`testRunStepResults` set `hasIsDeleted: true` (matching the other 5 outbound
targets and the other 5 inbound relations). The where clause now consistently
includes `isDeleted: false` on the outer where for outbound `target='testRunStepResults'`
and on the inner `some` for inbound `runStepResultId`.

**Tests adjusted:** Test 11 (`outbound target=testRunStepResults`) and Test 13
(`inbound runStepResultId`) assert that `isDeleted: false` IS present, not
absent. Test comments document the deviation rationale.

**Files modified:** `packages/mcp-server/src/tools/issues/links.ts`,
`packages/mcp-server/src/tools/issues/links.test.ts`

**Commit:** `48285f7d` (links.ts GREEN) and `1a045f3b` (RED tests with the
corrected expectations)

**Why this is correct:** The plan's stated invariant would have produced
inconsistent soft-delete filtering — soft-deleted step-results would leak
into outbound query results for `target='testRunStepResults'` while every
other linked target filtered them out. The fix maintains uniform soft-delete
semantics across all 6 targets and is byte-aligned with Phase 7 production
behavior. The plan's test 13 assertion was inverted from the safer (and
schema-honest) expectation.

### Cosmetic — Pitfall 7 comment edit

**Found during:** Task 1 acceptance grep (Pitfall 7 invariant `grep -c
"externalSystem: true"` must equal 0)

**Issue:** Initial draft of `shared.ts` had a comment line containing the
literal string `externalSystem: true` as a documented anti-pattern. The
acceptance criterion is a flat case-sensitive grep — the comment counted.

**Fix applied:** Rewrote the comment from "Reintroducing `externalSystem: true`
in the select" to "Reintroducing the externalSystem column in the select" —
preserves the warning, removes the literal token.

**Files modified:** `packages/mcp-server/src/tools/issues/shared.ts` (Task 1
commit `877d6cc6` already includes the fix; the edit happened pre-commit).

**Why this matters:** A future grep-based regression check (CI lint, pre-commit
hook, or a verifier sweep) treats the comment-token the same as a real one.
Eliminating the false positive keeps the invariant cheap to enforce.

## Authentication Gates

None encountered. All work is read-only Zenstack RPC; no auth flows touched.

## Verification Results

### Manual greps

- `grep -nE 'externalSystem: true|status: true.*stepStatus' issues/*.ts` → 0 matches (Pitfall 7 + R2 invariants hold)
- `grep -c 'as const satisfies Prisma' issues/shared.ts` → 3 matches (target ≥ 1; ROW + DETAIL + comment echo)
- `grep -c 'server.registerTool(' issues/*.ts` → 4 matches (one per tool)

### Automated checks

- `pnpm --filter @testplanit/mcp-server typecheck` exit 0
- `pnpm --filter @testplanit/mcp-server test --run src/tools/issues/` 45/45
- `pnpm --filter @testplanit/mcp-server test --run` 481/481 (full package, zero regressions)

## Self-Check: PASSED

### Files exist

- FOUND: `packages/mcp-server/src/tools/issues/shared.ts`
- FOUND: `packages/mcp-server/src/tools/issues/find-by-key.ts`
- FOUND: `packages/mcp-server/src/tools/issues/list.ts`
- FOUND: `packages/mcp-server/src/tools/issues/get.ts`
- FOUND: `packages/mcp-server/src/tools/issues/links.ts`
- FOUND: `packages/mcp-server/src/tools/issues/index.ts`
- FOUND: `packages/mcp-server/src/tools/issues/find-by-key.test.ts`
- FOUND: `packages/mcp-server/src/tools/issues/list.test.ts`
- FOUND: `packages/mcp-server/src/tools/issues/get.test.ts`
- FOUND: `packages/mcp-server/src/tools/issues/links.test.ts`

### Commits exist (verified via `git log --oneline e7c964e3..HEAD`)

- FOUND: `877d6cc6` feat(08-02): issues/shared.ts — typed includes + Issue mappers
- FOUND: `e9722cdf` test(08-02): RED — find-by-key + list test specs
- FOUND: `f41077cb` feat(08-02): GREEN — issues_find_by_key + issues_list
- FOUND: `d18800e1` test(08-02): RED — issues_get test specs
- FOUND: `0ed77838` feat(08-02): GREEN — issues_get with multi-array truncation (D8-06)
- FOUND: `1a045f3b` test(08-02): RED — issues_list_links 7-way XOR test specs
- FOUND: `48285f7d` feat(08-02): GREEN — issues_list_links 7-way XOR + index barrel

## Registry Wiring (deferred)

`registerIssues` exported from `packages/mcp-server/src/tools/issues/index.ts`
is **not** wired into `packages/mcp-server/src/tools/index.ts`'s `registerAll`
in this plan. Per plan 08-02 Task 4 acceptance criterion + the plan output
section, central registry composition is plan 08-05's responsibility. The four
tools are fully ready for that wiring — no API drift between this plan's
exports and the patterns used by Phases 6 + 7's existing barrels.
