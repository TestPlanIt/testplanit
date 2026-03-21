# Phase 28: Queue and Worker - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase builds the BullMQ worker that processes cross-project copy/move jobs. It handles all data carry-over logic: creating cases, steps, shared step groups, field values, tags, issues, attachments, and version history in the target project. No API endpoints or UI in this phase — the worker is testable in isolation.

</domain>

<decisions>
## Implementation Decisions

### Transaction & Error Handling
- All-or-nothing semantics — if any case fails during copy/move, rollback everything
- On failure, rollback all changes, report what failed, user must fix and retry
- For move: delete source cases only after ALL copies are confirmed successful
- Worker uses raw Prisma via `getPrismaClientForJob` — access control is gated at the API layer (Phase 29), not inside the worker

### Shared Step Group Handling
- Shared step groups are recreated in the target project as proper SharedStepGroups (NOT flattened to standalone steps)
- Steps within recreated groups are full copies — new Step rows with content from the source
- If multiple source cases reference the same SharedStepGroup, create ONE group in target; subsequent cases link to the same target group
- Preserve original name and description on recreated groups
- When a group name already exists in the target, apply user-chosen resolution: reuse existing group or create new (resolution passed in job data)

### Data Carry-Over Details
- Custom field values: resolve option IDs by name — map source option name to matching target option ID; drop value if no match found
- Cross-project case links (RepositoryCaseLink): drop silently, log dropped count in job result
- Comments: Move preserves all comments. Copy starts fresh with no comments
- Elasticsearch indexing: single bulk sync call after all cases committed, not per-case
- Tags: connect by existing tag ID (tags are global, no projectId)
- Issues: connect by existing issue ID (issues are global)
- Attachments: create new Attachment DB rows pointing to the same S3/MinIO URLs (no re-upload)

### Version History
- Move: preserve full version history — update projectId/repositoryId on all RepositoryCaseVersions rows
- Copy: start fresh at version 1 with a single initial version snapshot

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `workers/autoTagWorker.ts` — direct blueprint for BullMQ worker structure, multi-tenant support via `getPrismaClientForJob`, Redis cancellation pattern, progress reporting via `job.updateProgress()`
- `lib/queueNames.ts` — queue name constants (add `COPY_MOVE_QUEUE_NAME`)
- `lib/queues.ts` — lazy-initialized queue instances (add `getCopyMoveQueue()`)
- `lib/multiTenantPrisma.ts` — `getPrismaClientForJob()`, `MultiTenantJobData`, `validateMultiTenantJobData()`
- `lib/utils/errors.ts` — `isUniqueConstraintError()` for collision detection
- `services/repositoryCaseSync.ts` — Elasticsearch sync for repository cases

### Established Patterns
- Workers follow: validate multi-tenant data → get Prisma client → process items → report progress → return result
- Queue names are constants in `lib/queueNames.ts`, re-exported from `lib/queues.ts`
- Lazy queue initialization pattern: `let _queue: Queue | null = null; export function getQueue(): Queue | null { ... }`
- Redis cancellation: `cancelKey(jobId)` → check between items
- Job data extends `MultiTenantJobData` for tenant isolation

### Integration Points
- New file: `workers/copyMoveWorker.ts` — the BullMQ processor
- Modified: `lib/queueNames.ts` — add `COPY_MOVE_QUEUE_NAME = "copy-move"`
- Modified: `lib/queues.ts` — add `getCopyMoveQueue()` lazy initializer and re-export
- Worker entry point needs registration in the workers startup script

</code_context>

<specifics>
## Specific Ideas

- Follow autoTagWorker.ts structure verbatim for multi-tenant setup, cancellation, and progress
- The import endpoint (`app/api/repository/import/route.ts`) has case creation logic that can inform the worker's data replication approach
- Use `prisma.$transaction()` for all-or-nothing semantics per the user's explicit requirement
- BullMQ queue config: `attempts: 1` (no retry — partial retry creates duplicates), `concurrency: 1` (prevent ZenStack v3 deadlocks)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
