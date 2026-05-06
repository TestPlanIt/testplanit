---
phase: 06-test-case-domain-read-write
plan: 01
subsystem: api
tags: [mcp-server, zenstack, rpc, http-client, typescript, vitest, tdd]

# Dependency graph
requires:
  - phase: 05-mcp-server-foundation-read-only-token-flag
    provides: "TestPlanItHttpError, EnvConfig, redactToken — Phase 5 HTTP primitives consumed by api.ts"

provides:
  - "zenstack<T>(model, operation, body, env) — internal ZenStack RPC dispatcher (GET/?q= for reads, POST/PATCH/DELETE for writes)"
  - "lookup(options, env) — name→ID resolution via /api/cli/lookup"
  - "resolveActiveRepository(projectId, env) — returns active repository ID or throws 422"
  - "resolveDefaultTemplate(projectId, env) — returns first enabled template ID or throws 422"
  - "resolveCaseWorkflowState(projectId, env, name?) — returns CASES-scope workflow state or throws 422"

affects:
  - "06-02 (cases read tools)"
  - "06-03 (cases write tools)"
  - "06-04 (folders tools)"
  - "06-05 (tags tool)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ZenStack RPC dispatch: READ_OPS→GET+?q=, POST_OPS→POST, PATCH_OPS→PATCH, DELETE_OPS→DELETE"
    - "Bearer header helper (bearerHeaders) — centralizes Authorization + Content-Type"
    - "Resolver pattern: zenstack<T[]>(findMany) → validate non-empty → return first row's id"
    - "TDD RED/GREEN cycle with vi.spyOn(globalThis, 'fetch') for mock isolation"

key-files:
  created:
    - "packages/mcp-server/src/api.ts"
    - "packages/mcp-server/src/api.test.ts"
  modified:
    - "packages/mcp-server/src/index.ts"

key-decisions:
  - "D-01 honored: zero @testplanit/api imports in api.ts — package stays self-contained for standalone install"
  - "ZenStack dispatch table mirrors packages/api/src/client.ts exactly (READ_OPS / POST_OPS / PATCH_OPS / DELETE_OPS sets)"
  - "resolveCaseWorkflowState uses zenstack('workflows','findMany') with scope:CASES, not /api/cli/lookup (which hardcodes RUNS)"
  - "All 422 errors from resolvers carry human-readable messages including the projectId for operator debuggability"
  - "Bearer token never appears in any error message — error paths use HTTP status + path only (T-06-05)"

patterns-established:
  - "Pattern: import { zenstack, lookup, resolveActiveRepository, resolveDefaultTemplate, resolveCaseWorkflowState } from '../api.js' — the standard Phase 6 tool import"
  - "Pattern: CaseField lookups use zenstack('caseFields','findMany') directly, NOT lookup() — caseField is not a supported lookup type"
  - "Pattern: soft-delete via zenstack('repositoryCases','update', {where:{id},data:{isDeleted:true}}) — never use 'delete' operation (T-06-06)"
  - "Pattern: all error handling goes through mapHttpErrorToToolResult(err) from errors.ts"

requirements-completed: [CASE-01, CASE-02, CASE-03, CASE-04, CASE-05, CASE-06, CASE-07, CASE-08, CASE-09, CASE-10, CASE-11, CASE-12]

# Metrics
duration: 8min
completed: 2026-05-06
---

# Phase 06 Plan 01: ZenStack RPC Client + Project Resolvers Summary

**Internal ZenStack HTTP client with typed dispatch table and three project-scoped resolver helpers, enabling all Phase 6 write tools to construct case/folder create bodies without boilerplate**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-06T20:58:00Z
- **Completed:** 2026-05-06T21:01:52Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 3

## Accomplishments

- `zenstack<T>()` dispatcher: 6 read ops → GET+`?q=`; 3 create ops → POST; 2 update ops → PATCH; 2 delete ops → DELETE; unknown → POST default
- `lookup()` helper: POSTs `/api/cli/lookup` and returns `{ id, name, created? }` with structured error on non-2xx
- Three resolver helpers: `resolveActiveRepository`, `resolveDefaultTemplate`, `resolveCaseWorkflowState` — each throws TestPlanItHttpError with statusCode 422 and a human-readable message when the project is missing the prerequisite entity
- 35 unit tests passing (26 `it()` blocks; parameterized tests expand to 35 total): full dispatch table, error envelope, 422 remap, lookup contract, resolver success+failure paths, token-leak guard
- All five exports added to `packages/mcp-server/src/index.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing tests for api.ts (RED)** - `ec16b0cf` (test)
2. **Task 2: Implement api.ts to make tests pass (GREEN)** - `4cceaa24` (feat)

**Plan metadata:** committed with SUMMARY.md

## Files Created/Modified

- `packages/mcp-server/src/api.ts` — ZenStack RPC dispatcher + name lookup + three project resolvers (250 lines)
- `packages/mcp-server/src/api.test.ts` — 35-test Vitest suite covering all dispatch paths, error shapes, and resolver edge cases (397 lines)
- `packages/mcp-server/src/index.ts` — appended re-exports for zenstack, lookup, resolveActiveRepository, resolveDefaultTemplate, resolveCaseWorkflowState, and LookupRequest/LookupResponse/LookupType

## zenstack<T>() Dispatch Table

| Operations | HTTP Method | URL Pattern | Body/Query |
|-----------|------------|-------------|-----------|
| `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy` | GET | `/api/model/{model}/{operation}?q={encoded}` | `?q=encodeURIComponent(JSON.stringify(body))` — omitted when body is undefined/null |
| `create`, `createMany`, `upsert` | POST | `/api/model/{model}/{operation}` | JSON body |
| `update`, `updateMany` | PATCH | `/api/model/{model}/{operation}` | JSON body |
| `delete`, `deleteMany` | DELETE | `/api/model/{model}/{operation}` | JSON body |
| (any other operation) | POST | `/api/model/{model}/{operation}` | JSON body (default fallback) |

## lookup() Type Union

| Type | projectId required? | createIfMissing? | Notes |
|------|--------------------|--------------------|-------|
| `"project"` | No | No | Global lookup by name |
| `"state"` | Yes | No | RUNS scope only — do NOT use for case workflow state |
| `"config"` | No | No | Global lookup |
| `"milestone"` | Yes | No | Project-scoped |
| `"tag"` | No | Yes | Creates tag if absent when `createIfMissing: true` |
| `"folder"` | Yes | No | Project-scoped by name in active repository |
| `"testRun"` | Yes | No | Returns most-recent by `createdAt desc` on duplicate names |

**NOT supported by lookup():** `CaseField` — use `zenstack("caseFields","findMany",{where:{displayName,isDeleted:false}})` directly.

## Resolver Helper Contracts

### resolveActiveRepository(projectId, env) → number
- **Input:** `projectId` (number), `env` (EnvConfig)
- **Output:** `id` of first matching `repositories` row with `isActive:true, isDeleted:false, isArchived:false`
- **422 condition:** No matching rows → `"No active repository found for project {id}. Open TestPlanIt and add a test case to initialize the repository."`

### resolveDefaultTemplate(projectId, env) → number
- **Input:** `projectId` (number), `env` (EnvConfig)
- **Output:** `id` of first `templates` row with `isDeleted:false, isEnabled:true, projects:{some:{projectId}}`
- **422 condition:** No matching rows → `"No enabled template assigned to project {id}. Assign a template to the project from the TestPlanIt admin UI."`

### resolveCaseWorkflowState(projectId, env, name?) → { id, name }
- **Input:** `projectId`, `env`, optional `name` string
- **Output:** `{ id, name }` of first matching `workflows` row with `scope:"CASES"`, ordered by `order asc`
- **422 condition:** No matching rows → `"No CASES-scope workflow state found for project {id}[named "{name}"]."`
- **Critical:** Uses `zenstack("workflows","findMany")` directly — NOT `/api/cli/lookup` (that endpoint hardcodes `WorkflowScope.RUNS`)

## Notes for Plans 06-02..06-05

**Standard imports for Phase 6 tool files:**
```typescript
import { zenstack, lookup, resolveActiveRepository, resolveDefaultTemplate, resolveCaseWorkflowState } from "../api.js";
import type { EnvConfig } from "../env.js";
```

**CaseField resolution (D-07):** `lookup()` does NOT support `caseField` type. Use:
```typescript
zenstack<{id:number}[]>("caseFields", "findMany", { where: { displayName: fieldName, isDeleted: false, isEnabled: true } }, env)
```

**Soft-delete (T-06-06):** Always use `update` with `isDeleted: true`:
```typescript
zenstack("repositoryCases", "update", { where: { id }, data: { isDeleted: true } }, env)
// NEVER use: zenstack("repositoryCases", "delete", ...)
```

**Error handling in tool handlers:**
```typescript
} catch (err) {
  return mapHttpErrorToToolResult(err);
}
```

## Decisions Made

- D-01 honored: zero `@testplanit/api` imports — MCP package stays self-contained
- `resolveCaseWorkflowState` queries `workflows` model directly with `scope:"CASES"` rather than delegating to `lookup()` (which hardcodes `WorkflowScope.RUNS` at `/api/cli/lookup/route.ts` line 106)
- Error messages in `zenstack<T>()` include the path (`/api/model/{model}/{operation}`) and HTTP status but never the bearer token or raw response body verbatim
- `resolveDefaultTemplate` uses `projects: { some: { projectId } }` filter (relation join) rather than a direct FK since templates are assigned through a join table

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — `api.ts` is a pure HTTP utility module with no UI rendering or placeholder data.

## Threat Flags

No new threat surface introduced. All HTTP calls are outbound to the existing `/api/model/` and `/api/cli/lookup` endpoints, using the same bearer token established in Phase 5. No new network endpoints, auth paths, or file access patterns.

## Next Phase Readiness

All five helpers are exported from `packages/mcp-server/src/index.ts` and available for immediate use in Plans 06-02..06-05. The dispatch table covers all ZenStack operations needed by case/folder/tag tools. Plans 06-02..06-05 can now proceed in parallel (they all depend on 06-01 only).

## Self-Check

### File existence
- `packages/mcp-server/src/api.ts` — FOUND
- `packages/mcp-server/src/api.test.ts` — FOUND
- `packages/mcp-server/src/index.ts` (modified) — FOUND

### Commit existence
- `ec16b0cf` (RED: failing tests) — FOUND
- `4cceaa24` (GREEN: implementation) — FOUND

## Self-Check: PASSED

---
*Phase: 06-test-case-domain-read-write*
*Completed: 2026-05-06*
