// lib/paginatedFindMany.ts
// Two-phase paginated read: keeps relation hydration O(pageSize) instead of
// O(total matching rows). ZenStack v3 builds every selected relation (and the
// PolicyPlugin's per-row access subqueries) for ALL rows matching `where`
// before applying LIMIT. This splits the read: (1) page ids only, (2) hydrate
// the heavy select for just those ids; then re-imposes phase-1 order. Returns
// the same rows, same order, as the equivalent single findMany.

interface FindManyModel {
  // loose on purpose: the select is dynamic and ZenStack's overloaded findMany
  // signature isn't worth threading through a generic shim.
  findMany: (args: any) => Promise<any[]>;
}

export interface PaginatedFindManyArgs {
  where?: unknown;
  orderBy?: unknown;
  select: Record<string, unknown>; // must select `id`
  skip?: number;
  take?: number;
}

export async function paginatedFindManyWithRelations<
  TRow extends { id: unknown },
>(
  model: FindManyModel,
  { where, orderBy, select, skip, take }: PaginatedFindManyArgs
): Promise<TRow[]> {
  // Phase 1 — page ids only. Same where/orderBy/skip/take, so the DB still
  // sorts the ENTIRE matching set and picks the correct page window.
  const pageRows = await model.findMany({
    where,
    orderBy,
    select: { id: true },
    skip,
    take,
  });
  const pageIds = pageRows.map((r) => r.id);
  if (pageIds.length === 0) return [];

  // Phase 2 — hydrate the heavy select for just this page.
  const rows = (await model.findMany({
    where: { ...(where as Record<string, unknown>), id: { in: pageIds } },
    select,
  })) as TRow[];

  // Re-impose phase-1 order (independent of phase 2's sort stability / ties).
  const byId = new Map(rows.map((r) => [r.id, r]));
  return pageIds
    .map((id) => byId.get(id))
    .filter((r): r is TRow => r !== undefined);
}
