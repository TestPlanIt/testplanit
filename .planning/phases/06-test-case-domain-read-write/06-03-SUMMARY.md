---
phase: 06-test-case-domain-read-write
plan: 03
subsystem: mcp-server/tools/cases
tags: [mcp-server, tools, cases, write, zenstack, tdd, vitest, typescript, soft-delete, custom-fields, steps, prosemirror]

# Dependency graph
requires:
  - phase: 06-test-case-domain-read-write
    plan: 01
    provides: "zenstack<T>, lookup, resolveActiveRepository, resolveDefaultTemplate, resolveCaseWorkflowState"
  - phase: 06-test-case-domain-read-write
    plan: 02
    provides: "shared helpers: buildFolderBreadcrumb, mapCaseDetail, mapCaseRow — consumed by fetchDetail.ts"

provides:
  - "testplanit_cases_create — create test case with steps/tags/customFields, returns CASE-02 shape (CASE-03)"
  - "testplanit_cases_update — partial update (name/steps/tags/customFields/stateName/folderId), returns CASE-02 shape (CASE-04)"
  - "testplanit_cases_delete — soft-delete test case, returns { id, isDeleted: true } (CASE-05)"
  - "resolveCustomFields(input, env) — name→ID resolution with 422 for unknown/ambiguous (CASE-12)"
  - "writeCustomFieldValues(caseId, resolved, env) — upsert CaseFieldValues pipeline (D-07)"
  - "wrapPlainTextInProseMirror(text) — wrap agent text in minimal Tiptap doc structure"
  - "createStepsForCase(caseId, steps, env) — sequential step creates"
  - "replaceStepsForCase(caseId, steps, env) — soft-delete + create replacement (T-06-06)"
  - "fetchCaseDetail(caseId, env) — shared re-fetch helper for D-10 shape after writes"
  - "registerCases(server, deps) — central registry now includes all 5 case tools"

affects:
  - "06-06 (E2E: case CRUD via API contract, scopes.spec.ts READ_ONLY_TOKEN tests)"
  - "06-04 (folders tools: registerCases extended pattern)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Custom field pipeline: resolveCustomFields (findMany by displayName) → writeCustomFieldValues (findFirst+update or create)"
    - "Steps replacement: soft-delete via updateMany(isDeleted:true) then sequential create — T-06-06 invariant"
    - "ProseMirror wrapping: wrapPlainTextInProseMirror produces { type:'doc', content:[{type:'paragraph', content:[{type:'text',text}]}] }"
    - "Tag resolution: number→use directly; string→lookup(createIfMissing:true); empty string→422"
    - "fetchDetail.ts: shared re-fetch module so create+update return identical CASE-02 shape as get"
    - "Partial update pattern: build data={} object, add only provided fields, skip write if empty"
    - "Head fetch in update: findUnique for projectId before write (needed for state resolution)"

key-files:
  created:
    - "packages/mcp-server/src/tools/cases/customFields.ts"
    - "packages/mcp-server/src/tools/cases/customFields.test.ts"
    - "packages/mcp-server/src/tools/cases/steps.ts"
    - "packages/mcp-server/src/tools/cases/steps.test.ts"
    - "packages/mcp-server/src/tools/cases/create.ts"
    - "packages/mcp-server/src/tools/cases/create.test.ts"
    - "packages/mcp-server/src/tools/cases/update.ts"
    - "packages/mcp-server/src/tools/cases/update.test.ts"
    - "packages/mcp-server/src/tools/cases/delete.ts"
    - "packages/mcp-server/src/tools/cases/delete.test.ts"
    - "packages/mcp-server/src/tools/cases/fetchDetail.ts"
  modified:
    - "packages/mcp-server/src/tools/cases/index.ts"

key-decisions:
  - "fetchDetail.ts is a dedicated module (not inlined in create/update) so the exact CASE-02 include shape is defined once and shared"
  - "update.ts does a head findUnique first to get projectId for state resolution; this also serves as an existence check"
  - "resolveTagIds is duplicated in create.ts and update.ts to avoid cyclic imports between tool modules"
  - "T-06-05 enforcement: resolveCustomFields error messages reference field NAME only — the input value is never included in any error string"
  - "T-06-06 enforcement: steps replacement uses updateMany(isDeleted:true) + sequential create — 0 calls to delete/deleteMany across all implementation files"
  - "T-06-02 enforcement: ambiguous displayName (duplicate CaseFields) throws 422 rather than silently selecting first"
  - "creatorId is never passed in create body — host route.ts auto-injects it"

requirements-completed: [CASE-03, CASE-04, CASE-05, CASE-12]

# Metrics
duration: ~15min
completed: 2026-05-06
---

# Phase 06 Plan 03: Test Case Write Tools Summary

**Three write tools (`testplanit_cases_create`, `testplanit_cases_update`, `testplanit_cases_delete`) plus custom-field name→ID resolver and ProseMirror steps helpers — all deletes soft-only; custom field errors name the field never the value; READ_ONLY_TOKEN regression proven via unit tests**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-05-06
- **Tasks:** 3 (TDD RED+GREEN each)
- **Files created:** 11
- **Files modified:** 1

## Tool Input Schemas

### `testplanit_cases_create` (CASE-03)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | `number` (int, positive) | yes | Project to create the case in |
| `folderId` | `number` (int, positive) | yes | Folder to place the case in |
| `name` | `string` (1–2000 chars) | yes | Test case name |
| `stateName` | `string` (min 1) | no | CASES workflow state name; defaults to first by order |
| `steps` | `StepInput[]` | no | Ordered steps with `text`, `expectedResult?`, `order?` |
| `tags` | `(number | string)[]` | no | Tag IDs or names (created if missing) |
| `customFields` | `Record<string, unknown>` | no | `{ "<displayName>": <value> }` — names resolved to IDs server-side |

### `testplanit_cases_update` (CASE-04)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `caseId` | `number` (int, positive) | yes | ID of the test case to update |
| `name` | `string` (1–2000 chars) | no | New name |
| `stateName` | `string` (min 1) | no | CASES workflow state name |
| `folderId` | `number` (int, positive) | no | Move to this folder |
| `steps` | `StepInput[]` | no | New step set — replaces ALL existing (soft-deletes old ones first) |
| `tags` | `(number | string)[]` | no | New tag set — replaces entire set |
| `customFields` | `Record<string, unknown>` | no | Fields to upsert (existing rows updated, absent ones created) |

### `testplanit_cases_delete` (CASE-05)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `caseId` | `number` (int, positive) | yes | ID of the test case to soft-delete |

## Custom-Field Write Pipeline (CASE-12 / D-07)

```
Input: { "Priority": "High", "Severity": 3 }
         ↓
resolveCustomFields()
  → zenstack("caseFields", "findMany", { where: { displayName: { in: [...] }, isDeleted: false, isEnabled: true } })
  → Group by displayName:
      - Unknown name → throw TestPlanItHttpError(422, "Custom field '{name}' not found or not enabled")
      - Ambiguous name → throw TestPlanItHttpError(422, "Custom field '{name}' is ambiguous")
      - Single match → { fieldId, value, name }
  → Returns: [{ fieldId: 1, value: "High", name: "Priority" }, { fieldId: 2, value: 3, name: "Severity" }]
         ↓
writeCustomFieldValues(caseId, resolved, env)
  → For each { fieldId, value }:
      findFirst({ where: { testCaseId, fieldId } })
      if found  → update({ where: { id }, data: { value } })
      if missing → create({ data: { testCase: { connect: { id: caseId } }, field: { connect: { id: fieldId } }, value } })
```

CRITICAL (T-06-05): Error messages from `resolveCustomFields` reference the field NAME only. The input VALUE is never included in any error message, preventing PII leakage.

## Steps Replacement Strategy (T-06-06)

Steps replacement in `testplanit_cases_update` uses a **soft-delete + create** approach:

```typescript
// 1. Soft-delete all non-deleted steps (NEVER use delete/deleteMany)
await zenstack("steps", "updateMany", {
  where: { testCaseId: caseId, isDeleted: false },
  data: { isDeleted: true },
}, env);

// 2. Create new ordered step set
for (const [index, step] of steps.entries()) {
  await zenstack("steps", "create", {
    data: {
      testCase: { connect: { id: caseId } },
      order: step.order ?? index,
      step: wrapPlainTextInProseMirror(step.text ?? ""),
      expectedResult: step.expectedResult != null
        ? wrapPlainTextInProseMirror(step.expectedResult)
        : null,
    },
  }, env);
}
```

Agent-supplied plain text is wrapped in the minimal Tiptap ProseMirror doc structure so the TestPlanIt UI renders steps correctly:

```json
{ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "..." }] }] }
```

Empty/null text produces `{ "type": "doc", "content": [{ "type": "paragraph", "content": [] }] }`.

## READ_ONLY_TOKEN Regression (T-05-01a carry-forward / T-06-01)

All three write tools have a unit test that simulates a `TestPlanItHttpError(403, code: "READ_ONLY_TOKEN")` being thrown from the first API call. The test asserts:

```typescript
expect(result.isError).toBe(true);
expect(result.content[0].text).toContain("mode:read");
```

This proves the T-05-01a host enforcement (which blocks POST/PATCH for `mode:read` tokens) flows through `mapHttpErrorToToolResult` → `ERROR_CODE_MESSAGES["READ_ONLY_TOKEN"]` → agent-readable message naming the `mode:read` scope.

## `creatorId` Never Passed in Create Body

The `testplanit_cases_create` handler intentionally omits `creatorId` from the create body. The host route.ts at `/api/model/[...path]/route.ts` auto-injects `creator: { connect: { id: userId } }` for `repositoryCases` creates. A unit test asserts:

```typescript
expect(data).not.toHaveProperty("creatorId");
```

## Test Counts per File

| File | Tests | Key Assertions |
|------|-------|----------------|
| `customFields.test.ts` | 8 | resolve valid names, empty input, unknown (422+CASE-12), ambiguous (422), T-06-05 value not in error, upsert (update path), create path, multi-field, empty array no-op |
| `steps.test.ts` | 12 | wrapPlainTextInProseMirror (text/empty/null/undefined), createStepsForCase (order/explicit-order), replaceStepsForCase (soft-delete+create/empty/ordering) |
| `create.test.ts` | 9 | happy path, steps wiring, tags (mixed), customFields, stateName, repo-not-found 422, CASE-12 unknown field, READ_ONLY_TOKEN, no creatorId |
| `update.test.ts` | 9 | partial name-only, tags set, steps replace, customFields, stateName+head fetch, folderId, READ_ONLY_TOKEN, no delete/deleteMany, CASE-02 shape |
| `delete.test.ts` | 5 | soft-delete via update, T-06-06 no delete/deleteMany, P2025→422, READ_ONLY_TOKEN, registration |
| **Total (plan 06-03)** | **43** | |
| **Total (full suite)** | **168** | All 15 test files |

## T-06-06 Invariant — grep proof

```bash
grep -rcE '"delete"|"deleteMany"' \
  packages/mcp-server/src/tools/cases/customFields.ts \
  packages/mcp-server/src/tools/cases/steps.ts \
  packages/mcp-server/src/tools/cases/create.ts \
  packages/mcp-server/src/tools/cases/update.ts \
  packages/mcp-server/src/tools/cases/delete.ts \
  packages/mcp-server/src/tools/cases/fetchDetail.ts
# → 0 hits across all implementation files
```

No `"delete"` or `"deleteMany"` operation string appears in any cases handler. Soft-delete via `"update"` with `isDeleted: true` is the only deletion path.

## Task Commits

| Task | Phase | Commit | Files |
|------|-------|--------|-------|
| Task 1 | RED | `790b2fdb` | customFields.test.ts, steps.test.ts (20 failing tests) |
| Task 1 | GREEN | `1f6200d3` | customFields.ts, steps.ts (20 tests passing) |
| Task 2 | RED | `4a27ca41` | create.test.ts, update.test.ts (20 failing tests) |
| Task 2 | GREEN | `d9d0e258` | create.ts, update.ts, fetchDetail.ts (20 tests passing) |
| Task 3 | RED | `727af445` | delete.test.ts (5 failing tests) |
| Task 3 | GREEN | `03c4a2e3` | delete.ts, index.ts extended (168 total passing, typecheck+build clean) |

## Deviations from Plan

None — plan executed exactly as written. The `resolveTagIds` function was intentionally duplicated in both `create.ts` and `update.ts` (as noted in the plan's pseudocode) to avoid cyclic imports between sibling tool modules.

## Known Stubs

None. All three tools make real ZenStack RPC calls. `fetchDetail.ts` re-fetches the full D-10 shape after every write; no placeholder data.

## Threat Flags

No new threat surface introduced. All writes go through existing `/api/model/repositoryCases/...`, `/api/model/steps/...`, and `/api/model/caseFieldValues/...` endpoints using the same bearer token pattern. No new network endpoints, auth paths, or file access patterns.

## Threat Mitigations Applied

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-06-01 | Verified: READ_ONLY_TOKEN unit tests in all 3 tools assert `mode:read` in error text |
| T-06-02 | Mitigated: ambiguous displayName throws 422 (tested in customFields.test.ts case 4) |
| T-06-05 | Mitigated: resolveCustomFields error contains field NAME only (tested in customFields.test.ts cases 3+5+6) |
| T-06-06 | Mitigated: 0 grep hits for "delete"/"deleteMany" in all impl files; unit tests assert negative path |

## Self-Check

### File existence
- `packages/mcp-server/src/tools/cases/customFields.ts` — FOUND
- `packages/mcp-server/src/tools/cases/customFields.test.ts` — FOUND
- `packages/mcp-server/src/tools/cases/steps.ts` — FOUND
- `packages/mcp-server/src/tools/cases/steps.test.ts` — FOUND
- `packages/mcp-server/src/tools/cases/create.ts` — FOUND
- `packages/mcp-server/src/tools/cases/create.test.ts` — FOUND
- `packages/mcp-server/src/tools/cases/update.ts` — FOUND
- `packages/mcp-server/src/tools/cases/update.test.ts` — FOUND
- `packages/mcp-server/src/tools/cases/delete.ts` — FOUND
- `packages/mcp-server/src/tools/cases/delete.test.ts` — FOUND
- `packages/mcp-server/src/tools/cases/fetchDetail.ts` — FOUND
- `packages/mcp-server/src/tools/cases/index.ts` (modified) — FOUND

### Commit existence
- `790b2fdb` (RED: customFields+steps tests) — FOUND
- `1f6200d3` (GREEN: customFields+steps impl) — FOUND
- `4a27ca41` (RED: create+update tests) — FOUND
- `d9d0e258` (GREEN: create+update+fetchDetail impl) — FOUND
- `727af445` (RED: delete tests) — FOUND
- `03c4a2e3` (GREEN: delete+index) — FOUND

## Self-Check: PASSED

---
*Phase: 06-test-case-domain-read-write*
*Completed: 2026-05-06*
