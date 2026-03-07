# Phase 2: API and Background Processing - Research

**Researched:** 2026-03-07
**Domain:** BullMQ job processing, Next.js API routes, bulk database operations
**Confidence:** HIGH

## Summary

This phase exposes Phase 1's TagAnalysisService through three API endpoints: (1) submit a tag suggestion request that enqueues a BullMQ job, (2) poll job status/progress/results, and (3) synchronously apply accepted suggestions in bulk. All processing goes through BullMQ regardless of batch size (user decision: always background, no inline path).

The codebase has well-established patterns for all three concerns. Queue setup follows a lazy-singleton factory in `lib/queues.ts`, worker structure follows `workers/syncWorker.ts` with multi-tenant support via `lib/multiTenantPrisma.ts`, and job status polling follows the elasticsearch reindex pattern in `app/api/admin/elasticsearch/reindex/[jobId]/route.ts`. The bulk apply endpoint is a standard transactional DB write.

**Primary recommendation:** Follow existing codebase patterns exactly -- add a new queue getter, worker file, and three API routes. The only non-trivial design decisions are (1) LlmManager singleton behavior in multi-tenant workers and (2) structuring the job result data for frontend consumption.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Always background: all suggestion requests go through BullMQ regardless of entity count
- No inline/sync path -- consistent pattern, single code path
- No API-level entity cap, but frontend should show confirmation prompt at 500+ entities
- Same UX for all batch sizes -- always show progress indicator
- Confidence scores kept internal -- not exposed to frontend
- Results stored ephemerally in BullMQ job result data, not persisted to DB
- Job results expire after 24 hours (TTL)
- Apply endpoint is always synchronous (DB writes only, no background job)
- Fully transactional -- all-or-nothing, rollback on any failure
- findOrCreate pattern for new tags -- if tag was created between suggestion and apply, silently use the existing one
- Frontend sends only accepted suggestions (subset), not the full set with accept/reject flags
- Frontend polls a status endpoint (no SSE) -- matches existing sync worker pattern
- Per-entity count granularity: "Analyzed 23/100 entities"
- Jobs are cancellable -- user can cancel from progress view, job stops after current batch completes, partial results discarded
- Auto-retry up to 3 times with backoff on transient failures (LLM API errors)

### Claude's Discretion
- Response grouping structure (grouped by entity vs flat list)
- Polling interval for status endpoint
- BullMQ job naming and queue configuration details
- Worker file structure and multi-tenant integration details
- Error message formatting for failed jobs

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | User can request AI tag suggestions for a set of entity IDs within a project | Submit endpoint enqueues BullMQ job with entity IDs, entityType, projectId; worker calls TagAnalysisService.analyzeTags() |
| API-02 | System processes large batches as background jobs with progress tracking; user can navigate away and return | Always-background model via BullMQ; status endpoint returns job.progress (entity count granularity), job.getState(), job.returnvalue; 24hr TTL on results |
| API-03 | User can apply accepted tag suggestions (including creating new tags) in bulk | Synchronous endpoint; findOrCreate tags in transaction; connect tags to entities via many-to-many relations (Tags[] on RepositoryCases, Sessions, TestRuns) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| BullMQ | (existing) | Job queue for tag analysis | Already used for 7 other queues in project |
| Next.js API Routes | (existing) | HTTP endpoints | Project standard for all API routes |
| Prisma/ZenStack | (existing) | Database operations for bulk apply | Project ORM, handles transactions |
| IORedis | (existing) | Valkey/Redis connection for BullMQ | Already configured in `lib/valkey.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-auth | (existing) | Authentication for API routes | All API routes require session auth |
| zod | (existing) | Request body validation | Validate submit and apply request bodies |

### Alternatives Considered
None -- all technology choices are locked by existing codebase patterns.

## Architecture Patterns

### Recommended Project Structure
```
testplanit/
├── app/api/auto-tag/
│   ├── submit/route.ts          # POST: enqueue suggestion job
│   ├── status/[jobId]/route.ts  # GET: poll job status/progress/results
│   ├── apply/route.ts           # POST: bulk apply accepted suggestions
│   └── cancel/[jobId]/route.ts  # POST: cancel a running job
├── lib/
│   ├── queueNames.ts            # Add AUTO_TAG_QUEUE_NAME
│   └── queues.ts                # Add getAutoTagQueue()
└── workers/
    └── autoTagWorker.ts         # Worker processor
```

### Pattern 1: Queue Setup (Lazy Singleton)
**What:** Each queue has a constant name in `queueNames.ts` and a lazy-init getter in `queues.ts`.
**When to use:** Always -- follow the exact pattern of existing queues.
**Example:**
```typescript
// lib/queueNames.ts -- add:
export const AUTO_TAG_QUEUE_NAME = "auto-tag";

// lib/queues.ts -- add getter following getForecastQueue pattern:
let _autoTagQueue: Queue | null = null;
export function getAutoTagQueue(): Queue | null {
  if (_autoTagQueue) return _autoTagQueue;
  if (!valkeyConnection) { /* warn and return null */ }
  _autoTagQueue = new Queue(AUTO_TAG_QUEUE_NAME, {
    connection: valkeyConnection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 3600 * 24, count: 500 },  // 24hr TTL per user decision
      removeOnFail: { age: 3600 * 24 * 7 },
    },
  });
  // ... error handler, log
  return _autoTagQueue;
}
```

### Pattern 2: Worker with Multi-Tenant Support
**What:** Worker validates multi-tenant job data, gets tenant-specific prisma client, processes job.
**When to use:** All workers in this project.
**Example:**
```typescript
// workers/autoTagWorker.ts -- follows syncWorker.ts structure:
const processor = async (job: Job) => {
  validateMultiTenantJobData(job.data);
  const prisma = getPrismaClientForJob(job.data);

  // Create service instances with tenant-specific prisma
  const llmManager = LlmManager.getInstance(prisma);
  const promptResolver = new PromptResolver(prisma);
  const service = new TagAnalysisService(prisma, llmManager, promptResolver);

  // Process with progress reporting
  const result = await service.analyzeTags({ ... });
  return result;  // stored as job.returnvalue
};
```

### Pattern 3: Job Status Polling
**What:** API route fetches job by ID from queue, returns state, progress, and result.
**When to use:** Status endpoint -- follows `app/api/admin/elasticsearch/reindex/[jobId]/route.ts` pattern.
**Example:**
```typescript
const job = await autoTagQueue.getJob(jobId);
const state = await job.getState();
return {
  jobId: job.id,
  state,                    // "waiting" | "active" | "completed" | "failed"
  progress: job.progress,   // { analyzed: 23, total: 100 }
  result: state === "completed" ? job.returnvalue : null,
  failedReason: state === "failed" ? job.failedReason : null,
};
```

### Pattern 4: Bulk Apply with findOrCreate in Transaction
**What:** Synchronous endpoint that creates missing tags and connects all tags to entities in one transaction.
**When to use:** Apply endpoint.
**Example:**
```typescript
// Prisma $transaction for all-or-nothing:
await prisma.$transaction(async (tx) => {
  for (const suggestion of acceptedSuggestions) {
    // findOrCreate tag
    let tag = await tx.tags.findFirst({ where: { name: suggestion.tagName } });
    if (!tag) {
      tag = await tx.tags.create({ data: { name: suggestion.tagName } });
    }
    // Connect to entity via the appropriate relation
    await tx.repositoryCases.update({
      where: { id: suggestion.entityId },
      data: { tags: { connect: { id: tag.id } } },
    });
  }
});
```

### Pattern 5: Job Cancellation
**What:** Mark job as cancelled; worker checks cancellation state between batches.
**When to use:** Cancel endpoint.
**Example:**
```typescript
// Cancel endpoint:
const job = await autoTagQueue.getJob(jobId);
await job.moveToFailed(new Error("Cancelled by user"), job.token);

// Worker checks between batches:
const jobState = await job.getState();
if (jobState === "failed") break; // stop processing
```

### Recommendation: Response Grouping (Claude's Discretion)
**Decision:** Group suggestions by entity in the job result. This is the natural structure for the frontend review UI (Phase 3 will show per-entity tag suggestions).

```typescript
// Job return value shape:
interface AutoTagJobResult {
  suggestions: Array<{
    entityId: number;
    entityType: EntityType;
    tags: Array<{
      tagName: string;
      isExisting: boolean;
      matchedExistingTag?: string;
    }>;
  }>;
  stats: {
    entityCount: number;
    totalSuggestions: number;
    existingTagCount: number;
    newTagCount: number;
    totalTokensUsed: number;
    batchCount: number;
  };
}
```

### Recommendation: Polling Interval (Claude's Discretion)
**Decision:** 2-second polling interval. LLM calls take seconds per batch, so sub-second polling is wasteful. The frontend should use 2s intervals, with the status endpoint returning a `retryAfter` hint if desired.

### Recommendation: Queue/Job Naming (Claude's Discretion)
**Decision:**
- Queue name: `auto-tag`
- Job name: `analyze-tags` (for the single job type in this queue)
- Worker file: `workers/autoTagWorker.ts`

### Recommendation: Error Message Formatting (Claude's Discretion)
**Decision:** Return structured error info: `{ error: string, retriesRemaining: number, lastAttemptAt: string }`. On final failure, include the root cause message (sanitized of any sensitive LLM API details).

### Anti-Patterns to Avoid
- **Creating a new Prisma client per job:** Use `getPrismaClientForJob()` which caches clients per tenant.
- **Storing results in the database:** User decision is ephemeral BullMQ storage with 24hr TTL.
- **Using SSE for progress:** User decision is polling. Do not add SSE/WebSocket.
- **Synchronous processing for small batches:** User decision is always-background. No inline path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job queue | Custom Redis pub/sub | BullMQ via existing `lib/queues.ts` pattern | Retry, backoff, progress, TTL all built-in |
| Multi-tenant DB routing | Custom connection management | `getPrismaClientForJob()` from `lib/multiTenantPrisma.ts` | Handles caching, credential rotation, validation |
| Tag deduplication | Custom name-matching logic | `matchTagSuggestions()` from Phase 1 (already handles fuzzy match) | Levenshtein distance logic is subtle |
| Auth in API routes | Custom token checking | `getServerSession(authOptions)` pattern from existing routes | Project standard, handles all auth methods |

## Common Pitfalls

### Pitfall 1: LlmManager Singleton with Multi-Tenant Prisma
**What goes wrong:** `LlmManager.getInstance(prisma)` caches the first prisma client. In multi-tenant mode, subsequent calls with different tenant prisma clients return the stale singleton.
**Why it happens:** The singleton pattern was designed for web app context (single tenant per instance), not shared workers.
**How to avoid:** For the worker, either (a) create a new LlmManager directly via the private constructor (requires making it public or adding a factory method), or (b) accept that in single-tenant mode the singleton is fine, and for multi-tenant mode, add a `LlmManager.createForTenant(prisma)` static method that bypasses the singleton cache. The simplest approach: use `new LlmManager(prisma)` directly -- the constructor takes PrismaClient, and the singleton pattern is just a convenience, not a requirement. Note: constructor is private. Either make it package-accessible or add a factory method.
**Warning signs:** LLM API calls succeed but use credentials from wrong tenant.

### Pitfall 2: ZenStack Alias Length on Tag Relations
**What goes wrong:** Deeply nested includes on tag-related queries exceed PostgreSQL's 63-byte alias limit.
**Why it happens:** ZenStack v3 generates long aliases like `RepositoryCases$tags$t$orderBy$0`.
**How to avoid:** Keep tag relation queries shallow (max 2 levels). The existing `TagAnalysisService.fetchEntities()` already follows this pattern. For bulk apply, use direct `connect` operations rather than nested includes.
**Warning signs:** PostgreSQL errors about identifier length.

### Pitfall 3: Tag Unique Constraint Race Condition
**What goes wrong:** Two concurrent apply requests try to create the same new tag name simultaneously, causing a unique constraint violation on `Tags.name`.
**Why it happens:** `Tags` model has `@unique` on `name`. findOrCreate is not atomic.
**How to avoid:** Use upsert or catch unique constraint errors and retry with a find. The `isUniqueConstraintError()` utility in `lib/utils/errors.ts` can detect this. Inside the transaction, use `upsert` instead of find+create.
**Warning signs:** 500 errors on apply endpoint with "duplicate key" messages.

### Pitfall 4: Job Token Required for moveToFailed
**What goes wrong:** Cancellation via `job.moveToFailed()` requires the job's lock token, which is only available inside the worker processor.
**Why it happens:** BullMQ uses lock tokens to prevent concurrent processing.
**How to avoid:** For cancellation, use a different approach: store a cancellation flag (e.g., in job data via `job.updateData()` or in a Redis key), and have the worker check it between batches. Alternatively, use BullMQ's built-in `job.moveToFailed()` from outside the worker by using the Queue's `obliterate` or simpler: just remove the job if waiting, or set a Redis flag if active.
**Warning signs:** "Missing lock token" errors when trying to cancel.

### Pitfall 5: Progress Reporting Granularity
**What goes wrong:** TagAnalysisService processes entities in LLM batches (grouped by token budget), not one-by-one. Progress can only be updated between batches, not per-entity.
**Why it happens:** The service sends multiple entities per LLM call for efficiency.
**How to avoid:** Track progress at the batch level. After each batch completes, calculate cumulative entities processed. Report `{ analyzed: cumulativeEntities, total: totalEntities }`. The granularity will be batch-sized steps (e.g., jumps of 5-20 entities at a time), not smooth per-entity.
**Warning signs:** Progress appears to "jump" rather than increment smoothly.

### Pitfall 6: Build Script Must Include New Worker
**What goes wrong:** New worker file isn't compiled for production because it's not listed in `scripts/build-workers.js`.
**Why it happens:** Worker entry points are explicitly listed, not auto-discovered.
**How to avoid:** Add `workers/autoTagWorker.ts` to the `entryPoints` array in `scripts/build-workers.js`. Also add the `worker:auto-tag` script to `package.json` and include it in the `workers` concurrently command.
**Warning signs:** Worker works in dev (tsx) but fails in production.

## Code Examples

### Submit Endpoint
```typescript
// app/api/auto-tag/submit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { getAutoTagQueue } from "~/lib/queues";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { z } from "zod";

const submitSchema = z.object({
  entityIds: z.array(z.number()).min(1),
  entityType: z.enum(["repositoryCase", "testRun", "session"]),
  projectId: z.number(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const queue = getAutoTagQueue();
  if (!queue) {
    return NextResponse.json(
      { error: "Background job queue is not available" },
      { status: 503 }
    );
  }

  const job = await queue.add("analyze-tags", {
    ...parsed.data,
    userId: session.user.id,
    tenantId: getCurrentTenantId(),
  });

  return NextResponse.json({ jobId: job.id });
}
```

### Worker Progress Reporting
```typescript
// In the worker, wrap TagAnalysisService to report progress between batches.
// TagAnalysisService.analyzeTags() processes batches sequentially internally.
// To get per-batch progress, we need to either:
// (a) Add a progress callback to analyzeTags(), or
// (b) Modify analyzeTags() to yield between batches.
//
// Recommended: Add an optional onBatchComplete callback parameter:
interface AnalyzeTagsParams {
  entityIds: number[];
  entityType: EntityType;
  projectId: number;
  userId: string;
  onBatchComplete?: (processed: number, total: number) => Promise<void>;
}

// Worker uses it:
const result = await service.analyzeTags({
  ...jobData,
  onBatchComplete: async (processed, total) => {
    await job.updateProgress({ analyzed: processed, total });
  },
});
```

### Bulk Apply with Upsert
```typescript
// app/api/auto-tag/apply/route.ts (inside transaction)
const applySchema = z.object({
  suggestions: z.array(z.object({
    entityId: z.number(),
    entityType: z.enum(["repositoryCase", "testRun", "session"]),
    tagName: z.string().min(1),
  })),
});

// Inside handler:
await prisma.$transaction(async (tx: any) => {
  // Deduplicate tag names first
  const uniqueTagNames = [...new Set(suggestions.map(s => s.tagName))];

  // findOrCreate all tags upfront
  const tagMap = new Map<string, number>();
  for (const name of uniqueTagNames) {
    const tag = await tx.tags.upsert({
      where: { name },
      create: { name },
      update: {},  // no-op if exists
    });
    tagMap.set(name, tag.id);
  }

  // Connect tags to entities
  for (const suggestion of suggestions) {
    const tagId = tagMap.get(suggestion.tagName)!;
    const connectData = { tags: { connect: { id: tagId } } };

    switch (suggestion.entityType) {
      case "repositoryCase":
        await tx.repositoryCases.update({
          where: { id: suggestion.entityId },
          data: connectData,
        });
        break;
      case "testRun":
        await tx.testRuns.update({
          where: { id: suggestion.entityId },
          data: connectData,
        });
        break;
      case "session":
        await tx.sessions.update({
          where: { id: suggestion.entityId },
          data: connectData,
        });
        break;
    }
  }
});
```

### Cancellation via Redis Flag
```typescript
// Cancel endpoint sets a Redis key:
const cancelKey = `auto-tag:cancel:${jobId}`;
const connection = await autoTagQueue.client;
await connection.set(cancelKey, "1", "EX", 3600); // 1hr TTL

// Worker checks between batches:
const cancelKey = `auto-tag:cancel:${job.id}`;
const connection = await autoTagQueue.client;
const cancelled = await connection.get(cancelKey);
if (cancelled) {
  await connection.del(cancelKey);
  throw new Error("Job cancelled by user");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bull (v3) | BullMQ (v4+) | 2022 | Project already uses BullMQ |
| SSE for progress | Polling | Project decision | Simpler, matches existing sync worker pattern |

## Open Questions

1. **LlmManager singleton in multi-tenant workers**
   - What we know: Constructor is private, getInstance() caches first prisma client
   - What's unclear: Whether we should modify LlmManager to support per-tenant instances or work around it
   - Recommendation: Add a `static createForWorker(prisma: PrismaClient): LlmManager` factory method that always creates a fresh instance. This is the minimal change needed. Alternatively, for single-tenant deployments (likely the common case), the singleton works fine as-is.

2. **TagAnalysisService needs progress callback for per-batch reporting**
   - What we know: Current `analyzeTags()` processes all batches internally, returning only the final result
   - What's unclear: Whether to modify TagAnalysisService or wrap it
   - Recommendation: Add optional `onBatchComplete` callback to `AnalyzeTagsParams`. This is a backward-compatible change to Phase 1 code.

3. **Prisma $transaction with ZenStack v3**
   - What we know: ZenStack v3 uses Kysely instead of Prisma under the hood; `$transaction` behavior may differ
   - What's unclear: Whether interactive transactions work correctly with ZenStack's Kysely backend
   - Recommendation: Test early. If `$transaction` doesn't work, fall back to sequential operations with manual rollback logic, or use raw SQL transactions.

## Sources

### Primary (HIGH confidence)
- Codebase: `lib/queues.ts` - Queue factory pattern with 7 existing queues
- Codebase: `workers/syncWorker.ts` - Worker structure with multi-tenant support
- Codebase: `app/api/admin/elasticsearch/reindex/[jobId]/route.ts` - Job status polling pattern
- Codebase: `lib/multiTenantPrisma.ts` - Multi-tenant prisma client management
- Codebase: `lib/llm/services/auto-tag/tag-analysis.service.ts` - Phase 1 TagAnalysisService
- Codebase: `schema.zmodel` lines 955-967 - Tags model with unique name and many-to-many relations
- Codebase: `scripts/build-workers.js` - Worker build configuration
- Codebase: `lib/llm/services/llm-manager.service.ts` - LlmManager singleton pattern
- Codebase: `workers/elasticsearchReindexWorker.ts` - Progress reporting via `job.updateProgress()`

### Secondary (MEDIUM confidence)
- BullMQ documentation for job cancellation patterns (based on training data knowledge of BullMQ API)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use in the project
- Architecture: HIGH - patterns directly copied from existing codebase implementations
- Pitfalls: HIGH - identified from actual code inspection (LlmManager singleton, ZenStack alias issues, build script)

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- patterns are project-internal, not dependent on external library changes)
