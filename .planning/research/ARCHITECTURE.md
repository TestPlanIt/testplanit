# Architecture Research

**Domain:** Cross-project copy/move of test cases — integration with existing Next.js/ZenStack/BullMQ stack
**Researched:** 2026-03-20
**Confidence:** HIGH (based on direct codebase analysis of import route, BullMQ worker patterns, schema.zmodel, and ZenStack access control)

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────┐
│                         UI Layer                               │
│  ┌──────────────────────┐   ┌──────────────────────────────┐  │
│  │ CopyMoveDialog        │   │ BulkActionsToolbar (existing) │  │
│  │ - target project pick │   │ + "Copy/Move to Project" item │  │
│  │ - target folder pick  │   └──────────────────────────────┘  │
│  │ - operation selector  │   ┌──────────────────────────────┐  │
│  │ - template warn       │   │ Case context menu (existing)  │  │
│  │ - workflow warn        │   │ + "Copy/Move to Project" item │  │
│  │ - collision resolution│   └──────────────────────────────┘  │
│  └──────────┬───────────┘                                       │
│             │ fetch POST /api/repository/copy-move               │
├─────────────┼─────────────────────────────────────────────────┤
│                       API Layer                                 │
│  ┌──────────▼──────────────────────────────────────────────┐  │
│  │  POST /api/repository/copy-move                          │  │
│  │  - auth + ZenStack policy check (source read, target    │  │
│  │    write, source delete if move)                         │  │
│  │  - template/workflow compatibility check                 │  │
│  │  - enqueue CopyMoveJob → BullMQ                          │  │
│  │  - return { jobId }                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  GET /api/repository/copy-move/status/[jobId]            │  │
│  │  - poll BullMQ for job state + progress                  │  │
│  │  - return { state, progress, result, errors }             │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  POST /api/repository/copy-move/cancel/[jobId]           │  │
│  │  - set Redis cancellation flag (matches autoTag pattern) │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                     Worker Layer                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  copyMoveWorker.ts (new — matches autoTagWorker pattern)  │  │
│  │  - processes CopyMoveJobData from "copy-move" queue       │  │
│  │  - per-case: create new record, copy related data         │  │
│  │  - if move: soft-delete source after all cases copied     │  │
│  │  - calls job.updateProgress({ processed, total })         │  │
│  │  - Elasticsearch sync per case                            │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    Database Layer                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Repos     │  │ RepoCases│  │  Steps   │  │CaseFieldValues│  │
│  │ (target) │  │(new rows)│  │(new rows)│  │  (new rows)   │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Tags    │  │ Issues   │  │Attachments│  │  CaseVersions │  │
│  │(connect) │  │(connect) │  │(new rows)│  │  (new rows)   │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | File Location |
|-----------|---------------|---------------|
| `CopyMoveDialog` | UI for target selection, operation choice, template/workflow warnings, collision resolution | `components/CopyMoveDialog.tsx` (new) |
| `useCopyMoveJob` | Hook managing job submission, polling, progress state — mirrors `useAutoTagJob` | `components/copy-move/useCopyMoveJob.ts` (new) |
| `POST /api/repository/copy-move` | Auth, pre-flight access checks, template/workflow compat check, enqueue job, return jobId | `app/api/repository/copy-move/route.ts` (new) |
| `GET /api/repository/copy-move/status/[jobId]` | Poll BullMQ queue for job state + progress + result | `app/api/repository/copy-move/status/[jobId]/route.ts` (new) |
| `POST /api/repository/copy-move/cancel/[jobId]` | Set Redis flag so worker stops between cases | `app/api/repository/copy-move/cancel/[jobId]/route.ts` (new) |
| `copyMoveWorker.ts` | BullMQ processor: creates new RepositoryCases, related data, optionally deletes source | `workers/copyMoveWorker.ts` (new) |
| `lib/queues.ts` | Add `getCopyMoveQueue()` lazy initializer | Modified (add ~30 lines) |
| `lib/queueNames.ts` | Add `COPY_MOVE_QUEUE_NAME = "copy-move"` | Modified (add 1 line) |
| `columns.tsx` / Bulk toolbar | Context menu + bulk toolbar entry points for the dialog | Modified (add menu items) |

---

## API Endpoint Design

### Single Endpoint vs Separate

**Decision: single POST endpoint that accepts `operation: "copy" | "move"`.**

Rationale: copy and move share identical pre-flight logic (access checks, template compat, workflow compat, target folder validation) and identical data replication logic. The only difference is whether source cases are deleted after replication. Separate endpoints would duplicate all validation code. The import route precedent is a single endpoint with configuration flags.

### Endpoint Contract

```typescript
// POST /api/repository/copy-move
interface CopyMoveRequest {
  operation: "copy" | "move";
  caseIds: number[];                  // Source case IDs
  sourceProjectId: number;            // For access control verification
  targetProjectId: number;
  targetFolderId: number;             // Required — no "root" ambiguity
  conflictResolution: "skip" | "rename" | "overwrite";
  // For overwrite: replace existing with same unique key
  // For rename: append suffix " (copy)" or increment number
}

// Response: { jobId: string } — always async, even for 1 case
// Consistent interface regardless of count; avoids sync-vs-async divergence

// GET /api/repository/copy-move/status/[jobId]
interface CopyMoveStatusResponse {
  jobId: string;
  state: "waiting" | "active" | "completed" | "failed";
  progress: { processed: number; total: number } | null;
  result: CopyMoveResult | null;
  failedReason: string | null;
}

interface CopyMoveResult {
  copiedCount: number;
  skippedCount: number;
  errors: Array<{ caseId: number; caseName: string; error: string }>;
}
```

---

## Transaction Boundaries for Move Operations

**Do NOT use a single transaction spanning all cases in a move.**

The existing import endpoint processes cases one-by-one without a wrapping transaction, and this is deliberate — a single transaction locking hundreds of rows for 30+ seconds will cause deadlocks (the codebase already has documented deadlock issues with ZenStack v3/Kysely). The pattern from the import route is correct: per-case operations, progress streaming between each case.

**Move deletion strategy:** Soft-delete source cases AFTER all new cases are successfully created. Append source case IDs to a "completed source IDs" list in job progress data. If the job is cancelled mid-way, only successfully copied cases are deleted from source.

```
For each source case:
  1. BEGIN implicit (per ZenStack operation)
  2. Create target RepositoryCases record
  3. Create Steps (new rows pointing to new case ID)
  4. Create CaseFieldValues (new rows)
  5. Create Attachments (new rows — same S3 URLs, new DB records)
  6. Connect Tags (many-to-many connect — no new tag rows needed)
  7. Connect Issues (many-to-many connect)
  8. Create RepositoryCaseVersions:
     - COPY: version = 1, fresh snapshot
     - MOVE: copy all existing version rows from source to target case
  9. Sync to Elasticsearch
  10. If MOVE: mark source case isDeleted = true
  11. job.updateProgress()
```

Each case is effectively atomic at the application layer. Partial case failures are recorded in the job result errors array and do not block subsequent cases.

---

## BullMQ Job Structure

### Job Data Type

```typescript
// workers/copyMoveWorker.ts
export interface CopyMoveJobData extends MultiTenantJobData {
  operation: "copy" | "move";
  caseIds: number[];
  sourceProjectId: number;
  targetProjectId: number;
  targetRepositoryId: number;         // Pre-resolved from targetProjectId
  targetFolderId: number;
  conflictResolution: "skip" | "rename" | "overwrite";
  userId: string;                     // Submitting user — for audit + source delete auth
  targetTemplateId: number;           // Pre-resolved during preflight
  targetDefaultWorkflowStateId: number; // Pre-resolved during preflight
}

export interface CopyMoveJobResult {
  copiedCount: number;
  skippedCount: number;
  movedCount: number;                 // equals copiedCount for move operations
  errors: Array<{ caseId: number; caseName: string; error: string }>;
}
```

### Queue Configuration

Follow the `autoTagQueue` pattern exactly. Add to `lib/queues.ts`:

```typescript
export function getCopyMoveQueue(): Queue | null {
  if (_copyMoveQueue) return _copyMoveQueue;
  if (!valkeyConnection) { console.warn(...); return null; }

  _copyMoveQueue = new Queue(COPY_MOVE_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 1,              // Do NOT retry automatically — partial copies are dangerous
      removeOnComplete: { age: 3600 * 24 * 7, count: 500 },
      removeOnFail: { age: 3600 * 24 * 14 },
    },
  });
  return _copyMoveQueue;
}
```

**`attempts: 1` is critical.** Unlike the auto-tag job, partial retries of a copy/move are dangerous — duplicate cases could be created if the job crashes mid-execution and is retried from the start. The UI should inform users if the job failed and offer a manual retry after reviewing what was already copied.

### Worker Registration

Add `copyMoveWorker.ts` to the `workers/` directory and register it in the same process that starts `autoTagWorker`. The existing `package.workers.json` or worker startup script will need one addition.

---

## SSE Progress Streaming Pattern

**Decision: polling (not SSE streaming) — match the auto-tag pattern, not the import pattern.**

The import endpoint uses inline SSE (`text/event-stream` with `ReadableStream`). This works for that endpoint because the entire operation runs inside the request handler. For BullMQ-backed jobs, the request handler only enqueues and returns a `jobId`. Progress must come from polling the job status endpoint.

The `useAutoTagJob` hook demonstrates the correct pattern:

```typescript
// Polling loop — runs every 2 seconds while job is active
const POLL_INTERVAL_MS = 2000;

useEffect(() => {
  if (jobId && (status === "waiting" || status === "active")) {
    intervalRef.current = setInterval(async () => {
      const res = await fetch(`/api/repository/copy-move/status/${jobId}`);
      const data = await res.json();
      setProgress(data.progress);
      if (data.state === "completed" || data.state === "failed") {
        clearInterval(intervalRef.current);
        setStatus(data.state);
        setResult(data.result);
      }
    }, POLL_INTERVAL_MS);
  }
  return () => clearInterval(intervalRef.current);
}, [jobId, status]);
```

The UI should show a `<Progress>` bar derived from `{ processed, total }` — identical to how `AutoTagWizardDialog` renders the analyzing step. The existing `Progress` shadcn component is already used.

---

## ZenStack Access Control for Cross-Project Operations

### The Problem

ZenStack `enhance(db, { user })` enforces `@@allow`/`@@deny` rules scoped to the **source** project when reading, and to the **target** project when writing. A cross-project operation requires access to both simultaneously, but the `enhancedDb` instance applies the same user's permissions against whichever project is implied by each record.

In practice, the policy rules on `RepositoryCases` are:
- **Read**: user must have access to `project` (source project for source cases)
- **Create/Update/Delete**: user must have `TestCaseRepository.canAddEdit` on `project` (target project for new cases, source project for delete on move)

Because `enhancedDb` always evaluates against the authenticated user, a single `enhancedDb` instance handles cross-project correctly — the read of source cases checks source project permissions, and the create of target cases checks target project permissions. **No special multi-project client is needed.**

### Pre-Flight Access Check at API Layer

Verify permissions explicitly before enqueuing — do not rely solely on ZenStack throwing at the worker level, because a ZenStack denial in the worker produces a cryptic error rather than a useful user message.

```typescript
// In POST /api/repository/copy-move route handler:

// 1. Verify user can read source project
const sourceProject = await enhancedDb.projects.findFirst({
  where: { id: body.sourceProjectId },
});
if (!sourceProject) return 403("No read access to source project");

// 2. Verify user can write to target project
const targetProject = await enhancedDb.projects.findFirst({
  where: { id: body.targetProjectId },
  // ZenStack will return null if user lacks create/update on this project
});
// Additionally check canAddEdit on TestCaseRepository for target
if (!targetProject) return 403("No write access to target project");

// 3. For move operations: verify user can delete from source project
if (body.operation === "move") {
  // Check that the user role has canAddEdit (implies delete permission per schema rules)
  // The @@allow('create,update,delete') rule on RepositoryCases uses the same condition
}
```

### Shared Steps: Project Boundary

`SharedStepGroup` has a `projectId` — it belongs to a specific project. Steps that reference a `sharedStepGroupId` cannot point across project boundaries. **Decision per PROJECT.md scope: drop the shared step group reference on copy/move.** When creating new Steps records in the target project, set `sharedStepGroupId = null`. The step content (`step` Json, `expectedResult` Json) is still carried over — only the group reference is dropped. This is documented behavior, not a silent data loss.

### Linked Cases: Project Boundary

`RepositoryCaseLink` connects two `RepositoryCases` records. Cross-project links are out of scope (per PROJECT.md). When copying/moving, query `linksFrom` and `linksTo` on source cases and **drop** any links where the other case is in a different project. Do not create `RepositoryCaseLink` records in the target that point back to the source project. The link data is effectively orphaned and should not be migrated.

---

## Handling Related Data

### Data Carry-Over Matrix

| Related Data | Strategy | Notes |
|---|---|---|
| `Steps` | Create new rows, new `testCaseId` | Copy `step`, `expectedResult`, `order`; set `sharedStepGroupId = null` |
| `CaseFieldValues` | Create new rows, new `testCaseId` | Copy `fieldId` and `value`; fieldId points to global CaseFields — no re-mapping needed |
| `Tags` | Many-to-many connect | Tags are global (no `projectId`) — use `tags: { connect: { id: tag.id } }` |
| `Issues` | Many-to-many connect | Issues exist globally — connect by `id`; no project scoping needed |
| `Attachments` | Create new rows, same S3/MinIO URL | New `Attachment` record, same `url`, new `testCaseId` — no file re-upload |
| `RepositoryCaseVersions` | Copy = create version 1 only; Move = copy all version rows | For move: re-create all version rows with `repositoryCaseId = newCase.id` |
| `RepositoryCaseLink` | Drop cross-project links | Only preserve links where both cases end up in the same target project |
| `TestRunCases` | Do not carry over | Test runs are project-scoped; linking to a foreign test run is invalid |
| `Comments` | Do not carry over | Comments are contextual to the original case; a copy starts fresh |
| `JUnit*` | Do not carry over | JUnit results are tied to test run executions, not portable |
| `resultFieldValues` | Do not carry over | These are execution results, not case definitions |

### Template Compatibility

Before enqueueing, check whether the target project has the source template assigned:

```typescript
const targetHasTemplate = await enhancedDb.templateProjectAssignment.findFirst({
  where: { templateId: sourceCase.templateId, projectId: body.targetProjectId },
});
```

If the template is NOT assigned to the target project:
- **Admin users**: auto-assign the template to the target project (create `TemplateProjectAssignment` row), proceed silently.
- **Non-admin users**: return a compatibility warning in the pre-flight response. UI shows a warning step in the dialog; user must acknowledge before proceeding. The worker will use the target project's default template as fallback (query `TemplateProjectAssignment` for target project, pick first or designated default). `CaseFieldValues` for fields not in the fallback template are dropped.

### Workflow State Mapping

Source cases have a `stateId` pointing to a `Workflows` record. That workflow state may or may not exist in the target project.

Pre-flight check: fetch all workflow states assigned to target project via `ProjectWorkflowAssignment`. For each unique `stateId` in the source cases:
- If same-name state exists in target project: map to that state's `id`.
- If no match: use the target project's default workflow state (`isDefault: true`).

Return the mapping summary in the pre-flight response so the UI can warn the user (e.g., "3 cases with state 'In Review' will be mapped to 'New'").

---

## Data Flow

### Request Flow

```
User selects cases + clicks "Copy/Move to Project"
    ↓
CopyMoveDialog opens — user picks target project + folder + operation
    ↓
POST /api/repository/copy-move (preflight + enqueue)
  - Validate auth (getServerSession)
  - enhance(db, { user }) for access checks
  - Verify source read + target write (+source delete for move)
  - Template compat check → auto-assign or return warning
  - Workflow state mapping → return summary
  - Resolve targetRepositoryId, targetDefaultWorkflowStateId
  - getCopyMoveQueue().add("copy-move", jobData)
  - Return { jobId, templateWarnings, workflowMappings }
    ↓
Dialog transitions to progress view
    ↓
useCopyMoveJob polls GET /api/repository/copy-move/status/[jobId] every 2s
    ↓
Progress bar updates from { processed, total }
    ↓
Job completes: result.copiedCount, result.errors displayed
    ↓
On success: invalidateModelQueries for source + target projects
    ↓
Dialog shows summary with optional "View in target project" link
```

### Worker Flow

```
copyMoveWorker receives CopyMoveJobData
    ↓
getPrismaClientForJob(job.data) → tenant-scoped Prisma client
    ↓
Fetch source cases with relations:
  steps, caseFieldValues, attachments, tags, issues,
  repositoryCaseVersions (for move), linksFrom, linksTo
    ↓
For each source case:
  ├── Check unique constraint (name, className, source, projectId on target)
  │   ├── skip: job.updateProgress() + continue
  │   ├── rename: append " (copy N)" suffix, retry
  │   └── overwrite: update existing case in target
  ├── Create RepositoryCases (target projectId, repositoryId, folderId)
  ├── Create Steps (sharedStepGroupId = null)
  ├── Create CaseFieldValues (same fieldId + value)
  ├── Create Attachments (same URL)
  ├── Connect Tags (global — connect by id)
  ├── Connect Issues (global — connect by id)
  ├── Create RepositoryCaseVersions:
  │   ├── COPY: single version 1 snapshot
  │   └── MOVE: re-create all source versions with new repositoryCaseId
  ├── Sync to Elasticsearch (target case)
  ├── If MOVE: enhancedDb.repositoryCases.update({ isDeleted: true }) on source
  ├── If MOVE: Elasticsearch sync (remove source)
  └── job.updateProgress({ processed: ++count, total })
    ↓
Return CopyMoveJobResult
```

---

## New vs Modified Components

### New Files

| File | Type | Purpose |
|------|------|---------|
| `app/api/repository/copy-move/route.ts` | API Route | Preflight checks + job enqueue |
| `app/api/repository/copy-move/status/[jobId]/route.ts` | API Route | Job status polling |
| `app/api/repository/copy-move/cancel/[jobId]/route.ts` | API Route | Job cancellation |
| `workers/copyMoveWorker.ts` | BullMQ Worker | Core copy/move processor |
| `components/CopyMoveDialog.tsx` | React Component | Dialog UI |
| `components/copy-move/useCopyMoveJob.ts` | Hook | Polling + state management |

### Modified Files

| File | Change |
|------|--------|
| `lib/queueNames.ts` | Add `COPY_MOVE_QUEUE_NAME` constant |
| `lib/queues.ts` | Add `getCopyMoveQueue()` lazy initializer |
| `workers/` startup (index or package.workers.json) | Register `copyMoveWorker` |
| `app/[locale]/projects/repository/[projectId]/columns.tsx` | Add "Copy/Move to Project" to row context menu |
| `app/[locale]/projects/repository/[projectId]/Cases.tsx` or bulk toolbar | Add "Copy/Move to Project" to bulk actions |

---

## Suggested Build Order

Dependencies determine ordering. Each step must complete before the next begins.

```
1. Schema / queue plumbing (no schema.zmodel changes needed)
   - lib/queueNames.ts: add COPY_MOVE_QUEUE_NAME
   - lib/queues.ts: add getCopyMoveQueue()
   (No pnpm generate needed — no new DB models)

2. Worker (copyMoveWorker.ts)
   - Depends on: getCopyMoveQueue()
   - Core logic: case creation, related data copying, version handling
   - Can be unit-tested before API wires up
   - Register in worker startup process

3. API routes
   - POST /api/repository/copy-move — preflight + enqueue
   - GET /api/repository/copy-move/status/[jobId] — polling
   - POST /api/repository/copy-move/cancel/[jobId] — cancellation
   - Depends on: getCopyMoveQueue(), copyMoveWorker types

4. useCopyMoveJob hook
   - Depends on: API routes
   - Polling logic, localStorage persistence of jobId (for page refresh)
   - Model mirrors useAutoTagJob

5. CopyMoveDialog component
   - Depends on: useCopyMoveJob hook
   - Steps: (a) target selection, (b) compatibility warnings, (c) progress, (d) summary
   - Target project picker: useFindManyProjects filtered by user write access
   - Target folder picker: useFindManyRepositoryFolders for selected project

6. Entry points
   - Depends on: CopyMoveDialog
   - columns.tsx context menu item
   - Bulk actions toolbar item

7. E2E tests
   - Depends on: all above
   - Must build before running: pnpm build && E2E_PROD=on pnpm test:e2e
```

Steps 1-2 can be done independently. Steps 3-4 can be done in parallel with 5. Step 6 is last because it binds the UI entry points to the ready dialog.

---

## Anti-Patterns

### Anti-Pattern 1: Wrapping All Cases in One Transaction

**What:** `prisma.$transaction(async (tx) => { for (const case of cases) { ... } })` covering the full bulk copy.

**Why bad:** ZenStack v3 with Kysely dialect is documented in this codebase to cause deadlocks (error 40P01) during concurrent operations. A transaction holding locks on dozens of rows for 10-60 seconds creates a deadlock magnet. The existing import route avoids this by design.

**Instead:** Per-case operations, each implicitly transactional at the ORM level. Track progress per case. Accept that partial failures are possible and report them in the job result.

### Anti-Pattern 2: SSE Streaming from the Copy/Move Route

**What:** Returning a `ReadableStream` with `text/event-stream` directly from the API route, as the import endpoint does.

**Why bad:** The import endpoint works because it does all the work inline. A BullMQ worker runs in a separate process; the request handler cannot stream from a worker's progress. The polling pattern (submit → jobId → poll status) is already proven by auto-tag and scales to multiple concurrent users.

**Instead:** POST returns jobId, client polls GET status/[jobId] every 2 seconds (matches `useAutoTagJob` pattern exactly).

### Anti-Pattern 3: Carrying Over TestRunCases References

**What:** Re-creating `TestRunCases` rows in the target project pointing to the source project's test runs.

**Why bad:** Test runs are project-scoped. A `TestRunCases` row pointing to a test run in a different project violates the data model and would cause broken UI states in both projects.

**Instead:** Drop all `TestRunCases` associations. Copied/moved cases start with no test run membership. The existing import route already drops test runs when they don't exist in the target project.

### Anti-Pattern 4: Auto-Retrying the BullMQ Job

**What:** Setting `attempts: 3` in the queue `defaultJobOptions` so BullMQ retries failed jobs automatically.

**Why bad:** If a copy/move job creates 50 new cases and crashes on case 51, a retry restarts from case 0. The first 50 already have unique constraints violated (or are now duplicated if the conflict resolution was "overwrite"). Automatic retries produce hard-to-clean-up duplicates.

**Instead:** `attempts: 1`. Surface the error clearly in the job result. The UI should show which cases failed and allow the user to decide whether to retry the operation manually (for a subset of cases).

### Anti-Pattern 5: Re-Uploading Attachments

**What:** Downloading attachment files from S3 and re-uploading them to create new storage objects for each copied case.

**Why bad:** Expensive, slow, and unnecessary. Attachments store URLs pointing to S3 objects. The project.md notes explicitly that "Attachments store S3/MinIO URLs — new records can reference same storage objects."

**Instead:** Create new `Attachments` DB rows with the same `url` field. Multiple attachment records can reference the same underlying storage object. Deletion of one attachment record does not cascade to delete the storage object (storage cleanup is separate).

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| API route ↔ BullMQ | `getCopyMoveQueue().add(...)` + `queue.getJob(jobId)` | Matches auto-tag pattern in `lib/queues.ts` |
| Worker ↔ Prisma | `getPrismaClientForJob(job.data)` for multi-tenant | Worker must not use singleton `prisma` import |
| Worker ↔ Elasticsearch | `syncRepositoryCaseToElasticsearch(newCaseId)` | Same call as import route — both new and deleted (move) cases must be synced |
| Worker ↔ Audit log | `auditBulkCreate("RepositoryCases", count, targetProjectId, ...)` | Follow import route pattern; fire-and-forget |
| CopyMoveDialog ↔ ZenStack hooks | `useFindManyProjects` for project picker (filtered by write access) | ZenStack policy enforcement means the returned list is already access-filtered |
| CopyMoveDialog ↔ React Query | `useQueryClient().invalidateQueries(...)` on completion | Invalidate both source and target project's repository queries |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Elasticsearch | `syncRepositoryCaseToElasticsearch(caseId)` — existing util | Call for each new case created; call again (delete) for source case on move |
| S3 / MinIO | No integration needed | Attachment URLs are reused; no storage operations required |
| Valkey / Redis | Cancellation flag `copy-move:cancel:{jobId}` | Set from cancel API route; checked between cases in worker |

---

## Scalability Considerations

| Concern | At ~50 cases | At ~500 cases | Notes |
|---------|-------------|--------------|-------|
| Job duration | ~10-30s | ~2-5min | Per-case DB writes are sequential by design; acceptable for background job |
| Unique constraint checks | Cheap (indexed on projectId, name, className, source) | Same — index scales | No full-table scans |
| Elasticsearch sync | One call per case — acceptable | May want to batch or make non-blocking with `.catch()` | Import route already uses `.catch()` to swallow ES failures |
| Version history copy for move | Full version history per case — may be large for old cases | Consider capping version copy depth or making it configurable | Most cases have < 20 versions |
| Concurrent jobs | BullMQ queue serializes by default (concurrency=1) | Increase `concurrency` option if needed | Start at 1 — move operations require ordering guarantees |

---

## Sources

- Direct codebase analysis:
  - `testplanit/app/api/repository/import/route.ts` — SSE streaming, per-case creation pattern, tag/issue/attachment/step logic
  - `testplanit/workers/autoTagWorker.ts` — BullMQ worker structure, multi-tenant pattern, cancellation via Redis
  - `testplanit/app/api/auto-tag/status/[jobId]/route.ts` — job status polling endpoint pattern
  - `testplanit/app/api/auto-tag/cancel/[jobId]/route.ts` — Redis cancellation flag pattern
  - `testplanit/components/auto-tag/useAutoTagJob.ts` — polling hook pattern, localStorage persistence
  - `testplanit/lib/queues.ts` — lazy queue initialization pattern
  - `testplanit/lib/queueNames.ts` — queue name constants
  - `testplanit/lib/services/testCaseVersionService.ts` — version creation in transaction, version copying
  - `testplanit/schema.zmodel` — RepositoryCases (unique constraint, access rules), Steps (sharedStepGroupId), SharedStepGroup (projectId scoping), RepositoryCaseLink, TemplateProjectAssignment, ProjectWorkflowAssignment
- Confidence: HIGH — all patterns derived from direct reading of production code; no assumptions from training data
