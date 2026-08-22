import { baseDb } from "~/lib/db";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import type { TxClient } from "~/lib/zenstack";

import { REQUIREMENT_SCOPE_WHERE } from "./issueRoleScope";

/**
 * Builds an issueId -> [self, ...ancestors] map for a project, used to walk
 * a requirement root-ward (e.g. to roll a descendant up into its ancestor
 * chain). A single round trip; the chain is walked in memory with a `seen`
 * guard against cycles. Unlike `buildFolderAncestorMap`, this is always
 * project-scoped — requirement trees never span projects, and cross-project
 * sharing is exactly what `assertSameProject` below exists to prevent.
 */
export async function buildIssueAncestorMap(
  db: any,
  projectId: number
): Promise<Map<number, number[]>> {
  const issues: Array<{ id: number; parentId: number | null }> =
    await db.issue.findMany({
      where: { projectId, isDeleted: false },
      select: { id: true, parentId: true },
    });

  const parentOf = new Map<number, number | null>();
  for (const issue of issues) {
    parentOf.set(issue.id, issue.parentId);
  }

  const ancestorsOf = new Map<number, number[]>();
  for (const issue of issues) {
    const chain: number[] = [];
    const seen = new Set<number>();
    let current: number | null = issue.id;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = parentOf.get(current) ?? null;
    }
    ancestorsOf.set(issue.id, chain);
  }

  return ancestorsOf;
}

/**
 * Returns every live descendant of `rootId`, excluding the root itself —
 * callers that need root-plus-descendants (e.g. the plan 21-06 delete path)
 * must add the root back. The `projectId` predicate is repeated in the
 * recursive arm (not just the anchor) so a cross-project `parentId` can
 * never widen the walk. `depth < 100` caps the recursion because an
 * unguarded recursive CTE over cyclic data hangs or exhausts memory rather
 * than erroring, and this phase introduces the first authoritative cycle
 * guard on any self-referential model in this schema — pre-trigger or
 * rolled-back-trigger data must fail fast.
 *
 * ROLE-AGNOSTIC by contract: it walks `Issue.parentId` edges of every kind,
 * because that column is written for every synced issue regardless of
 * classification. Anything that resolves a requirement WRITE set must use
 * `getRequirementSubtreeIds` below instead — this walk reaches unclassified
 * Story/Bug rows that no requirement surface ever showed the user.
 */
export async function getIssueSubtreeIds(
  rootId: number,
  projectId: number,
  db: Pick<typeof baseDb, "$queryRaw"> = baseDb
): Promise<number[]> {
  const rows: Array<{ id: number }> = await db.$queryRaw`
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth FROM "Issue"
      WHERE "parentId" = ${rootId} AND "projectId" = ${projectId} AND "isDeleted" = false
      UNION ALL
      SELECT i.id, d.depth + 1 FROM "Issue" i
      INNER JOIN descendants d ON i."parentId" = d.id
      WHERE i."projectId" = ${projectId} AND i."isDeleted" = false AND d.depth < 100
    )
    SELECT id FROM descendants
  `;
  return rows.map((row) => row.id);
}

/**
 * Requirement-scoped twin of `getIssueSubtreeIds`: every live descendant of
 * `rootId` reachable through requirement rows ONLY. This is the walk that
 * resolves the cascade delete's write set.
 *
 * The role predicate is repeated in the RECURSIVE ARM, not just the anchor,
 * and that is the deliberate OPPOSITE of the anchor-only asymmetry in
 * `requirementCoverage.ts`'s closure walk. The two walks answer different
 * questions. Coverage rolls a descendant's case links UP into a requirement
 * ancestor, so a non-requirement node in between must be walked THROUGH or
 * a whole class of rollups stops at the first such node. This walk resolves
 * rows to WRITE, so a non-requirement node is exactly where it must stop:
 * Jira sync writes `parentId` for every synced issue regardless of
 * classification, so a requirement-classified Epic routinely carries
 * unclassified Story/Bug children, and sweeping those into a requirement's
 * delete destroys defects nobody asked to delete.
 *
 * Stopping at such a node — rather than walking through it and filtering
 * the write set afterward — is also what keeps this set identical to the
 * count the delete confirmation shows. That count is walked from the
 * requirements tree's own `childrenMap`, which is built from requirement
 * rows only and therefore has no edge across a non-requirement node
 * either; a requirement sitting under an unclassified parent is not a
 * descendant of anything that tree can render, before or after a delete.
 */
async function getRequirementSubtreeIds(
  rootId: number,
  projectId: number,
  db: Pick<typeof baseDb, "$queryRaw"> = baseDb
): Promise<number[]> {
  const rows: Array<{ id: number }> = await db.$queryRaw`
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth FROM "Issue"
      WHERE "parentId" = ${rootId} AND "projectId" = ${projectId} AND "isDeleted" = false
        AND "isRequirement" = true
      UNION ALL
      SELECT i.id, d.depth + 1 FROM "Issue" i
      INNER JOIN descendants d ON i."parentId" = d.id
      WHERE i."projectId" = ${projectId} AND i."isDeleted" = false AND d.depth < 100
        AND i."isRequirement" = true
    )
    SELECT id FROM descendants
  `;
  return rows.map((row) => row.id);
}

/**
 * Rejects a reparent that would put `issueId` under itself or under one of
 * its own descendants. No-ops when `newParentId` is null (detaching to a
 * root is never a cycle) — the fast path issues zero queries. The
 * `depth < 100` cap mirrors `getIssueSubtreeIds`'s, for the same reason:
 * this is the first authoritative cycle guard on any self-referential model
 * in this schema, so pre-trigger/rolled-back-trigger data must fail fast
 * rather than hang the connection.
 */
export async function assertNoCycle(
  db: any,
  issueId: number,
  newParentId: number | null
): Promise<void> {
  if (newParentId === null) return;
  if (newParentId === issueId) {
    throw new Error(`Issue ${issueId} cannot be its own parent`);
  }
  const ancestorRows: Array<{ id: number }> = await db.$queryRaw`
    WITH RECURSIVE ancestors AS (
      SELECT "parentId" AS id, 1 AS depth FROM "Issue" WHERE id = ${newParentId}
      UNION ALL
      SELECT i."parentId", a.depth + 1 FROM "Issue" i
      INNER JOIN ancestors a ON i.id = a.id
      WHERE i."parentId" IS NOT NULL AND a.depth < 100
    )
    SELECT id FROM ancestors WHERE id = ${issueId}
  `;
  if (ancestorRows.length > 0) {
    throw new Error(
      `Reparenting Issue ${issueId} under ${newParentId} would create a cycle`
    );
  }
}

/**
 * Rejects a reparent whose new parent belongs to a different project than
 * the child. The trigger in plan 21-03 checks cycles only, not project
 * scoping — a `parentId` pointing at another project's row is a distinct
 * tampering vector and this is the only layer that closes it. One query
 * (id-in filter) rather than two separate lookups.
 */
export async function assertSameProject(
  db: any,
  issueId: number,
  newParentId: number | null
): Promise<void> {
  if (newParentId === null) return;
  const rows: Array<{ id: number; projectId: number | null }> =
    await db.issue.findMany({
      where: { id: { in: [issueId, newParentId] } },
      select: { id: true, projectId: true },
    });
  const child = rows.find((row) => row.id === issueId);
  const parent = rows.find((row) => row.id === newParentId);
  if (!parent || child?.projectId !== parent.projectId) {
    throw new Error(
      `Issue ${issueId} and new parent ${newParentId} must belong to the same project`
    );
  }
}

/**
 * Single entry point for a reparent: Phase 22's sync writer and Phase 25's
 * drag-and-drop handler call this instead of the two guards individually.
 * Project first because it is the cheaper query and because a cross-project
 * parent is invalid regardless of cycle status.
 */
export async function assertValidReparent(
  db: any,
  issueId: number,
  newParentId: number | null
): Promise<void> {
  await assertSameProject(db, issueId, newParentId);
  await assertNoCycle(db, issueId, newParentId);
}

/**
 * Returns every soft-deleted requirement descendant of `rootId` — the mirror
 * image of `getRequirementSubtreeIds` (`isDeleted = true` instead of
 * `false`, walked at every recursion level so a live row can never re-enter
 * the deleted-side walk). Not exported: it exists only to resolve the cohort
 * `restoreRequirementSubtree` needs. A second query rather than a boolean
 * parameter on `getRequirementSubtreeIds` — the two filters are opposite at
 * every level of the recursion, and folding them behind a flag would make
 * both harder to read for no real code reuse.
 *
 * Carries the same both-arms role predicate as the live-side walk, for the
 * same reason plus one more: restore must resolve exactly the cohort the
 * matching delete produced, and a walk that reached further than the delete
 * did could only ever un-delete a row this cascade never touched.
 */
async function getDeletedRequirementSubtreeIds(
  rootId: number,
  projectId: number,
  db: Pick<typeof baseDb, "$queryRaw"> = baseDb
): Promise<number[]> {
  const rows: Array<{ id: number }> = await db.$queryRaw`
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth FROM "Issue"
      WHERE "parentId" = ${rootId} AND "projectId" = ${projectId} AND "isDeleted" = true
        AND "isRequirement" = true
      UNION ALL
      SELECT i.id, d.depth + 1 FROM "Issue" i
      INNER JOIN descendants d ON i."parentId" = d.id
      WHERE i."projectId" = ${projectId} AND i."isDeleted" = true AND d.depth < 100
        AND i."isRequirement" = true
    )
    SELECT id FROM descendants
  `;
  return rows.map((row) => row.id);
}

/**
 * The locked P2/P6 tree-delete policy: cascade soft-delete of `rootId` and
 * its whole live subtree in ONE transaction, adapted from the shipped
 * RepositoryFolders subtree-delete route
 * (app/api/projects/[projectId]/folders/delete-subtree/route.ts). Its
 * name-suffix rename trick is deliberately NOT copied here — `Issue` has no
 * name-uniqueness constraint a soft-delete would need to free.
 *
 * `Issue.parentId`'s `ON DELETE CASCADE` foreign key is a HARD-delete
 * mechanism only; it never fires on this path, since a soft-delete is a
 * plain `isDeleted` UPDATE and touches no foreign key at all. This cascade
 * is therefore an explicit, separate application-level operation.
 *
 * The `deletedAt` column is never set here — the registered soft-delete
 * stamp trigger (see scripts/apply-triggers.ts) sets it to `now()` (the
 * transaction timestamp) on the `isDeleted` false->true flip, and letting
 * the trigger own the value is exactly what makes every row this cascade
 * touches share one timestamp, which `restoreRequirementSubtree` below keys
 * its cohort match on.
 *
 * Scope boundary: this is the TestPlanIt-initiated delete of a requirement.
 * It is NOT the "the Jira epic vanished upstream" case — that is a
 * detach-not-delete question owned by a later phase and must not be
 * conflated with this function.
 *
 * Requirement rows ONLY, at every layer: the walk that resolves the write
 * set, the root lookup, and the bulk statement each carry the role
 * predicate. A requirement's non-requirement children — which Jira sync
 * creates routinely, since it writes `parentId` for every synced issue
 * regardless of classification — are deliberately LEFT ALONE, neither
 * deleted nor re-parented:
 *
 *  - Their `parentId` still resolves to a real row. A soft-delete removes
 *    nothing; the FK stays satisfied and the ON DELETE CASCADE above never
 *    fires. Nothing dangles at the SQL level.
 *  - No requirement surface can render a phantom because of them. Every
 *    live requirement child of the root is deleted with it, so no live
 *    requirement is ever left pointing at a soft-deleted parent; and a
 *    requirement under an unclassified parent was already unreachable from
 *    the tree's roots, both before and after this delete.
 *  - Nulling their `parentId` instead would be unrecoverable and futile:
 *    `restoreRequirementSubtree` restores `isDeleted`, not edges, so an undo
 *    would return the row with its hierarchy silently flattened — and the
 *    next sync pass re-resolves `parentId` for those very rows anyway.
 *
 * No authorization check here by design: this is a service function, not a
 * directly client-callable route (unlike the folders precedent). The
 * caller — Phase 25's delete UI action — is responsible for authorizing the
 * operation before invoking this.
 */
export async function deleteRequirementSubtree(
  rootId: number,
  projectId: number,
  opts?: { tx?: TxClient }
): Promise<{ deletedIds: number[]; deletedAt: Date | null }> {
  // Explicit existence/ownership/liveness/role lookup — never inferred from
  // an empty descendant list, since a missing/foreign/already-deleted/
  // unclassified root and "a leaf with no children" all resolve to zero
  // descendants.
  const root = await baseDb.issue.findFirst({
    where: {
      id: rootId,
      projectId,
      isDeleted: false,
      ...REQUIREMENT_SCOPE_WHERE,
    },
    select: { id: true },
  });
  if (!root) {
    return { deletedIds: [], deletedAt: null };
  }

  // `ids` is the CANDIDATE set only, resolved BEFORE the transaction opens:
  // the read is cheap and read-only, and keeping it outside the transaction
  // keeps the write window short. That gap is exactly why the bulk statement
  // re-applies the scope below — the walk's snapshot can be stale by the time
  // the write lands (a concurrent `recomputeRequirementClassification` can
  // reclassify a row out of the requirement set in between).
  const descendantIds = await getRequirementSubtreeIds(rootId, projectId);
  const ids = [rootId, ...descendantIds];

  const run = async (
    tx: TxClient
  ): Promise<Array<{ id: number; deletedAt: Date | null }>> =>
    // Single parameterized bulk UPDATE. projectId and the role predicate are
    // repeated here even though the CTE above already scoped both — a bulk
    // soft-delete is the single highest-blast-radius statement in this
    // phase, and a redundant scope predicate costs nothing. The role
    // predicate in particular is the last thing standing between a
    // mis-resolved id list and a destroyed defect.
    //
    // `RETURNING id, "deletedAt"` rather than reporting the candidate array
    // back: the response must name the rows this statement actually flipped,
    // not the rows it was asked to consider, or a caller acting on
    // `deletedIds` (the tree view drops its selection by membership in it)
    // acts on a row that is still live. Reading `deletedAt` off the same
    // RETURNING clause keeps the two halves of the response consistent —
    // a separate SELECT afterward could report a timestamp some other
    // operation stamped on a root this call never touched.
    tx.$queryRaw<Array<{ id: number; deletedAt: Date | null }>>`
      UPDATE "Issue"
      SET "isDeleted" = true
      WHERE id = ANY(${ids}::int[])
        AND "projectId" = ${projectId}
        AND "isDeleted" = false
        AND "isRequirement" = true
      RETURNING id, "deletedAt"
    `;

  // Use the caller's transaction when supplied (a caller already inside an
  // audited transaction must not nest one, and the integration test drives
  // the function directly this way); otherwise open one here.
  const deleted = opts?.tx ? await run(opts.tx) : await auditedTransaction(run);

  return {
    deletedIds: deleted.map((row) => row.id),
    deletedAt: deleted.find((row) => row.id === rootId)?.deletedAt ?? null,
  };
}

/**
 * Symmetric restore for `deleteRequirementSubtree`. Restores `rootId` and
 * exactly the cohort its matching cascade deleted — never a row soft-deleted
 * by an unrelated earlier operation, even one inside the same subtree.
 *
 * The cohort match is the whole point: it filters on `"deletedAt" = (SELECT
 * "deletedAt" FROM "Issue" WHERE id = rootId)`, evaluated Postgres-native
 * inside the single UPDATE statement rather than round-tripped through JS.
 * `pg` parses `timestamptz` to a millisecond-resolution JS `Date` while
 * `now()` stores microsecond precision, so reading `deletedAt` into JS and
 * passing it back as a bind parameter can silently equal-match ZERO rows.
 * The in-statement subselect avoids that entirely, and it must run inside
 * the SAME UPDATE statement as the write: the stamp trigger nulls
 * `deletedAt` on the true->false flip, so a subselect issued afterward
 * would already see nulls. It works by construction here because a single
 * UPDATE statement's WHERE-clause subqueries see the pre-statement
 * snapshot, not any row this same statement has since modified.
 *
 * The deleted-side subtree walk returns descendants only (mirroring
 * `getRequirementSubtreeIds`) — `rootId` is prepended to the id list exactly
 * like delete's own step 1. Without that prepend the root itself would stay
 * permanently soft-deleted after a "restore".
 *
 * Role-scoped at every layer for the same reason delete is, read in the
 * other direction: this must never un-delete a defect row that some other
 * operation soft-deleted, and it can only restore what a matching cascade
 * deleted.
 *
 * Same authorization posture as `deleteRequirementSubtree`: none here by
 * design, the caller is responsible.
 */
export async function restoreRequirementSubtree(
  rootId: number,
  projectId: number,
  opts?: { tx?: TxClient }
): Promise<{ restoredIds: number[] }> {
  const root = await baseDb.issue.findFirst({
    where: { id: rootId, projectId, ...REQUIREMENT_SCOPE_WHERE },
    select: { deletedAt: true },
  });
  if (!root || root.deletedAt === null) {
    return { restoredIds: [] };
  }

  // `ids` is the CANDIDATE set only — getDeletedRequirementSubtreeIds walks
  // every currently-deleted requirement descendant regardless of when it was
  // deleted, so it also contains a descendant that was already soft-deleted
  // before this cascade ran (the exact row the deletedAt-equality WHERE
  // clause below must exclude from the actual UPDATE). `RETURNING id`
  // reports precisely which rows the deletedAt match actually flipped, so
  // `restoredIds` in the response can never claim a row that stayed deleted.
  const descendantIds = await getDeletedRequirementSubtreeIds(
    rootId,
    projectId
  );
  const ids = [rootId, ...descendantIds];

  const run = async (tx: TxClient): Promise<number[]> => {
    const restored = await tx.$queryRaw<Array<{ id: number }>>`
      UPDATE "Issue"
      SET "isDeleted" = false
      WHERE id = ANY(${ids}::int[])
        AND "projectId" = ${projectId}
        AND "isRequirement" = true
        AND "deletedAt" = (SELECT "deletedAt" FROM "Issue" WHERE id = ${rootId})
      RETURNING id
    `;
    return restored.map((row) => row.id);
  };

  const restoredIds = opts?.tx
    ? await run(opts.tx)
    : await auditedTransaction(run);

  return { restoredIds };
}

/** Filters to non-empty strings, de-duplicated. Never throws. */
function normalizeTypeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Flips `Issue.isRequirement` in BOTH directions for a project's saved
 * requirements-config change: issues whose `issueTypeId` is in
 * `addedTypeIds` become requirements, issues whose `issueTypeId` is in
 * `removedTypeIds` stop being requirements. Adapted line-for-line from
 * `deleteRequirementSubtree`'s shape above — a `run(tx)` closure of
 * parameterized `$executeRaw` statements, invoked via `auditedTransaction`
 * only when the caller has not already supplied one. The
 * requirements-config route passes its own `tx` so the `ProjectIntegration`
 * config write and this recompute share ONE atomic transaction (CFG-03 /
 * T-22-03-05) — a page refresh or dropped connection between two separate
 * calls would otherwise leave a config saved with no matching reclassify.
 *
 * Writes `isRequirement` ONLY. `parentId` is left as-is — a de-classified
 * node's children keep their FK; how those render is a later phase's
 * question. `requirementDetachedAt` is left as-is too: the lock predicate on
 * title/description/status/priority/parentId is an AND of three conditions
 * (`isRequirement == true && integrationId != null && requirementDetachedAt
 * == null`), so `isRequirement` flipping to false alone already unlocks the
 * row completely — clearing the detach timestamp here would erase honest
 * history across a reclassify round-trip. `title`/`description`/`status`/
 * `priority` are untouched by this pass.
 *
 * The project-scope predicate is unconditional in BOTH statements — this is
 * the single highest-blast-radius statement in this phase, and an unscoped
 * or mis-scoped predicate would reclassify rows across projects and tenants
 * (T-22-03-02). The prior-state predicate keeps each statement's
 * affected-row count meaningful (a row already in the target state is never
 * rewritten) and the live-row predicate mirrors
 * `deleteRequirementSubtree`'s own scoping.
 *
 * No authorization check here by design — same posture as every other
 * function in this file: the caller (the requirements-config route's
 * `authorizeProjectAdminForProject` gate) is responsible for authorizing the
 * operation before invoking this.
 *
 * No batching machinery here, deliberately: this is at most two
 * project-scoped statements against a bounded input (issueTypeIds capped by
 * `sanitizeRequirementTypeIds`'s `MAX_REQUIREMENT_TYPE_IDS`), not a
 * whole-tenant sweep. Do not copy the SCIM access-recompute worker's
 * fixed-size batching loop here — that pattern exists for a per-row lookup
 * across every tenant, a different problem than a pure predicate-membership
 * flip scoped to one project's issues. Equally, do not repeat that worker's
 * known unbounded-sweep residual: the statement set here is exactly two
 * statements, both project-scoped, with the input id lists already capped
 * by the caller.
 */
export async function recomputeRequirementClassification(
  projectId: number,
  addedTypeIds: string[],
  removedTypeIds: string[],
  opts?: { tx?: TxClient }
): Promise<{ classified: number; declassified: number }> {
  const added = normalizeTypeIds(addedTypeIds);
  const removed = normalizeTypeIds(removedTypeIds);

  if (added.length === 0 && removed.length === 0) {
    // A no-op save must not open a transaction — and therefore must not
    // write an audit frame — for nothing.
    return { classified: 0, declassified: 0 };
  }

  const run = async (
    tx: TxClient
  ): Promise<{ classified: number; declassified: number }> => {
    let classified = 0;
    let declassified = 0;
    if (added.length > 0) {
      classified = await tx.$executeRaw`
        UPDATE "Issue"
        SET "isRequirement" = true
        WHERE "projectId" = ${projectId}
          AND "issueTypeId" = ANY(${added}::text[])
          AND "isRequirement" = false
          AND "isDeleted" = false
      `;
    }
    if (removed.length > 0) {
      declassified = await tx.$executeRaw`
        UPDATE "Issue"
        SET "isRequirement" = false
        WHERE "projectId" = ${projectId}
          AND "issueTypeId" = ANY(${removed}::text[])
          AND "isRequirement" = true
          AND "isDeleted" = false
      `;
    }
    return { classified, declassified };
  };

  return opts?.tx ? run(opts.tx) : auditedTransaction(run);
}
