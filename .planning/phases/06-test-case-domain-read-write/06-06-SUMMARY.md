---
phase: 06-test-case-domain-read-write
plan: 06
subsystem: mcp-server/e2e+docs+release
tags: [mcp-server, e2e, playwright, changeset, readme, read-only-token, soft-delete, phase-6]

# Dependency graph
requires:
  - phase: 06-test-case-domain-read-write
    plan: 01
    provides: "zenstack<T> RPC client — the same REST contracts proven by E2E specs"
  - phase: 06-test-case-domain-read-write
    plan: 02
    provides: "testplanit_cases_list + testplanit_cases_get (CASE-01..02)"
  - phase: 06-test-case-domain-read-write
    plan: 03
    provides: "testplanit_cases_create/update/delete (CASE-03..05)"
  - phase: 06-test-case-domain-read-write
    plan: 04
    provides: "testplanit_folders_list/get/create/update/delete (CASE-06..10)"
  - phase: 06-test-case-domain-read-write
    plan: 05
    provides: "testplanit_tags_list + testplanit_projects_list (CASE-11)"
  - phase: 05-mcp-server-foundation-read-only-token-flag
    provides: "WRITE_HTTP_METHODS host gate (T-05-01a) inherited by Phase 6 write tools"

provides:
  - "E2E coverage for case CRUD lifecycle: create→list→get→update→soft-delete→verify-hidden (CASE-01..05)"
  - "E2E coverage for folder CRUD: create-root, create-child, tree-query, rename, reparent, soft-delete (CASE-06,08,09,10)"
  - "CASE-12 host behavior documentation: missing-template → 400/422; non-empty folder delete is MCP-layer concern not REST-layer"
  - "T-06-01 regression coverage: repositoryCases/create + repositoryCases/update + repositoryFolders/create all return 403+READ_ONLY_TOKEN for mode:read tokens"
  - "README Tool Catalog: all 12 Phase 6 tools with input/output schemas and soft-delete invariant documented"
  - "Changesets minor entry for @testplanit/mcp-server Phase 6 publication"

affects:
  - "Phase 7+ — scopes.spec.ts establishes READ_ONLY_TOKEN regression baseline for future write tools"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "E2E seed-context pattern: beforeAll mints a full-access token, resolves project/repo/folder/template/state via findFirst"
    - "Serial E2E mode: tests depend on shared state (createdCaseId, rootFolderId) — order matters"
    - "T-06-06 proven by grep: zero DELETE method calls in E2E specs; all deletes via PATCH update isDeleted:true"

key-files:
  created:
    - "testplanit/e2e/tests/mcp/cases.spec.ts"
    - "testplanit/e2e/tests/mcp/folders.spec.ts"
    - "testplanit/e2e/tests/mcp/validation-errors.spec.ts"
    - ".changeset/mcp-server-test-case-domain.md"
  modified:
    - "testplanit/e2e/tests/api-tokens/scopes.spec.ts"
    - "packages/mcp-server/README.md"

key-decisions:
  - "Folder non-empty delete rule is MCP-tool-layer enforcement, not REST-API enforcement — documented in validation-errors.spec.ts Group 2"
  - "validation-errors.spec.ts documents actual host behavior (host allows soft-delete PATCH on non-empty folders) to clarify the MCP tool's pre-check role"
  - "scopes.spec.ts extension uses browser.newContext() pattern (matching existing test style) rather than plain request fixture"

requirements-completed: [CASE-01, CASE-02, CASE-03, CASE-04, CASE-05, CASE-06, CASE-07, CASE-08, CASE-09, CASE-10, CASE-11, CASE-12]

# Metrics
duration: ~20min
completed: 2026-05-06
---

# Phase 06 Plan 06: E2E + Documentation + Release Prep Summary

**Three new E2E spec files, one extended spec, README updated with full 12-tool catalog, and a Changesets minor entry — closing out Phase 6 with end-to-end verification of the REST contracts the MCP tools call**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-05-06
- **Tasks:** 5 pre-checkpoint + 1 manual verification checkpoint
- **Files created:** 4
- **Files modified:** 2

## E2E Coverage

### cases.spec.ts — 6 tests

| Test | CASE | What It Proves |
|------|------|----------------|
| create via POST | CASE-03 | Host accepts case create body shape (project/repo/folder/template/state connect syntax) |
| list includes new case | CASE-01 | findMany with projectId+isDeleted filters works; new case appears |
| full detail via findUnique | CASE-02 | Deep includes (project/folder/state/creator) accepted; all FK fields populated |
| update name via PATCH | CASE-04 | PATCH update with `where + data` shape accepted; name reflected in response |
| soft-delete via PATCH isDeleted=true | CASE-05 | PATCH update with isDeleted:true succeeds; response confirms |
| soft-deleted case hidden from list | CASE-05 | isDeleted:false filter in findMany excludes the deleted case |

### folders.spec.ts — 8 tests

| Test | CASE | What It Proves |
|------|------|----------------|
| create root folder | CASE-08 | POST create with project+repository connect, no parent — parentId null |
| create child folder | CASE-08 | POST create with parent:connect — parentId set |
| GET folder tree with case counts | CASE-06 | findMany with _count include; children nested in response |
| rename via PATCH | CASE-09 | PATCH update name field works |
| reparent via disconnect | CASE-09 | `parent: { disconnect: true }` in update body → parentId null |
| soft-delete child | CASE-10 | PATCH update isDeleted:true on empty folder works |
| soft-deleted child hidden from list | CASE-10 | isDeleted:false filter excludes deleted folder |
| soft-delete root | CASE-10 | PATCH update isDeleted:true on now-empty root works |

### validation-errors.spec.ts — 5 tests (2 groups)

**Group 1 (CASE-12 — missing required relation):**
- POST create without `template:connect` returns non-2xx with error body — host enforces non-nullable FK

**Group 2 (CASE-10/CASE-12 — host REST behavior documentation):**
- Setup: create folder; create case in folder
- Documented finding: host REST API allows PATCH `isDeleted:true` on non-empty folders; the "no cases, no sub-folders" rule is enforced in the MCP tool handler (testplanit_folders_delete checks counts before issuing the PATCH), NOT at the REST API layer
- Cleanup: soft-delete the case

### scopes.spec.ts extension — 3 new tests (11 total, was 8)

| New Test | T-ID | What It Proves |
|----------|------|----------------|
| POST repositoryCases/create with mode:read → 403 + READ_ONLY_TOKEN | T-06-01 | Phase 6 case creates blocked at auth gate |
| PATCH repositoryCases/update with mode:read → 403 + READ_ONLY_TOKEN | T-06-01 | Phase 6 case updates blocked at auth gate |
| POST repositoryFolders/create with mode:read → 403 + READ_ONLY_TOKEN | T-06-01 | Phase 6 folder creates blocked at auth gate |

**Cumulative READ_ONLY_TOKEN regression coverage:** tags/create (Phase 5) + repositoryCases/create + repositoryCases/update + repositoryFolders/create (Phase 6).

## README Tool Catalog

The README was updated with a full `## Tool Catalog` section covering all 12 Phase 6 tools:

| Domain | Tools |
|--------|-------|
| Context | `testplanit_whoami`, `testplanit_projects_list` |
| Cases | `testplanit_cases_list`, `testplanit_cases_get`, `testplanit_cases_create`, `testplanit_cases_update`, `testplanit_cases_delete` |
| Folders | `testplanit_folders_list`, `testplanit_folders_get`, `testplanit_folders_create`, `testplanit_folders_update`, `testplanit_folders_delete` |
| Tags | `testplanit_tags_list` |

Each tool entry includes: one-paragraph description, JSON input example with optional/required comments, JSON output example.

Additional sections added:
- `## Soft-Delete Invariant` — all delete tools use PATCH `isDeleted:true`, never ZenStack `delete` (T-06-06)
- `## Read-Only Tokens` — cross-references token scopes section; all Phase 6 write tools inherit Phase 5's host gate

## Changesets Entry

`.changeset/mcp-server-test-case-domain.md` declares `@testplanit/mcp-server: minor` with a 5-bullet summary covering:
- Cases domain (5 tools with features)
- Folders domain (5 tools with features)
- Tags + context (2 tools)
- Soft-delete invariant
- Read-only token enforcement

## Task Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: cases.spec.ts | `2d293a8a` | testplanit/e2e/tests/mcp/cases.spec.ts |
| Task 2: folders + validation-errors | `b7f866a2` | testplanit/e2e/tests/mcp/folders.spec.ts, testplanit/e2e/tests/mcp/validation-errors.spec.ts |
| Task 3: scopes.spec.ts extension | `2fdf3553` | testplanit/e2e/tests/api-tokens/scopes.spec.ts |
| Task 4: README update | `30f11157` | packages/mcp-server/README.md |
| Task 5: Changesets entry | `df9ed8e9` | .changeset/mcp-server-test-case-domain.md |

## Deviations from Plan

### Auto-documented discoveries (not auto-fixes — behavioral findings)

**1. [Discovery] Folder non-empty delete enforcement is at MCP tool layer, not REST layer**
- **Found during:** Task 2 (validation-errors.spec.ts Group 2)
- **Finding:** The host REST API allows PATCH `data: { isDeleted: true }` on `repositoryFolders` regardless of folder contents. The "no cases, no sub-folders" enforcement lives in `testplanit_folders_delete` tool handler (06-04 implementation), which checks non-deleted case/child counts before issuing the PATCH.
- **Impact:** The validation-errors.spec.ts Group 2 test was adapted to document this host contract rather than assert 422. The MCP tool behavior (pre-check + structured error) is correct; the REST behavior is also correct (not a bug).
- **Plan update:** The plan's Task 2 explicitly anticipated this case: "If the host does NOT enforce this rule via the REST API and only via UI logic, document this — the test then asserts only that the soft-delete proceeds." Applied.

## Known Stubs

None. All E2E specs test real REST endpoints against a production build. The README documents real tool inputs/outputs from the Phase 6 implementations. No placeholder data.

## Cumulative Phase 6 Test Counts

| Category | Count |
|----------|-------|
| Unit tests (plans 06-01..06-05) | 216 |
| E2E tests — cases.spec.ts | 6 |
| E2E tests — folders.spec.ts | 8 |
| E2E tests — validation-errors.spec.ts | 5 |
| E2E tests — scopes.spec.ts (Phase 5: 8 + Phase 6 extension: 3) | 11 |
| **Total E2E tests** | **30** |

## T-06-06 Invariant — grep proof (E2E specs)

```bash
grep -rcE "DELETE.*/api/model/(repositoryCases|repositoryFolders)" testplanit/e2e/tests/mcp/
# → 0 actual HTTP DELETE calls (only comments documenting the invariant)
```

All delete operations in E2E specs use `request.patch(...)` with `data: { isDeleted: true }`.

## T-06-06 Invariant — grep proof (MCP source)

```bash
grep -rcE '"delete"|"deleteMany"' packages/mcp-server/src/tools/ --include="*.ts" | grep -v ".test.ts"
# → all 0 hit counts across all implementation files
```

## Threat Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-06-01 | Verified end-to-end: scopes.spec.ts extension proves repositoryCases/create + repositoryCases/update + repositoryFolders/create all return 403+READ_ONLY_TOKEN for mode:read tokens |
| T-06-04 | Accepted: test data created in E2E runs leaves tags in the test DB; cleared by seed reset |
| T-06-05 | Verified: Playwright traces capture Authorization headers but not request bodies for these tests; token values not in request body |
| T-06-06 | Verified: zero `request.delete(...)` calls in E2E specs; all deletes via PATCH update isDeleted:true |

## Manual Verification (Task 6 — Checkpoint)

Task 6 is a `checkpoint:human-verify` gate. Awaiting user confirmation that Claude Desktop can:
a. List projects via `testplanit_projects_list`
b. Show folder tree via `testplanit_folders_list`
c. List test cases via `testplanit_cases_list`
d. Get case detail via `testplanit_cases_get`
e. Create a new case via `testplanit_cases_create` and see it in the TestPlanIt UI
f. Soft-delete the case via `testplanit_cases_delete`
Plus: confirm read-only token surfaces a structured error on case create.

## Self-Check

### File existence
- `testplanit/e2e/tests/mcp/cases.spec.ts` — FOUND
- `testplanit/e2e/tests/mcp/folders.spec.ts` — FOUND
- `testplanit/e2e/tests/mcp/validation-errors.spec.ts` — FOUND
- `testplanit/e2e/tests/api-tokens/scopes.spec.ts` (modified) — FOUND
- `packages/mcp-server/README.md` (modified) — FOUND
- `.changeset/mcp-server-test-case-domain.md` — FOUND

### Commit existence
- `2d293a8a` (cases.spec.ts) — FOUND
- `b7f866a2` (folders.spec.ts + validation-errors.spec.ts) — FOUND
- `2fdf3553` (scopes.spec.ts extension) — FOUND
- `30f11157` (README update) — FOUND
- `df9ed8e9` (Changesets entry) — FOUND

## Self-Check: PASSED

---
*Phase: 06-test-case-domain-read-write*
*Completed: 2026-05-06*
