---
phase: 49-resolution-engine
plan: "02"
subsystem: duplicate-scan-api
tags: [api-routes, duplicate-scan, merge, resolution]
dependency_graph:
  requires: [49-01]
  provides: [resolve-endpoint, case-details-endpoint]
  affects: [duplicate-scan-ui]
tech_stack:
  added: []
  patterns: [zod-discriminated-union, parallel-prisma-fetch, auth-guard]
key_files:
  created:
    - testplanit/app/api/duplicate-scan/resolve/route.ts
    - testplanit/app/api/duplicate-scan/case-details/route.ts
  modified: []
decisions:
  - Steps model uses step (Json) and expectedResult (Json) fields, not title — query adjusted to select correct schema fields
  - CaseFieldValues relation to CaseFields is named field (not caseField) with displayName (not name) — corrected from plan spec
  - RepositoryCases has no top-level description field — omitted; description is stored in caseFieldValues if needed
  - status field on TestRunCases is a relation to Status model — selected as object with id and name rather than scalar
metrics:
  duration: "5m"
  completed_date: "2026-03-23"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 49 Plan 02: Resolve and Case-Details API Routes Summary

Two API routes that expose resolution actions and full case data for the duplicate scan comparison dialog: POST resolve with merge/link/dismiss, GET case-details with parallel case fetch.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | POST /api/duplicate-scan/resolve route | a63b5923 | testplanit/app/api/duplicate-scan/resolve/route.ts |
| 2 | GET /api/duplicate-scan/case-details route | f53cc43d | testplanit/app/api/duplicate-scan/case-details/route.ts |

## What Was Built

### resolve/route.ts

Single POST endpoint that accepts `action: merge | link | dismiss` via a `z.discriminatedUnion`. Guards with `getServerSession(authOptions)`, returns 401 if unauthenticated. Validates body with Zod, returns 400 with flatten() details on failure. Delegates to `mergeCases`, `linkCases`, or `dismissPair` from `mergeService` and returns structured `{ action, ...result }` JSON. Wrapped in try/catch with `console.error` and 500 fallback.

### case-details/route.ts

GET endpoint accepting `caseAId` and `caseBId` query params (coerced to int with Zod). Fetches both cases in parallel via `Promise.all` using raw `prisma` client (not ZenStack enhanced — safe for reads, avoids alias limit). Returns `{ caseA, caseB }` with name, steps (step Json + expectedResult Json), tags, folder, caseFieldValues with field displayName, attachments count, and last run status (TestRunCases status relation). Returns 404 if either case is null. All includes are max 2 levels deep to avoid the ZenStack 63-char alias limit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected schema field names in case-details query**
- **Found during:** Task 2
- **Issue:** Plan spec used `steps.title` (doesn't exist — field is `step: Json?`), `caseFieldValues.caseField` (relation is named `field`), and `caseField.name` (field is `displayName` on CaseFields). Also referenced `description` as a top-level RepositoryCases field which does not exist in the schema.
- **Fix:** Updated `fetchCaseDetails` to use `step` instead of `title`, `field` instead of `caseField`, `displayName` instead of `name`, and removed the non-existent `description` field. Added status relation select with `{ id: true, name: true }` for proper type safety.
- **Files modified:** testplanit/app/api/duplicate-scan/case-details/route.ts
- **Commit:** f53cc43d

## Self-Check: PASSED

- testplanit/app/api/duplicate-scan/resolve/route.ts: FOUND
- testplanit/app/api/duplicate-scan/case-details/route.ts: FOUND
- Commit a63b5923: FOUND
- Commit f53cc43d: FOUND
- TypeScript errors for new files: NONE (verified via `tsc --noEmit | grep route`)
