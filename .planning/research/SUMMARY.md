# Project Research Summary

**Project:** Cross-project copy/move of test cases — TestPlanIt v0.17.0
**Domain:** Bulk data migration within a multi-tenant test management platform
**Researched:** 2026-03-20
**Confidence:** HIGH

## Executive Summary

This milestone adds cross-project copy and move of test cases to TestPlanIt, an existing Next.js/ZenStack/BullMQ application. The research conclusion is unambiguous: zero new dependencies are required. Every building block — BullMQ async jobs, SSE streaming, Prisma transactions, ZenStack access control, Elasticsearch sync, S3 attachment references, audit logging — is already installed and in active use. The implementation is a matter of wiring together existing patterns, not introducing new technology. The auto-tag worker and the import route together form the direct blueprint for the entire feature.

The recommended approach is a BullMQ-backed async job (modeled exactly on `autoTagWorker.ts`) with a polling status endpoint, triggered from both the row context menu and the bulk actions toolbar via a new `CopyMoveDialog` component. Pre-flight checks at the API layer handle permission verification, template compatibility, workflow state mapping, and unique constraint collision detection before the job is enqueued. The worker processes cases sequentially with per-case commits, syncing Elasticsearch and writing audit logs after each case. Move operations update `RepositoryCaseVersions.projectId` and soft-delete source cases; copy operations create fresh version 1 snapshots.

The critical risks are all data-integrity related: partial move failures that leave cases in both projects, silent unique constraint drops (ZenStack v3 surfaces these differently from Prisma v2 — string matching required, not `err.code`), invalid field value IDs if templates differ between projects, and dangling `sharedStepGroupId` references that must be flattened to standalone steps in the target. ZenStack v3 deadlocks on concurrent bulk jobs are a known issue in this codebase and must be mitigated with `concurrency: 1` on the queue and deadlock retry logic in the worker.

---

## Key Findings

### Recommended Stack

No new packages. All required capabilities exist. The two patterns to follow are (1) `workers/autoTagWorker.ts` for BullMQ job structure, progress reporting, cancellation, and multi-tenant Prisma client setup, and (2) `app/api/repository/import/route.ts` for the per-case data creation logic (steps, field values, tags, issues, attachments). The API surface follows the auto-tag pattern: POST to submit returns `{ jobId }`, GET on `status/[jobId]` returns `{ state, progress, result }`.

**Core technologies:**

- **BullMQ** (`^5.71.0`): Async bulk job processing — direct precedent in `autoTagWorker.ts`; copy verbatim for queue setup and worker structure
- **Prisma** (`~6.19.2`): Per-case transactional creates and soft-deletes — `prisma.$transaction()` already proven in `bulk-edit/route.ts`
- **ZenStack** (existing): Access control gating at API entry point only — never inside the worker processor due to policy overhead at scale
- **Valkey/ioredis** (`5.10.1`): Job cancellation flag via `redis.set(cancelKey, '1')` — reuse auto-tag cancellation pattern
- **Zod** (`^4.3.6`): Request body validation for the submit endpoint

**Critical configuration:**

- `attempts: 1` on the BullMQ queue — partial retries on copy/move create duplicates; expose failures cleanly instead
- `concurrency: 1` on the worker — prevents ZenStack v3 deadlocks from concurrent jobs on the same project

### Expected Features

**Must have (table stakes for v0.17.0):**

- Target project picker filtered to projects where user has write access
- Target folder picker (with root option) — loads after project selection
- Copy vs. move operation selector with explicit consequence description
- Full data carry-over: steps, custom field values, tags, issue links, attachments (URL reference, no re-upload)
- Template compatibility check: warn non-admins; auto-assign for admins
- Workflow state mapping: match target states by name, fall back to target default
- Unique constraint collision detection with pre-flight prompt (skip / rename / overwrite)
- Async bulk processing via BullMQ with polling progress bar
- Move preserves full version history (update-in-place); copy starts at version 1
- Cross-project case links explicitly dropped (documented in UI)

**Should have (v0.17.x differentiators):**

- Shared steps carry-over via inline expansion to standalone steps
- Cancel in-flight bulk operation (Redis flag, matching auto-tag)
- Drag-and-drop cross-project move from TreeView

**Defer (v2+):**

- Cross-project shared test case library — fundamentally different data model, out of scope per issue #79
- Per-case rename on conflict (vs. batch rename strategy)

### Architecture Approach

The feature has three distinct layers that must be built in dependency order. The worker layer holds all business logic (case creation, related data copying, version handling, Elasticsearch sync). The API layer handles auth, ZenStack-enforced pre-flight checks, template/workflow compat resolution, and job enqueue — it passes pre-resolved IDs (targetRepositoryId, targetDefaultWorkflowStateId, targetTemplateId) to the worker so the worker does not repeat expensive lookups. The UI layer is a multi-step dialog that transitions from target selection through compatibility warnings to a progress view and final summary.

**Major components:**

1. `workers/copyMoveWorker.ts` — BullMQ processor: per-case create + related data + optional source soft-delete + Elasticsearch sync
2. `app/api/repository/copy-move/route.ts` — Pre-flight: ZenStack auth, template compat, workflow mapping, enqueue
3. `app/api/repository/copy-move/status/[jobId]/route.ts` — Job status polling endpoint
4. `components/CopyMoveDialog.tsx` — Multi-step dialog UI: select, warn, progress, summary
5. `components/copy-move/useCopyMoveJob.ts` — Polling hook mirroring `useAutoTagJob`
6. `lib/queues.ts` + `lib/queueNames.ts` — Queue registration (minimal additions)

**Data carry-over decisions (non-obvious):**

- Tags and Issues: connect by ID (global, no projectId) — no new rows needed
- Attachments: new DB rows pointing to same S3 URLs — zero storage cost, no S3 API calls
- Steps: new rows with `sharedStepGroupId = null`; inline expand shared step content from source SharedStepGroup
- RepositoryCaseVersions: copy = version 1 only; move = copy all version rows AND update `projectId` to target
- TestRunCases, Comments, resultFieldValues, JUnit results: explicitly dropped (execution data, not case definitions)

### Critical Pitfalls

1. **Partial move leaves orphaned records** — Use per-case operations; never soft-delete the source until the target case and all its children are confirmed committed; track `sourceId → targetId` mapping in job progress data for recovery if the job fails mid-batch.

2. **ZenStack v3 deadlocks (40P01)** — `concurrency: 1` on queue; deadlock retry with exponential backoff in worker (pattern already documented in MEMORY.md); use raw `prisma` (not `enhance()`) inside worker processor; gate permissions once at API entry point only.

3. **Unique constraint silent drop** — Pre-flight collision check before enqueueing; surface the conflict list to the user; detect errors by string-matching `err.info?.message` for "duplicate key" — `err.code === "P2002"` does not work in ZenStack v3 (see MEMORY.md).

4. **Template field mapping corruption** — When source and target use different templates, re-resolve Dropdown/Multi-select option IDs by option name into the target template's options; never copy raw integer option IDs across template boundaries.

5. **Shared step dangling references** — Always set `sharedStepGroupId = null` on copied steps; fetch `SharedStepGroup.items` and embed the content inline before nulling the reference; a blank step is worse than a flattened step.

6. **Version history cross-project reference** — For move: update `RepositoryCaseVersions.projectId` to targetProjectId; leave `staticProjectId` unchanged (historical truth); failing to update `projectId` causes ZenStack access policy to evaluate against the wrong project, making history inaccessible to target-project users.

---

## Implications for Roadmap

Based on the dependency graph established in ARCHITECTURE.md and the pitfall-to-phase mapping from PITFALLS.md, the recommended phase structure is:

### Phase 1: Queue and Worker Plumbing

**Rationale:** The worker is the core logic layer everything else depends on. Building it first enables isolated unit testing before any API or UI work exists. Queue registration is a prerequisite for API routes.

**Delivers:** `copyMoveWorker.ts`, queue registration in `lib/queues.ts` + `lib/queueNames.ts`, worker startup registration

**Addresses:** Full data carry-over (steps, field values, tags, issues, attachments, versions)

**Avoids:** Pitfalls 1, 4, 5, 6 — transaction boundaries, field mapping, shared step flattening, and version history migration must all be correct at this layer before anything is built on top

### Phase 2: API Endpoints and Access Control

**Rationale:** Pre-flight logic (ZenStack auth, template compatibility, workflow mapping, collision detection) belongs entirely in the API layer and must be correct before the UI can call it. Status and cancel endpoints are prerequisites for the polling hook.

**Delivers:** `POST /api/repository/copy-move`, `GET /status/[jobId]`, `POST /cancel/[jobId]`

**Addresses:** Template compatibility check, workflow state mapping, unique constraint collision pre-flight, permission verification (source read + target write + source delete for move)

**Avoids:** Pitfalls 2, 3 — deadlock mitigation configuration and access control bypass must be built into this layer

### Phase 3: Dialog UI and Polling Hook

**Rationale:** Depends on working API endpoints. The dialog has four distinct steps (target selection, compatibility warnings, progress, summary) that can only be verified once the API returns real pre-flight data and real job progress.

**Delivers:** `CopyMoveDialog.tsx`, `useCopyMoveJob.ts`, progress bar driven by `{ processed, total }`, final summary view with per-case outcomes

**Addresses:** Progress feedback, collision surfacing in UI, shared step flatten warning, cross-project link drop documentation, confirmation before destructive move

### Phase 4: Entry Points and Integration

**Rationale:** Final binding of the dialog to the existing UI. Context menu and bulk toolbar additions are small changes but must come last because they require the dialog to be complete and stable.

**Delivers:** "Copy/Move to Project" in row context menu (`columns.tsx`) and bulk actions toolbar

**Addresses:** Bulk selection integration with existing `selectedCaseIds` state; single-case integration with row context menu

### Phase 5: Testing and Verification

**Rationale:** The "Looks Done But Isn't" checklist from PITFALLS.md identifies eight specific verification items that cannot be confirmed by visual inspection. E2E tests must run against a production build per project conventions (`pnpm build && E2E_PROD=on pnpm test:e2e`).

**Delivers:** Unit tests for field mapping, shared step flattening, version history migration; integration tests for dual-permission scenarios; E2E test for collision surfacing and end-to-end copy/move flow

**Addresses:** All 8 items from PITFALLS.md "Looks Done But Isn't" checklist; permission symmetry (read-only source can copy, cannot move)

### Phase Ordering Rationale

- **Worker before API:** The API is a thin shell around the worker; building the shell first with a stub worker inverts the dependency and creates wasted rework.
- **API before UI:** Pre-flight API responses (template warnings, workflow mapping summaries, collision lists) directly drive the dialog's multi-step flow; the dialog cannot be designed without knowing what the API returns.
- **Entry points last:** Adding menu items to existing components before the dialog is stable leads to partially-wired UI that blocks QA.
- **Testing as a dedicated phase:** The pitfall checklist is specific enough to warrant dedicated verification work; distributing tests across earlier phases risks the "looks done but isn't" items being assumed correct and going unverified.

### Research Flags

Phases with well-documented patterns (skip `/gsd:research-phase`):

- **Phase 1 (Worker):** Direct blueprint exists in `autoTagWorker.ts` and `import/route.ts`; no research needed
- **Phase 2 (API):** ZenStack access control, queue enqueue, Zod validation — all established patterns in this codebase
- **Phase 4 (Entry Points):** Minor UI additions to existing components; no research needed

Phases that may benefit from targeted research during planning:

- **Phase 2 — template compatibility admin path:** The `TemplateProjectAssignment` admin auto-assign path has a permission boundary edge case (non-admin user triggers admin-only operation); verify `@@allow` rules on `TemplateProjectAssignment` in `schema.zmodel` before implementation
- **Phase 3 — collision UX for large lists:** The pre-flight collision list could be large (100+ conflicts); may need virtualized list rendering; check if existing conflict resolution patterns in the codebase handle large lists efficiently

---

## Confidence Assessment

| Area | Confidence | Notes |
| --- | --- | --- |
| Stack | HIGH | Direct codebase analysis; all packages verified in `package.json`; no external sources required |
| Features | MEDIUM-HIGH | Table stakes derived from direct codebase and competitor research (TestRail, Zephyr Scale, BrowserStack); competitor behavior confirmed via search snippets, not full doc access |
| Architecture | HIGH | All patterns derived from direct reading of production code (`autoTagWorker.ts`, `import/route.ts`, `bulk-edit/route.ts`); no inference from training data |
| Pitfalls | HIGH | ZenStack v3 issues confirmed via MEMORY.md (session memory of prior debugging); unique constraint error format confirmed via prior session work; deadlock patterns documented and reproduced |

**Overall confidence:** HIGH

### Gaps to Address

- **ZenStack `@@allow` delete semantics on RepositoryCases:** Research notes that `canAddEdit` implies delete permission per schema rules, but this needs verification against the actual `@@allow` expressions in `schema.zmodel` during Phase 2. If delete requires a different permission condition, the pre-flight check logic must be updated accordingly.

- **TemplateProjectAssignment admin auto-assign:** The admin path for auto-assigning a template to the target project needs ZenStack policy verification — confirm that an admin-level user creating a `TemplateProjectAssignment` row via `enhance(db, { user })` is permitted by existing access rules without requiring a separate elevated-privilege client.

- **`folderMaxOrders` race condition:** The import route fetches folder max order inside the per-case loop, which creates a race condition when multiple cases land in the same folder concurrently. The worker should pre-fetch max orders for all target folders before the loop and increment in memory. This needs to be designed into Phase 1 before implementation, not discovered in testing.

- **`RepositoryCaseVersions` cascade behavior on source delete:** For move operations, deleting the source `RepositoryCases` row cascades to its `RepositoryCaseVersions`. The plan is to copy those version rows to the target case first, then delete the source. Verify that the cascade does not fire before the copy completes — particularly inside a transaction where the delete happens after the copy.

---

## Sources

### Primary (HIGH confidence — direct codebase analysis)

- `testplanit/workers/autoTagWorker.ts` — BullMQ worker pattern, multi-tenant setup, cancellation, progress reporting
- `testplanit/app/api/repository/import/route.ts` — per-case creation, SSE streaming, tag/issue/attachment/step logic
- `testplanit/app/api/projects/[projectId]/cases/bulk-edit/route.ts` — `prisma.$transaction()` for bulk mutations
- `testplanit/schema.zmodel` lines 1219-1268 — `RepositoryCases` unique constraint, access rules, version schema
- `testplanit/lib/queues.ts` — lazy queue initialization pattern
- `testplanit/lib/services/testCaseVersionService.ts` — version creation in transaction, version copying
- `testplanit/lib/utils/errors.ts` — `isUniqueConstraintError`, `isNotFoundError`, `isForeignKeyError`
- `testplanit/lib/multiTenantPrisma.ts` — `getPrismaClientForJob`, `validateMultiTenantJobData`
- Session MEMORY.md — ZenStack v3 deadlock patterns, 63-char alias limit, error format changes, deadlock retry pattern

### Secondary (MEDIUM confidence — competitor research)

- [TestRail: Moving, copying, deleting and restoring test cases](https://support.testrail.com/hc/en-us/articles/7101747563028-Moving-copying-deleting-and-restoring-test-cases) — competitor feature baseline
- [BrowserStack: Moving test cases across projects](https://www.browserstack.com/release-notes/en/moving-test-cases-across-projects) — folder picker UX, permission filtering
- [SmartBear Community: Zephyr Scale cross-project](https://community.smartbear.com/discussions/zephyrscale/moving-test-cases-from-one-project-to-another/213033) — export/import cycle limitation confirms native UI is a differentiator
- `.planning/PROJECT.md` — issue #79 requirements and explicit out-of-scope decisions (shared library, cross-project links)

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*
