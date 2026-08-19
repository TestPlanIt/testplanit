import { baseDb } from "~/lib/db";

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
