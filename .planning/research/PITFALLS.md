# Pitfalls Research

**Domain:** Cross-project copy/move of test cases — adding this feature to an existing multi-tenant test management system (TestPlanIt v0.17.0)
**Researched:** 2026-03-20
**Confidence:** HIGH — based on direct codebase analysis of schema.zmodel, import route, version service, ZenStack v3 known issues from MEMORY.md, and established patterns from the existing BullMQ/SSE infrastructure

---

## Critical Pitfalls

### Pitfall 1: Partial Failure Leaves Orphaned Records During Move

**What goes wrong:**
A move operation creates new RepositoryCases in the target project (with steps, field values, attachments, version snapshots) and then deletes the originals. If the worker crashes or a downstream step fails — e.g., the Elasticsearch sync throws or the delete call encounters a deadlock — you end up with cases duplicated across both projects, or with cases deleted from the source but incompletely created in the target. Recovery is manual and expensive.

**Why it happens:**
The existing import route creates cases sequentially in a loop without a wrapping transaction. Each case is a multi-step write: create RepositoryCases, create CaseFieldValues, create Steps, create version snapshot, connect tags, connect issues, create Attachments. A crash at any step leaves partial data. For moves specifically, the delete-source step runs after all creates succeed, so any per-case failure during creation leaves the source intact — but if half the batch has been deleted before the failure, you have split state.

**How to avoid:**
Process each individual case (create + verify + delete-source) as a single PostgreSQL transaction for move operations. Use `prisma.$transaction([...])` or the interactive transaction API `prisma.$transaction(async (tx) => { ... })`. Never delete the source row until the target row and all its children are confirmed committed. For the batch, track committed IDs and only delete source rows that have confirmed target counterparts. Log the ID mapping (sourceId → targetId) to the job data in Redis so partial recovery is possible.

**Warning signs:**

- Cases appear in both source and target after a failed bulk move
- Cases disappear from source but are absent from target search results
- RepositoryCaseVersions rows exist with no matching RepositoryCases parent (orphaned by cascade failures)

**Phase to address:**
Phase implementing the BullMQ worker — the transaction boundary must be designed before writing the case creation loop.

---

### Pitfall 2: ZenStack v3 Deadlocks on Concurrent Bulk Move Jobs

**What goes wrong:**
Two concurrent bulk move jobs operating on cases in the same source project (or involving the same users triggering auth fetches) can deadlock at the PostgreSQL level. ZenStack v3's Kysely-based policy plugin issues per-row auth checks that generate sub-queries touching the Users and role-permission tables. Under concurrent writes, row-level locking conflicts between these auth sub-queries and the actual case writes produce `40P01` deadlock errors. The BullMQ worker crashes the job.

**Why it happens:**
Known issue documented in MEMORY.md: the user auth fetch in the ZenStack handler is vulnerable to deadlocks during concurrent operations. ZenStack v3 generates more aggressive locking patterns than Prisma v2. When two jobs simultaneously touch RepositoryCases with overlapping access policy evaluations (same project, same auth user), PostgreSQL detects a lock cycle and aborts one transaction.

**How to avoid:**

- Use `concurrency: 1` for copy/move jobs at the queue level, or namespace them by projectId so two jobs touching the same source project cannot run simultaneously.
- Add retry logic with exponential backoff specifically for `40P01` errors in the worker processor, matching the pattern already used for the auto-tag worker.
- Fetch the full user object once at the start of the job and pass it through; avoid repeated `prisma.user.findUnique` calls inside the per-case loop which re-evaluate access policies on each call.
- Consider bypassing ZenStack's `enhance()` for the bulk worker and doing manual permission checks up front, then using the base `prisma` client for writes — this is the pattern used in other workers.

**Warning signs:**

- `error: deadlock detected` in BullMQ job failure logs
- Jobs intermittently fail and succeed on retry without code changes
- Failures correlate with concurrent operations on the same project

**Phase to address:**
Phase implementing the BullMQ worker — concurrency limits and deadlock retry must be built in before any production testing.

---

### Pitfall 3: Access Control Bypass via Worker Context Loss

**What goes wrong:**
The BullMQ worker runs in a separate Node.js process without an HTTP request context. If the worker calls `enhance(db, { user: ... })` but the user fetch fails (deadlock, network hiccup), `user` becomes `undefined`. ZenStack's `@@deny('all', auth() == null)` policy then denies all writes silently — the worker appears to succeed but nothing is created. Worse, if the worker uses the base `prisma` client directly without intending to bypass policies, cross-tenant writes become possible if tenant isolation is not enforced separately.

**Why it happens:**
From MEMORY.md: if the user fetch fails, `auth()` becomes null, triggering the deny-all policy. The worker silently creates zero records. Additionally, the copy/move feature requires checking read permission on the source project AND write permission on the target project — these are two separate policy evaluations that must both pass. Checking only one (common mistake) allows a user with write-only access to a project to read cases they shouldn't see.

**How to avoid:**

- Always check that the user fetch succeeded before calling `enhance()`. If null, fail the job with a clear error — do not proceed silently.
- Explicitly verify both source read permission and target write permission before starting the batch. For move, also verify source delete permission.
- In multi-tenant mode, use `getPrismaClientForJob(job.data)` to get the tenant-scoped client, then apply `enhance()` on top of it — never share a client across tenant boundaries.
- Write an integration test: user with read-only on source + write on target should successfully copy but fail to move.

**Warning signs:**

- Zero cases created in target, no errors reported
- `importedCount` returns 0 with no error messages
- ZenStack policy denial appears as empty result sets, not thrown errors

**Phase to address:**
Phase implementing the API endpoint and worker — permission checks must be explicit, with tests covering the dual-project permission scenario.

---

### Pitfall 4: Unique Constraint Collision Silently Drops Cases

**What goes wrong:**
`RepositoryCases` has `@@unique([projectId, name, className, source])`. When copying cases to a target project that already has cases with the same name/className/source combination, the create call throws a unique constraint violation. If the error is caught and swallowed (as it is in the existing import route's attachment section — `catch { // Continue }`), the case is silently skipped. The user receives a progress count showing N cases processed but only M actually landed in the target.

**Why it happens:**
The existing import route uses individual `try/catch` blocks around each case with error accumulation — reasonable for CSV import where row-level failures are expected. For copy/move, this pattern means name collisions are treated the same as hard errors: silently skipped with an error entry. The user never sees which cases were skipped unless the error list is surfaced prominently.

**Additionally:** ZenStack v3 error format is different from Prisma v2. Unique constraint errors do NOT surface as `err.code === "P2002"`. They arrive as `{ error: { message: "...duplicate key value violates unique constraint..." } }` with status 500. Checking `.code` will always miss them. Use string matching on the message for "duplicate key" or "unique constraint" — see MEMORY.md for the full error format.

**How to avoid:**

- Pre-check for name collisions before starting the batch: query the target project for any `name + className + source` that matches incoming cases. Surface the collision list to the user before starting the operation (the issue spec calls for "user prompts" on collision).
- If doing upsert on collision (rename the copy), apply a deterministic rename strategy: append `(copy)`, then `(copy 2)`, etc. — not a random suffix, since the user needs to find the case.
- Never silently skip. Surface every collision in the SSE progress events so the UI can display a final summary report.
- Use the error detection patterns from MEMORY.md: check `err.info?.message` for "duplicate key" text, not `err.code`.

**Warning signs:**

- `importedCount` is less than the number of selected cases with no error shown to the user
- Cases exist in source but not in target without explanation
- Unit tests pass but end-to-end test shows missing cases

**Phase to address:**
Phase implementing the UI dialog (pre-flight collision check) and the worker (error surfacing). Both must address this together.

---

### Pitfall 5: Template Field Mapping Creates Invalid CaseFieldValues in Target

**What goes wrong:**
The source case has CaseFieldValues referencing CaseFields from a template assigned to the source project. The target project uses a different template, or the same template but with different field options. Dropdown/Multi-select field values store the `fieldOption.id` (an integer foreign key into CaseFieldAssignment). When the field value is written to the target case under a different template, those IDs either point to wrong options, point to options not in the target template's fields, or fail with a foreign key violation.

**Why it happens:**
The existing import route resolves dropdown values by option name at import time. The copy route will not have a CSV string to re-resolve — it has the raw stored value (an integer option ID). If the implementation naively copies `CaseFieldValues` with the original `value` intact, option IDs from the source template become meaningless in the target context. This is not obvious during development if source and target happen to share the same template.

**How to avoid:**

- Before copying field values, fetch both the source template's field definitions and the target template's field definitions.
- For each field value: if the target template contains the same field (by `systemName`), and the field is a Dropdown/Multi-select, look up the option name from the source field options, then find the matching option ID in the target template's field options. If no match, either omit the value (with a warning) or fall back to the field's default.
- If the target template does not contain a field at all, skip that field value — do not write it.
- Test with source and target using templates with overlapping but not identical field sets.

**Warning signs:**

- Field values appear blank in the target despite being set in the source
- Foreign key errors on CaseFieldValues creation
- Dropdown fields show wrong selected options in the target

**Phase to address:**
Phase implementing the case creation logic (field value mapping) — must be addressed before implementing any end-to-end tests.

---

### Pitfall 6: Shared Step References Become Dangling After Copy

**What goes wrong:**
Steps in `RepositoryCases` can have `sharedStepGroupId` referencing a `SharedStepGroup`. SharedStepGroups are project-scoped (`projectId` is a non-null column). When a case is copied to a different project, its steps still reference the source project's SharedStepGroups. The new step rows in the target project point to a SharedStepGroup in the source project. This is a cross-project reference that violates logical isolation, and the target step will silently display stale content from the source project's shared step definition.

**Why it happens:**
The existing import route creates steps with only `step`, `expectedResult`, and `order` — it ignores `sharedStepGroupId`. That is correct for CSV import since there is no shared step concept in CSV data. For copy/move, the naive approach of directly replicating Step rows would carry over the `sharedStepGroupId`. Even the "ignore it" approach (set to null) is a silent content change that loses the shared step association.

**How to avoid:**

- When copying steps, always set `sharedStepGroupId = null` in the target. The step content (JSON) is copied from the source step or from `SharedStepItem.step` if the source step was a shared step placeholder.
- For the step content, if `sharedStepGroupId` is set on the source step, fetch the `SharedStepGroup.items` and embed the actual step content inline in the copy (denormalize it). The copy becomes a standalone step, not a shared step reference.
- Document this behavior: copying a case that uses shared steps results in the steps being "flattened" into standalone steps in the target.

**Warning signs:**

- Steps in the target project display content from a different project's shared step library
- Steps appear blank in the target (SharedStepGroup not visible due to policy)
- `sharedStepGroupId` foreign keys point to rows in a different project's scope

**Phase to address:**
Phase implementing step copying logic — must handle shared step flattening explicitly.

---

### Pitfall 7: Version History Snapshots Reference Source Project IDs for Move Operations

**What goes wrong:**
`RepositoryCaseVersions` stores denormalized project data: `staticProjectId`, `staticProjectName`, `projectId`, `repositoryId`, `folderId`, `folderName`. For move operations (where history is preserved), the existing version records still reference the source project's IDs. After the move, those version records have `projectId` pointing to the source project — a project the case no longer belongs to. Queries filtering versions by `projectId` will miss moved cases' history, and ZenStack's access policies on `RepositoryCaseVersions` inherit from `project`, so source-project-scoped users could still read those version records.

**Why it happens:**
The decision "move preserves version history" implies the existing `RepositoryCaseVersions` rows are migrated with the case. The schema has both `staticProjectId` (a snapshot-at-time-of-write integer) and `projectId` (a live FK). The `staticProjectId` and `staticProjectName` should remain as-is (they record historical truth). But `projectId` (the live FK) must be updated to the target project, or the access policy on version rows will use the source project's rules even after the case has moved.

**How to avoid:**

- For move: update `RepositoryCaseVersions.projectId = targetProjectId` and `RepositoryCaseVersions.repositoryId = targetRepositoryId` for all versions of the moved case. Leave `staticProjectId` and `staticProjectName` unchanged (they are historical).
- Also update `folderId` and `folderName` on version rows only for the new version created at move time — not historical versions (they should reflect where the case was, not where it ended up).
- For copy: create a single new version record at version 1 with all target project IDs. No historical versions are copied.

**Warning signs:**

- Moved cases' version history is inaccessible to target-project users
- Source-project users can still see version history of moved cases
- `RepositoryCaseVersions` rows with `projectId` != `RepositoryCases.projectId` for the same `repositoryCaseId`

**Phase to address:**
Phase implementing the move logic — must include a version migration step as part of the atomic transaction.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
| -------- | ----------------- | -------------- | --------------- |
| Reuse import route directly for copy/move without refactoring | Faster initial ship | Import route is SSE-in-process (ReadableStream), not BullMQ-based; can't report progress to a disconnected client if the HTTP connection drops mid-bulk-operation | Never for bulk ops — wrap the core logic in a shared service, have the BullMQ worker and the import route both call it |
| Skip pre-flight collision check, let DB throw and catch | Simpler UI flow | Silent drops with no user feedback; ZenStack v3 error format makes unique violations hard to detect reliably | Never — collision check must be pre-flight |
| Copy field values by raw integer ID without re-resolving option names | Fast | Corrupted Dropdown/Multi-select values in target if templates differ even slightly | Only acceptable if source and target are guaranteed to use identical templates (not a safe assumption) |
| Set `sharedStepGroupId = null` without copying step content | Avoids cross-project FK | Steps appear blank if the source step had no inline content (was pure shared step reference) | Never — always resolve step content before nulling the FK |
| Use `enhance(db, { user })` inside the worker without deadlock retry | Simpler code | Intermittent deadlocks cause job failures under concurrent load | Never — retry on 40P01 is mandatory given known ZenStack v3 behavior |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
| ----------- | -------------- | ---------------- |
| ZenStack v3 unique constraint errors | Check `err.code === "P2002"` | Check `err.info?.message` for "duplicate key" or "unique constraint" string — v3 wraps errors differently (see MEMORY.md) |
| ZenStack v3 access policy on RepositoryCaseVersions | Assume policy inherits from `repositoryCase.project` | Policy checks `project` relation directly on the version row — update `projectId` on moved versions or policy evaluates against the wrong project |
| Elasticsearch sync | Fire-and-forget sync after each case in the loop | Sync failures abort the loop if not caught; wrap each sync in `.catch()` as the import route already does; also: newly created cases in target are not searchable until sync completes |
| BullMQ SSE progress | Use ReadableStream (HTTP SSE) from within the worker | Workers run in a separate process; SSE must go through Redis pub/sub or job progress events (`job.updateProgress()`), not a direct HTTP stream |
| S3/MinIO attachments | Re-upload files when copying | Attachment records store the S3 URL; new Attachment DB records can reference the same URL without re-uploading. Only create new DB rows, do not call S3 again |
| Issues (linked external issues) | Copy issue FK links directly | Issues are global (no projectId) — issue links can be reconnected by ID directly; but verify the issue is not soft-deleted before reconnecting |
| Tags | Copy tag FK links directly | Tags are global (no projectId) — tag reconnection by ID is correct; handle soft-deleted tags the same way the import route does (restore or skip) |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
| ---- | -------- | ---------- | -------------- |
| N+1 per-case DB round-trips in the worker loop | 100-case move takes 10+ seconds; DB connection pool exhaustion | Batch-fetch all source cases with their relations in a single query at job start; then process in memory | >50 cases |
| Per-case Elasticsearch sync inside the bulk loop | Elasticsearch timeouts block case creation loop progress | Collect all new case IDs after bulk creation; fire a single batch reindex job via `elasticsearchReindexQueue` after the loop completes | >20 cases |
| Fetching `folderMaxOrders` inside the loop (as the import route does) | Race condition: two cases in the same folder get the same `order` value | Pre-fetch max orders for all target folders before the loop; increment in memory, not by re-querying | >2 concurrent cases per folder |
| ZenStack v3 auto-added `orderBy` on nested includes causing 63-char alias violations | "missing FROM-clause entry" PostgreSQL error during case fetch | Limit nesting depth when fetching source cases; fetch deeply nested relations (fieldOptions, stepResults) in separate queries (see MEMORY.md pattern) | Any query with 4+ levels of nesting |
| Holding a PostgreSQL transaction open during SSE progress events | Transaction timeout; long-held locks block other writers on the same rows | Do not use a single transaction that spans all N cases; use per-case transactions or commit after each case group | >10 cases or >5 seconds of processing |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
| ------- | ---- | ---------- |
| Only checking write permission on target, not read permission on source | User can copy cases from a project they cannot read by guessing case IDs | Verify `read` permission on the source project using `enhancedDb.projects.findFirst()` (which applies ZenStack policies) before fetching case data |
| Only checking read+write, not delete permission for move operations | User moves (deletes from source) cases they are not allowed to delete | Separately verify `canAddEdit` or delete permission on the source project for move operations — the import route only checks write on target |
| Passing user-supplied target `projectId` without validating it belongs to the same tenant | Cross-tenant case leakage in multi-tenant deployments | In multi-tenant mode, confirm both source and target `projectId` are in the same tenant before any operation |
| Using base `prisma` client (bypassing ZenStack) without explicit permission re-check | Policy bypass: any authenticated user can read/write any case | If bypassing `enhance()` for performance, perform explicit permission queries first and fail fast if unauthorized |
| Not sanitizing case `name` before unique constraint check | SQL injection or constraint check bypass | Use ZenStack/Prisma parameterized queries (already safe) — but ensure the pre-flight collision query uses the exact same normalization as the DB constraint |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
| ------- | ----------- | --------------- |
| Starting the bulk operation before resolving collisions | User waits through a 200-case job only to see half failed due to name conflicts | Show pre-flight collision report in the dialog before confirming; let user choose rename strategy per collision |
| Only showing final pass/fail count, not per-case results | User cannot tell which specific cases failed or were renamed | SSE progress events should include per-case outcome (success, renamed-as, skipped-why); final summary lists all non-trivial outcomes |
| Not indicating that shared steps will be flattened | User copies a case expecting shared step links to transfer; discovers the step content is standalone in the target | Show a warning in the dialog: "Cases using shared steps will have steps converted to standalone steps in the target project" |
| Showing the same project in the target picker | User accidentally moves a case to its own project | Filter source project out of the target project picker; validate server-side that source != target |
| No undo for move operations | Accidental move of 50 cases is irreversible | Not required for v0.17.0, but note that move is destructive; show explicit confirmation with case count before starting |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Version history on move:** Verify `RepositoryCaseVersions.projectId` rows are updated to target project, not just the `RepositoryCases` row — run a query after move to confirm no version rows still reference the source projectId for the moved case.
- [ ] **Elasticsearch sync:** Verify moved/copied cases appear in target project search immediately after operation; also verify moved cases no longer appear in source project search.
- [ ] **Attachment records:** Verify new Attachment rows were created with `testCaseId` pointing to the new target case ID, not the source case ID — a common copy-paste error when reusing the source case object.
- [ ] **Shared step flattening:** Verify that a case with `sharedStepGroupId` on its steps displays correct step content in the target (not blank, not from source project's shared steps).
- [ ] **Permission symmetry:** Verify a user with read-only source access can copy but cannot move; verify a user with no source access cannot copy even if they have write on the target.
- [ ] **Collision surfacing:** Verify that when a name collision occurs, the error is visible in the UI — not silently counted against the "failed" total with no details.
- [ ] **Folder creation in target:** Verify that if the user selects a non-existent folder path in the target, it is created; verify that folder creation respects the target project's `repositoryId`, not the source project's.
- [ ] **CaseFieldVersionValues:** Verify that version snapshot rows (`CaseFieldVersionValues` linked to `RepositoryCaseVersions`) are not orphaned after the move — they cascade-delete from versions, but confirm the cascade is not accidentally triggered during the move transaction.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
| ------- | ------------- | -------------- |
| Partial move leaves cases in both projects | HIGH | Query for cases with same name/className/source in both source and target; manually inspect which are complete in target; delete duplicates; re-run move for incomplete ones |
| Version rows still reference source project after move | MEDIUM | Run a migration script: `UPDATE RepositoryCaseVersions SET projectId = $targetId WHERE repositoryCaseId IN (...)` |
| Elasticsearch out of sync after failed sync step | LOW | Trigger batch reindex for affected projectId via existing `elasticsearchReindexWorker` |
| Attachment DB rows missing (attachments not copied) | MEDIUM | Query source case's original Attachments; create new Attachment rows for target case pointing to same S3 URLs |
| Field values missing due to template mismatch | MEDIUM | Re-run copy with explicit template mapping; or manually set field values in the target |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
| ------- | ---------------- | ------------ |
| Partial failure / orphaned records | BullMQ worker implementation | Integration test: kill worker mid-job; verify no partial state remains |
| ZenStack v3 deadlocks | BullMQ worker implementation | Load test: 2 concurrent 50-case move jobs on same project; verify both succeed |
| Access control bypass | API endpoint + worker | Unit test: user with read-only source access; verify copy succeeds, move rejected |
| Unique constraint silent drop | UI dialog (pre-flight) + worker (error surfacing) | E2E test: copy case to project with same-name case; verify collision is surfaced before operation starts |
| Template field mapping corruption | Case creation logic (field value service) | Unit test: copy between projects with different templates; verify Dropdown values are name-resolved not ID-copied |
| Shared step dangling references | Step copying logic | Unit test: copy case with shared step; verify step content is present and `sharedStepGroupId` is null in target |
| Version history cross-project reference | Move logic (version migration step) | Query test after move: all RepositoryCaseVersions for moved case have `projectId = targetProjectId` |
| Performance under bulk load | BullMQ worker implementation | Load test: 200-case copy; verify <30s completion; check DB connection pool utilization |

---

## Sources

- Direct codebase analysis: `/testplanit/schema.zmodel`, `/testplanit/app/api/repository/import/route.ts`, `/testplanit/lib/services/testCaseVersionService.ts`, `/testplanit/lib/queues.ts`
- ZenStack v3 known issues: `MEMORY.md` (session memory) — 63-char alias limit, deadlock patterns, error format changes
- Existing E2E test comments: `e2e/tests/api/templates.crud.spec.ts` line 10, `case-fields.crud.spec.ts` line 11 — "Run serially to avoid ZenStack v3 deadlock under parallel workers"
- Project requirements: `.planning/PROJECT.md` (v0.17.0 milestone context)

---
*Pitfalls research for: cross-project copy/move test cases (TestPlanIt v0.17.0)*
*Researched: 2026-03-20*
