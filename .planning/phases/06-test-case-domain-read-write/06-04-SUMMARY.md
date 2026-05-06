---
phase: 06-test-case-domain-read-write
plan: 04
subsystem: mcp-server/tools/folders
tags: [mcp-server, tools, folders, zenstack, tdd, vitest, typescript, soft-delete, breadcrumb]

# Dependency graph
requires:
  - phase: 06-test-case-domain-read-write
    plan: 01
    provides: "zenstack<T>, resolveActiveRepository"
  - phase: 06-test-case-domain-read-write
    plan: 02
    provides: "buildFolderBreadcrumb from cases/shared.ts — reused by fetchFolderDetail"

provides:
  - "testplanit_folders_list — tree-shaped root folders with 2-level children + case counts (CASE-06)"
  - "testplanit_folders_get — full detail with breadcrumb, children, cases summary (CASE-07)"
  - "testplanit_folders_create — create at root or under parent, auto-resolves repository (CASE-08)"
  - "testplanit_folders_update — rename and/or reparent, parentId:null → disconnect (CASE-09)"
  - "testplanit_folders_delete — soft-delete only, surfaces non-empty rejection as 422 (CASE-10)"
  - "mapFolderTreeNode(raw) — pure recursive tree node mapper with _count→caseCount"
  - "fetchFolderDetail(folderId, env) — reusable CASE-07 shape re-fetch, used by create+update"
  - "registerFolders(server, deps) — central registry for all 5 folder tools"

affects:
  - "06-06 (E2E: folder CRUD via API contract, scopes.spec.ts READ_ONLY_TOKEN tests)"
  - "06-05 (tags tools: same tools/index.ts wiring point)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Folder tree query: findMany with parentId:null + 2-level children inline, _count filtered by isDeleted:false"
    - "fetchFolderDetail: reuses buildFolderBreadcrumb from cases/shared.ts (T-06-03 mitigation)"
    - "Reparent semantics: parentId number → connect, parentId null → disconnect:true"
    - "Folder create: relation-connect syntax for project+repository+parent; creatorId never passed"
    - "T-06-06 invariant: folders/delete.ts only calls update(isDeleted:true), never delete/deleteMany"

key-files:
  created:
    - "packages/mcp-server/src/tools/folders/shared.ts"
    - "packages/mcp-server/src/tools/folders/shared.test.ts"
    - "packages/mcp-server/src/tools/folders/list.ts"
    - "packages/mcp-server/src/tools/folders/list.test.ts"
    - "packages/mcp-server/src/tools/folders/get.ts"
    - "packages/mcp-server/src/tools/folders/get.test.ts"
    - "packages/mcp-server/src/tools/folders/create.ts"
    - "packages/mcp-server/src/tools/folders/create.test.ts"
    - "packages/mcp-server/src/tools/folders/update.ts"
    - "packages/mcp-server/src/tools/folders/update.test.ts"
    - "packages/mcp-server/src/tools/folders/delete.ts"
    - "packages/mcp-server/src/tools/folders/delete.test.ts"
    - "packages/mcp-server/src/tools/folders/index.ts"
  modified:
    - "packages/mcp-server/src/tools/index.ts"
    - "packages/mcp-server/src/index.ts"

key-decisions:
  - "fetchFolderDetail is a shared helper in folders/shared.ts (not inlined in each tool) so create+update return the identical CASE-07 shape as get"
  - "buildFolderBreadcrumb is imported from cases/shared.ts — not duplicated (T-06-03 mitigation)"
  - "update.ts skips the zenstack call entirely when no fields are provided (empty data guard)"
  - "Folder delete never passes 'delete' or 'deleteMany' to zenstack — T-06-06 invariant proven by grep and unit test"
  - "creatorId is never passed in create body — host route.ts auto-injects it"

requirements-completed: [CASE-06, CASE-07, CASE-08, CASE-09, CASE-10]

# Metrics
duration: ~6min
completed: 2026-05-06
---

# Phase 06 Plan 04: Folder Domain Tools Summary

**Five folder tools (`testplanit_folders_list`, `testplanit_folders_get`, `testplanit_folders_create`, `testplanit_folders_update`, `testplanit_folders_delete`) with tree shape, breadcrumb reuse, relation-connect syntax, and soft-delete-only invariant — all proven by 31 unit tests**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-05-06
- **Tasks:** 3 (TDD RED+GREEN for tasks 1+2, direct implementation for task 3)
- **Files created:** 13
- **Files modified:** 2

## Tool Catalog

### `testplanit_folders_list` (CASE-06)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | `number` (int, positive) | yes | Project to list folders for |

**Returns:** `{ tree: FolderTreeNode[] }` where each node has `{ id, name, parentId, caseCount, children[] }`. Root folders only; 2 levels of children inline; deeper subtrees via `testplanit_folders_get`.

### `testplanit_folders_get` (CASE-07)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folderId` | `number` (int, positive) | yes | Folder to fetch |

**Returns:** `{ id, name, parentId, breadcrumb, fullPath, children, cases, caseCount }` where `cases` is capped at 100 rows and `breadcrumb` walks to root via `buildFolderBreadcrumb`.

### `testplanit_folders_create` (CASE-08)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | `number` (int, positive) | yes | Project to create the folder in |
| `name` | `string` (1–255 chars) | yes | Folder name |
| `parentId` | `number` (int, positive) | no | Parent folder; omit for root |

**Returns:** CASE-07 shape via `fetchFolderDetail`. Active repository auto-resolved.

### `testplanit_folders_update` (CASE-09)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folderId` | `number` (int, positive) | yes | Folder to update |
| `name` | `string` (1–255 chars) | no | New name |
| `parentId` | `number \| null` | no | New parent (`null` = move to root) |

**Returns:** CASE-07 shape. Skips the `zenstack update` call if no fields are provided.

### `testplanit_folders_delete` (CASE-10)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folderId` | `number` (int, positive) | yes | Folder to soft-delete |

**Returns:** `{ id, isDeleted: true }`. Non-empty folder rejection from host (HTTP 422) surfaces as `isError: true` tool error with the host's human-readable message.

## Folder Tree Depth Strategy

The `testplanit_folders_list` query fetches root folders with 2 levels of children inline. The tree shape is:

```
Root
├── Child (level 1) — _count.cases, children array
│   └── Grandchild (level 2) — _count.cases, no further children
```

For deeper subtrees, the agent calls `testplanit_folders_get` on the folder of interest, which returns its direct children (1 level) along with a cases summary. Arbitrary depth traversal uses repeated `testplanit_folders_get` calls.

## Reparent Semantics

`testplanit_folders_update` maps `parentId` to ZenStack relation operations:

| `parentId` value | ZenStack `data.parent` shape |
|-----------------|------------------------------|
| `number` | `{ connect: { id: parentId } }` |
| `null` | `{ disconnect: true }` |
| `undefined` (not provided) | `parent` key absent from update body |

## `creatorId` Not Passed in Create Body

The `testplanit_folders_create` handler does not include `creatorId` in the create body. The host `route.ts` auto-injects `creator: { connect: { id: userId } }` for `repositoryFolders` creates. A unit test asserts `data` does not have `creatorId` property.

## T-06-06 Invariant — grep proof

```bash
grep -rcE '"delete"|"deleteMany"' \
  packages/mcp-server/src/tools/folders/shared.ts \
  packages/mcp-server/src/tools/folders/list.ts \
  packages/mcp-server/src/tools/folders/get.ts \
  packages/mcp-server/src/tools/folders/create.ts \
  packages/mcp-server/src/tools/folders/update.ts \
  packages/mcp-server/src/tools/folders/delete.ts \
  packages/mcp-server/src/tools/folders/index.ts
# → 0 hits across all implementation files
```

## Test Counts per File

| File | Tests | Key Assertions |
|------|-------|----------------|
| `shared.test.ts` | 3 | flat node, 2-level recursion, missing _count → 0 |
| `list.test.ts` | 6 | tree shape, where filters, _count include, empty, error, registration |
| `get.test.ts` | 5 | breadcrumb, root folder, take:100, not found, registration |
| `create.test.ts` | 5 | create body (no parent), parentId present, no repo 422, READ_ONLY_TOKEN, registration |
| `update.test.ts` | 7 | rename only, reparent, reparent-to-root, both fields, no fields (no write), READ_ONLY_TOKEN, registration |
| `delete.test.ts` | 5 | soft-delete, no delete/deleteMany, 422 non-empty, READ_ONLY_TOKEN, registration |
| **Total (plan 06-04)** | **31** | |
| **Total (full suite)** | **199** | All 21 test files |

## Task Commits

| Task | Phase | Commit | Files |
|------|-------|--------|-------|
| Task 1 | RED | `30c654d3` | shared.test.ts, list.test.ts, get.test.ts (14 failing tests) |
| Task 1 | GREEN | `6553cf6e` | shared.ts, list.ts, get.ts (14 tests passing) |
| Task 2 | RED | `b5716478` | create.test.ts, update.test.ts, delete.test.ts (17 failing tests) |
| Task 2 | GREEN | `fe35a75f` | create.ts, update.ts, delete.ts (17 tests passing) |
| Task 3 | — | `39c76337` | folders/index.ts, tools/index.ts, src/index.ts (199 total passing, typecheck+build clean) |

## Deviations from Plan

None — plan executed exactly as written. The `mapFolderTreeNode` function and `fetchFolderDetail` helper were placed in `folders/shared.ts` exactly as specified. `buildFolderBreadcrumb` is imported from `cases/shared.ts` (not duplicated) per T-06-03 mitigation.

## Known Stubs

None. All five tools make real ZenStack RPC calls against existing endpoints. `fetchFolderDetail` re-fetches the full CASE-07 shape after every write; no placeholder data.

## Threat Mitigations Applied

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-06-01 | Verified: host ZenStack `@@allow('read', ...)` filters per row; READ_ONLY_TOKEN unit tests in all 3 write tools assert `mode:read` in error text |
| T-06-03 | Mitigated: `buildFolderBreadcrumb` from `cases/shared.ts` is imported (never duplicated); every parent fetch goes through the bearer-authed RPC |
| T-06-05 | Mitigated: `mapHttpErrorToToolResult` fallback emits `Request failed: <message> (HTTP 422)`; unit test asserts token prefix `tpi_` is absent from the non-empty error text |
| T-06-06 | Mitigated: 0 grep hits for "delete"/"deleteMany" across all 7 implementation files; unit test explicitly asserts negative path |

## Self-Check

### File existence
- `packages/mcp-server/src/tools/folders/shared.ts` — FOUND
- `packages/mcp-server/src/tools/folders/shared.test.ts` — FOUND
- `packages/mcp-server/src/tools/folders/list.ts` — FOUND
- `packages/mcp-server/src/tools/folders/list.test.ts` — FOUND
- `packages/mcp-server/src/tools/folders/get.ts` — FOUND
- `packages/mcp-server/src/tools/folders/get.test.ts` — FOUND
- `packages/mcp-server/src/tools/folders/create.ts` — FOUND
- `packages/mcp-server/src/tools/folders/create.test.ts` — FOUND
- `packages/mcp-server/src/tools/folders/update.ts` — FOUND
- `packages/mcp-server/src/tools/folders/update.test.ts` — FOUND
- `packages/mcp-server/src/tools/folders/delete.ts` — FOUND
- `packages/mcp-server/src/tools/folders/delete.test.ts` — FOUND
- `packages/mcp-server/src/tools/folders/index.ts` — FOUND

### Commit existence
- `30c654d3` (RED: shared+list+get tests) — FOUND
- `6553cf6e` (GREEN: shared+list+get impl) — FOUND
- `b5716478` (RED: create+update+delete tests) — FOUND
- `fe35a75f` (GREEN: create+update+delete impl) — FOUND
- `39c76337` (wiring: folders/index.ts, tools/index.ts, src/index.ts) — FOUND

## Self-Check: PASSED

---
*Phase: 06-test-case-domain-read-write*
*Completed: 2026-05-06*
