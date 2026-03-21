# Stack Research

**Domain:** Cross-project copy/move of test cases — TestPlanIt v0.17.0
**Researched:** 2026-03-20
**Confidence:** HIGH (direct codebase analysis, no external sources required)

---

## Overview

This milestone adds cross-project copy/move to an existing app with a fixed stack. The
question is not "what to build with" but "which existing pieces to wire together and how."
No new npm packages are needed. Every capability required — BullMQ async jobs, SSE
streaming progress, Prisma transactions, S3 reference copies, ZenStack access control —
is already installed and battle-tested in this codebase.

---

## Recommended Stack

### Core Technologies (all already installed)

| Technology | Version | Purpose | Why |
| --- | --- | --- | --- |
| BullMQ | `^5.71.0` | Async bulk operation queue | Existing pattern for auto-tag and testmo-import. `job.updateProgress()` + client polling via `queue.getJob(jobId)` is the established pattern. Use it for copy/move just as auto-tag uses it. |
| Prisma (`@prisma/client`) | `~6.19.2` | Bulk case creation + atomic move | `prisma.$transaction()` already used in `bulk-edit/route.ts` for multi-case mutations. Required for move (create in target + delete from source atomically). |
| ZenStack (`@zenstackhq/runtime`) | existing | Access control enforcement | `enhance(db, { user })` enforces read on source and write on target. Move requires delete permission on source — same pattern as all other mutations. Use `enhance` for the API-layer permission gate; use raw `prisma` (non-enhanced) inside the worker for performance. |
| Next.js API Routes | `^16.2.0` | Endpoint: submit job, poll status | Follow the auto-tag pattern: `POST /api/repository/copy-move/submit` returns `jobId`, `GET /api/repository/copy-move/status/[jobId]` returns `{ state, progress, result }`. |
| ReadableStream + SSE | built-in | Progress for small (<20 case) operations | For small batches, reuse the inline SSE pattern from `app/api/repository/import/route.ts`: `new ReadableStream` with `controller.enqueue(encoder.encode("data: ...\n\n"))`. No library needed. |

### Supporting Libraries (all already installed)

| Library | Version | Purpose | When to Use |
| --- | --- | --- | --- |
| `@aws-sdk/client-s3` | `^3.1012.0` | S3 attachment reference handling | Attachments store URLs already — new `Attachment` records in the target project point to the same S3 objects. No re-upload, no S3 SDK calls needed. This library is listed here only in case pre-signed URL regeneration becomes necessary for moved attachments. |
| `ioredis` / Valkey | `5.10.1` | Job cancellation flag | Auto-tag uses `redis.set(cancelKey, '1')` pattern. Copy/move can reuse this for user-initiated cancellation. Already wired via `~/lib/valkey`. |
| `zod` | `^4.3.6` | Request validation | Validate `POST /submit` body (sourceProjectId, targetProjectId, caseIds, folderId, operation). Match existing schema pattern in `bulk-edit/route.ts`. |
| `date-fns` | `^4.1.0` | Timestamp utilities | Already a dependency. Useful for audit log timestamps if needed. |
| `~/lib/services/auditLog` | existing | Audit trail | `auditBulkCreate()` used in `import/route.ts`. Copy/move should create audit entries for compliance. |
| `~/services/repositoryCaseSync` | existing | Elasticsearch index updates | `syncRepositoryCaseToElasticsearch()` must be called for each created/deleted case. Already used in import route. |

---

## Architecture Pattern: Two-Tier by Batch Size

The existing codebase uses two distinct patterns for long operations. Copy/move should use both:

### Small Batches (1–20 cases): Inline SSE

- Match `app/api/repository/import/route.ts`
- Single POST → `ReadableStream` → `text/event-stream` response
- Client reads `response.body.getReader()` and parses `data: {...}\n\n` events
- Complete in one HTTP request; no job ID needed

### Large Batches (21+ cases): BullMQ + Polling

- Match `app/api/auto-tag/submit/route.ts` + `status/[jobId]/route.ts` pattern
- POST returns `{ jobId }`; client polls `GET /status/[jobId]` every 2 seconds
- Worker calls `job.updateProgress({ processed: N, total: M })` per case
- Client reads `job.progress.processed / job.progress.total` for progress bar
- On completion, `job.returnvalue` holds `{ created: N, errors: [...] }`

### Recommendation

Use inline SSE for all operations initially (simpler). Add BullMQ path if user testing
reveals timeouts or the acceptance criteria explicitly requires async for 100+ cases. The
PROJECT.md specifies BullMQ for "bulk operations" — define threshold at 20 cases.

---

## Move Operation: Transaction Design

Move requires atomicity: create-in-target AND delete-from-source must succeed or both fail.
The correct pattern, already used in `bulk-edit/route.ts`:

```typescript
await prisma.$transaction(async (tx) => {
  // 1. Create new RepositoryCase in target project (reuse import logic)
  const newCase = await tx.repositoryCases.create({ data: { ...caseData, projectId: targetProjectId } });

  // 2. Carry over: steps, caseFieldValues, tags (connect), attachments (new records, same URL), issues
  // 3. If move: create RepositoryCaseVersion records (preserve history)
  //    If copy: create single version at version 1

  // 4. If move: delete source case (cascade deletes steps, fieldValues, etc. per schema)
  await tx.repositoryCases.delete({ where: { id: sourceCaseId } });
}, {
  timeout: 30000,  // 30s for large cases with many steps
  maxWait: 5000,
});
```

Important ZenStack caveat: Use raw `prisma` (not `enhance(db, { user })`) inside the
worker/transaction body for performance. Perform the permission gate once at the API route
entry point using `enhance`, then pass case IDs to the worker. This matches how
`autoTagWorker.ts` uses `getPrismaClientForJob()` (non-policy client) inside the processor.

---

## Unique Constraint Collision Handling

`RepositoryCases` has `@@unique([projectId, name, className, source])`. When a case
already exists in the target project with the same name+className+source combination,
PostgreSQL throws error code `23505`. Use existing helpers:

```typescript
// lib/utils/errors.ts already has:
import { isUniqueConstraintError } from "~/lib/utils/errors";

// In worker, catch per-case:
try {
  await tx.repositoryCases.create(...)
} catch (err) {
  if (isUniqueConstraintError(err)) {
    // Append to collisions list — user prompted after job completes
    collisions.push({ caseId, name: caseData.name });
    continue;
  }
  throw err; // Re-throw non-collision errors
}
```

Return `collisions` in job result. Frontend shows "N cases already exist in target project"
with options: Skip, Rename (append suffix), Overwrite.

---

## S3 Attachment Handling

Attachments are `Attachment` records with `url` pointing to S3/MinIO. For copy/move:

- Copy: Create new `Attachment` records in target project pointing to the same S3 URLs. No S3 API calls. No re-upload.
- Move: Same — create new `Attachment` records pointing to same URLs. Source `Attachment` records are deleted when source case is deleted (cascade). S3 objects are NOT deleted. This is correct because S3 objects are shared by reference.

No new S3 SDK usage required. `@aws-sdk/client-s3` does not need to be called.

---

## Access Control Gating

```typescript
// At API route entry (before enqueuing job):
const sourceEnhanced = enhance(db, { user });
const sourceCase = await sourceEnhanced.repositoryCases.findFirst({
  where: { id: caseId, projectId: sourceProjectId }
}); // ZenStack throws/returns null if user lacks read on source

// For MOVE: also verify delete permission
// ZenStack @@allow rules on RepositoryCases govern this automatically
// via the enhance() call — if user can findFirst, they can also delete

const targetEnhanced = enhance(db, { user });
const targetProject = await targetEnhanced.projects.findFirst({
  where: { id: targetProjectId }
}); // ZenStack returns null if user lacks write on target
```

Verify ZenStack access rules on `RepositoryCases` and `Projects` during implementation —
the access control rules in `schema.zmodel` determine what "read on source, write on target,
delete on source for move" means concretely.

---

## New Queue Required

Add a `COPY_MOVE_QUEUE_NAME` to `lib/queueNames.ts` and a corresponding factory function
in `lib/queues.ts`. Follow the exact pattern of `getAutoTagQueue()`.

```typescript
// lib/queueNames.ts
export const COPY_MOVE_QUEUE_NAME = "copy-move-cases";

// lib/queues.ts — add getCopyMoveQueue() following getAutoTagQueue() pattern
// workers/copyMoveWorker.ts — new worker file following autoTagWorker.ts structure
```

---

## What NOT to Use

| Avoid | Why | Use Instead |
| --- | --- | --- |
| WebSockets | No WebSocket infrastructure in this app. Overkill for one-shot progress reporting. | SSE via `ReadableStream` (inline) or BullMQ polling — both already used |
| New S3 copy API calls | Attachments reference S3 URLs — no binary data needs to move. S3 copy would double storage cost with no benefit. | Create new `Attachment` DB records pointing to same URLs |
| `QueueEvents` (BullMQ real-time events) | Requires persistent Redis subscription connection — incompatible with Next.js serverless/edge model. | `queue.getJob(jobId)` polling (2s interval) — already used for auto-tag |
| ZenStack `enhance()` inside worker processor | Policy enforcement on every row in a 500-case bulk operation causes N×policy-check overhead. | Gate permissions at API route entry; use raw `prisma` inside worker |
| Separate transaction per case in move | 500 separate transactions for 500 cases creates deadlock risk and is slow. | Single `$transaction` per batch with per-case error isolation inside |
| `createMany` for case creation | `createMany` doesn't return created IDs in PostgreSQL via Prisma v5 without `createManyAndReturn`. Need IDs for steps/fieldValues/attachments sub-creation. | `create` per case inside transaction loop, or `createManyAndReturn` if Prisma version supports it |

---

## No New npm Dependencies

This milestone requires zero new packages. All tools are already installed:

| Need | Existing Package | Version |
| --- | --- | --- |
| Async job processing | `bullmq` | `^5.71.0` |
| Job cancellation flag | `ioredis` / Valkey | `5.10.1` |
| Database transactions | `@prisma/client` | `~6.19.2` |
| Access control | `@zenstackhq/runtime` | existing |
| SSE streaming | Node.js `ReadableStream` | built-in |
| Request validation | `zod` | `^4.3.6` |
| Error helpers | `~/lib/utils/errors.ts` | internal |
| Elasticsearch sync | `~/services/repositoryCaseSync` | internal |
| Audit logging | `~/lib/services/auditLog` | internal |
| Multi-tenant jobs | `~/lib/multiTenantPrisma` | internal |

---

## Schema Changes Required

Minimal — likely zero new models. The existing `RepositoryCases`, `Steps`, `CaseFieldValues`,
`Attachments`, `Tags` (global), and `Issues` models cover all data to carry over.

Verify whether any enum additions are needed for `NotificationType` if job completion
notifications are required (out of scope per PROJECT.md, but worth checking during
implementation).

After any `schema.zmodel` changes: run `pnpm generate`.

---

## Integration Point Map

```text
User triggers copy/move (1–20 cases)
  └── POST /api/repository/copy-move/submit
        ├── enhance(db, user) — gate read(source) + write(target) permissions
        ├── Inline SSE path (≤20 cases):
        │     └── ReadableStream → per-case create+delete → progress events → complete
        └── BullMQ path (>20 cases):
              ├── getCopyMoveQueue().add(jobData) → returns jobId
              └── Response: { jobId }
                    ↓ client polls GET /api/repository/copy-move/status/[jobId]
                          └── queue.getJob(jobId) → { state, progress, result }

copyMoveWorker.ts processor:
  ├── validateMultiTenantJobData(job.data)
  ├── getPrismaClientForJob(job.data)  [non-policy client]
  ├── For each caseId:
  │     ├── prisma.$transaction(tx => {
  │     │     ├── tx.repositoryCases.create()  [new case in target]
  │     │     ├── tx.steps.createMany()        [carry over steps]
  │     │     ├── tx.caseFieldValues.createMany()
  │     │     ├── tx.attachments.createMany()  [same S3 URLs, new records]
  │     │     ├── tx.repositoryCases.update() tags/issues connect
  │     │     ├── If move: tx.repositoryCases.delete(sourceId)
  │     │     └── If copy: create version at version 1
  │     │           If move: copy all RepositoryCaseVersion records
  │     │   })
  │     ├── syncRepositoryCaseToElasticsearch(newCase)
  │     ├── If move: remove source from Elasticsearch index
  │     └── job.updateProgress({ processed: i+1, total: caseIds.length })
  └── Return { created: N, moved: N, collisions: [...], errors: [...] }
```

---

## Confidence Assessment

| Area | Confidence | Notes |
| --- | --- | --- |
| BullMQ job pattern | HIGH | autoTagWorker.ts is direct precedent; copy verbatim |
| SSE inline streaming | HIGH | import/route.ts is direct precedent |
| Prisma transaction for move | HIGH | bulk-edit/route.ts confirms `prisma.$transaction()` works |
| S3 reference copy (no API call) | HIGH | Attachment model stores URL strings; no binary data to move |
| Unique constraint collision detection | HIGH | `isUniqueConstraintError` exists in `lib/utils/errors.ts` |
| ZenStack access gating | MEDIUM | Need to verify exact `@@allow` rules on RepositoryCases for delete permission during implementation |
| Version history preservation for move | MEDIUM | `RepositoryCaseVersion` model exists; verify cascade behavior on source delete before copying versions |
| No new dependencies | HIGH | Verified against package.json |

---

## Sources

- Codebase: `testplanit/workers/autoTagWorker.ts` — BullMQ worker pattern, progress reporting, cancellation
- Codebase: `testplanit/app/api/auto-tag/status/[jobId]/route.ts` — polling status endpoint pattern
- Codebase: `testplanit/app/api/repository/import/route.ts` — inline SSE streaming pattern
- Codebase: `testplanit/app/[locale]/projects/repository/[projectId]/ImportCasesWizard.tsx` — SSE client-side consumption
- Codebase: `testplanit/app/api/projects/[projectId]/cases/bulk-edit/route.ts` — `prisma.$transaction()` for bulk mutations
- Codebase: `testplanit/lib/queues.ts` — queue factory pattern
- Codebase: `testplanit/lib/queueNames.ts` — queue name constants
- Codebase: `testplanit/schema.zmodel:1261` — `@@unique([projectId, name, className, source])` constraint
- Codebase: `testplanit/package.json` — confirmed all dependency versions
- Codebase: `testplanit/lib/multiTenantPrisma.ts` — `getPrismaClientForJob`, `validateMultiTenantJobData`
- Codebase: `testplanit/services/repositoryCaseSync.ts` — `syncRepositoryCaseToElasticsearch`

---
*Stack research for: Cross-project copy/move test cases (v0.17.0)*
*Researched: 2026-03-20*
