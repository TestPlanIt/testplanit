# Phase 2: API and Background Processing - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

API routes for requesting AI tag suggestions, background job processing via BullMQ for all batch sizes, and a synchronous bulk apply endpoint. This phase exposes Phase 1's TagAnalysisService through HTTP endpoints and handles the job lifecycle.

</domain>

<decisions>
## Implementation Decisions

### Processing Model
- Always background: all suggestion requests go through BullMQ regardless of entity count
- No inline/sync path — consistent pattern, single code path
- No API-level entity cap, but frontend should show confirmation prompt at 500+ entities
- Same UX for all batch sizes — always show progress indicator

### Suggestion Response Shape
- Confidence scores kept internal — not exposed to frontend
- Results stored ephemerally in BullMQ job result data, not persisted to DB
- Job results expire after 24 hours (TTL)
- Response grouping: Claude's Discretion

### Bulk Apply Behavior
- Apply endpoint is always synchronous (DB writes only, no background job)
- Fully transactional — all-or-nothing, rollback on any failure
- findOrCreate pattern for new tags — if tag was created between suggestion and apply, silently use the existing one
- Frontend sends only accepted suggestions (subset), not the full set with accept/reject flags

### Progress Tracking
- Frontend polls a status endpoint (no SSE) — matches existing sync worker pattern
- Per-entity count granularity: "Analyzed 23/100 entities"
- Jobs are cancellable — user can cancel from progress view, job stops after current batch completes, partial results discarded
- Auto-retry up to 3 times with backoff on transient failures (LLM API errors)

### Claude's Discretion
- Response grouping structure (grouped by entity vs flat list)
- Polling interval for status endpoint
- BullMQ job naming and queue configuration details
- Worker file structure and multi-tenant integration details
- Error message formatting for failed jobs

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/queues.ts`: BullMQ queue factory pattern — each queue has a lazy-init getter function. New auto-tag queue follows same pattern.
- `workers/syncWorker.ts`: Reference implementation for worker with progress reporting via `job.progress()` and multi-tenant support
- `lib/llm/services/auto-tag/`: Phase 1 output — TagAnalysisService, content-extractor, tag-matcher, types (EntityContent, TagSuggestion, TagAnalysisResult)
- `lib/multiTenantPrisma.ts`: getPrismaClientForJob, validateMultiTenantJobData — must be used in worker

### Established Patterns
- Queue initialization: lazy singleton with Valkey connection check (see getForecastQueue pattern)
- Worker processor: switch on job.name, get tenant-specific prisma client, call service
- API routes: Next.js route handlers in `app/api/`
- Tags model: global `Tags` table with `name` unique constraint, linked via many-to-many to RepositoryCases, Sessions, TestRuns

### Integration Points
- TagAnalysisService.analyze() — called by the new worker to process entities
- Tags model relations: `repositoryCases`, `sessions`, `testRuns` — bulk apply connects through these
- Existing tag API routes: `app/api/tags/counts/`, `app/api/tags/projects/` — new routes sit alongside

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches following existing codebase conventions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-api-and-background-processing*
*Context gathered: 2026-03-07*
