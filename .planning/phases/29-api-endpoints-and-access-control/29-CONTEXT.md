# Phase 29: API Endpoints and Access Control - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase builds the API layer for cross-project copy/move: a preflight endpoint for compatibility checks and collision detection, a submit endpoint that enqueues BullMQ jobs, a status polling endpoint, and a cancel endpoint. All access control enforcement happens here — the worker (Phase 28) uses raw Prisma.

</domain>

<decisions>
## Implementation Decisions

### API Endpoint Structure
- Single `POST /api/repository/copy-move` for submit (both copy and move via `operation` field)
- Separate `POST /api/repository/copy-move/preflight` for pre-flight checks (template/workflow compat + collision detection) — called before submit
- `GET /api/repository/copy-move/status/[jobId]` for polling job progress — mirrors auto-tag status pattern
- `POST /api/repository/copy-move/cancel/[jobId]` for cancellation via Redis flag — mirrors auto-tag cancel pattern

### Access Control & Pre-flight Logic
- Use ZenStack `enhance(db, { user })` to verify access — read access on source project, write access on target project; move also requires delete access on source
- Template mismatch detection: compare `TemplateProjectAssignment` records between source and target; return list of missing templates in preflight response
- Workflow state mapping: preflight returns missing states; auto-map by state name, fall back to target project's default state for unmatched states
- Admin auto-assign of templates: happens on submit (not preflight) — if user opts in and has admin/project-admin role, create `TemplateProjectAssignment` records for missing templates

### Collision Detection & Job Data
- Pre-enqueue collision check in preflight: query `RepositoryCases` in target project for matching `(projectId, name, className, source)` tuples
- Conflict resolution options: `skip` (omit conflicting cases) or `rename` (append " (copy)" suffix) — NO overwrite/destructive option
- Submit endpoint passes pre-resolved IDs to worker: `targetRepositoryId`, `targetFolderId`, `conflictResolution`, `templateAssignments`, `workflowMappings`, `sharedStepResolution`

### Claude's Discretion
- Zod schema design for request validation
- Error response format and HTTP status codes
- Internal helper function organization

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/api/auto-tag/submit/route.ts` — direct blueprint for submit endpoint: session auth, Zod validation, queue add, return jobId
- `app/api/auto-tag/status/[jobId]/route.ts` — blueprint for status polling
- `app/api/auto-tag/cancel/[jobId]/route.ts` — blueprint for cancellation via Redis flag
- `lib/queues.ts` — `getCopyMoveQueue()` already registered in Phase 28
- `workers/copyMoveWorker.ts` — `CopyMoveJobData` interface defines what the submit endpoint must provide
- `lib/multiTenantPrisma.ts` — `getCurrentTenantId()` for multi-tenant job data

### Established Patterns
- API routes use `getServerSession(authOptions)` for auth
- Request validation via Zod schemas with `.safeParse()`
- Queue availability check: `if (!queue) return 503`
- Job data includes `userId` and `tenantId` for multi-tenant isolation
- Cancellation via Redis key: `redis.set(cancelKey, '1')` with TTL

### Integration Points
- New files: `app/api/repository/copy-move/route.ts` (submit), `app/api/repository/copy-move/preflight/route.ts`, `app/api/repository/copy-move/status/[jobId]/route.ts`, `app/api/repository/copy-move/cancel/[jobId]/route.ts`
- Import from Phase 28: `CopyMoveJobData` type from `workers/copyMoveWorker.ts`
- ZenStack enhance for permission checks: `import { enhance } from '~/lib/auth/enhance'`

</code_context>

<specifics>
## Specific Ideas

- Follow auto-tag endpoint patterns verbatim for auth, validation, queue interaction
- Preflight endpoint is the key differentiator — returns structured compatibility data that the UI dialog (Phase 30) needs to render warnings and conflict lists
- The `CopyMoveJobData` interface from Phase 28 is the contract for what submit must provide

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
