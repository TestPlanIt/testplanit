/**
 * COR-03 — FK id → human display name, with a short-TTL in-memory cache.
 *
 * After the correlation worker (14-05) rolls child rows up to their owning entity, the raw FK ids
 * in a changedCols diff (fieldId, statusId, workflowId, …) mean nothing to a viewer. humanize()
 * resolves them to the names a person reads ("Severity", "In Progress", "Default Workflow") per the
 * 14-RESEARCH §6 catalog mapping.
 *
 * Cache (research §6 "Don't hand-roll" / A4): a plain Map<string, {value, expiresAt}>, TTL 60s,
 * time-based eviction only. No new npm package — Map + Date.now() is sufficient; lru-cache is not a
 * dep. A repeat lookup of the same (catalog, id) inside the TTL window is served from cache (no
 * second DB call); after expiry the next lookup re-queries.
 *
 * The prisma client is INJECTED (not a top-level import) so the worker passes prismaBase and the
 * unit suite passes a spy. A missing catalog row falls back to the raw id and NEVER throws — a
 * humanization miss must not block an audit write.
 */

/** The injected catalog lookup: returns the display value for (table, field, id), or null. */
export type LookupFn = (
  table: string,
  field: string,
  id: number | string,
) => Promise<string | null>;

export interface HumanizeCacheOptions {
  ttlMs: number;
}

export interface HumanizeCache {
  /** Returns the display name for (table, field, id), hitting `lookup` only on a cache miss. */
  resolve: (
    table: string,
    field: string,
    id: number | string,
  ) => Promise<string | null>;
  /** Clears all cached entries (test helper / worker-shutdown hook). */
  reset: () => void;
}

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const cacheKey = (table: string, field: string, id: number | string): string =>
  `${table}:${field}:${id}`;

/**
 * Build a TTL-cached resolver over an injected catalog `lookup`. Time-based eviction only: an entry
 * is reused while `Date.now() < expiresAt`, otherwise it is re-fetched. In-flight de-duplication is
 * intentionally not added in v1 (catalog reads are cheap and the worker resolves serially).
 */
export function createHumanizeCache(
  lookup: LookupFn,
  opts: HumanizeCacheOptions,
): HumanizeCache {
  const store = new Map<string, CacheEntry>();

  return {
    async resolve(table, field, id) {
      const key = cacheKey(table, field, id);
      const hit = store.get(key);
      if (hit && Date.now() < hit.expiresAt) {
        return hit.value;
      }
      const value = await lookup(table, field, id);
      store.set(key, { value, expiresAt: Date.now() + opts.ttlMs });
      return value;
    },
    reset() {
      store.clear();
    },
  };
}

/**
 * Which changedCols FK columns are humanizable, and the catalog table/field that resolves them.
 * Keyed by source tableName so ResultFieldValues.fieldId → ResultFields (not CaseFields). A column
 * absent from the per-table map is left as-is (v1 scope: only humanize known FK columns that
 * actually appear in the diff). The `default` bucket holds columns whose catalog is table-agnostic
 * (statusId → Status, workflowId → Workflows).
 */
const CATALOG_BY_COLUMN: Record<
  string,
  Record<string, { table: string; field: string }>
> = {
  CaseFieldValues: { fieldId: { table: "CaseFields", field: "displayName" } },
  ResultFieldValues: { fieldId: { table: "ResultFields", field: "displayName" } },
  default: {
    statusId: { table: "Status", field: "name" },
    workflowId: { table: "Workflows", field: "name" },
  },
};

/** Resolve the catalog mapping for a (tableName, column), or null if the column is not humanizable. */
function catalogFor(
  tableName: string,
  column: string,
): { table: string; field: string } | null {
  const perTable = CATALOG_BY_COLUMN[tableName]?.[column];
  if (perTable) {
    return perTable;
  }
  return CATALOG_BY_COLUMN.default[column] ?? null;
}

/** One column's {old, new} entry inside a DataChangeLog changedCols diff. */
export interface ChangedColEntry {
  old: number | string | null;
  new: number | string | null;
}

export type ChangedCols = Record<string, ChangedColEntry>;

/** The humanized result for a single column: raw ids plus their resolved display names. */
export interface HumanizedColEntry extends ChangedColEntry {
  oldName?: string | null;
  newName?: string | null;
}

export type HumanizedCols = Record<string, ChangedColEntry | HumanizedColEntry>;

/**
 * Resolve an FK id to a display name, falling back to the raw id (as a string) on a miss or error.
 * Never throws — a missing catalog row must not block the audit write.
 */
async function resolveName(
  cache: HumanizeCache,
  table: string,
  field: string,
  id: number | string | null,
): Promise<string | null> {
  if (id === null || id === undefined) {
    return null;
  }
  try {
    const name = await cache.resolve(table, field, id);
    return name ?? String(id);
  } catch {
    return String(id);
  }
}

/**
 * Annotate a changedCols diff with display names for any humanizable FK columns present.
 *
 * Only columns that appear in `changedCols` AND have a catalog mapping for `tableName` are touched
 * (v1 scope). Each touched column gains `oldName`/`newName` alongside the original `old`/`new` raw
 * ids; non-FK columns pass through untouched. The cache is shared across the whole worker so repeat
 * ids within the TTL window resolve without a second DB call.
 */
export async function humanize(
  cache: HumanizeCache,
  tableName: string,
  changedCols: ChangedCols,
): Promise<HumanizedCols> {
  const out: HumanizedCols = {};
  for (const [column, entry] of Object.entries(changedCols)) {
    const catalog = catalogFor(tableName, column);
    if (!catalog) {
      out[column] = entry;
      continue;
    }
    out[column] = {
      ...entry,
      oldName: await resolveName(cache, catalog.table, catalog.field, entry.old),
      newName: await resolveName(cache, catalog.table, catalog.field, entry.new),
    };
  }
  return out;
}

/**
 * The catalog lookup the worker injects, backed by the raw (extension-free) prismaBase client.
 * Maps a catalog table name to its Prisma delegate + display column, selecting only that column.
 * Returns null on an unknown table or a missing row (humanize() then falls back to the raw id).
 */
export function createPrismaLookup(prisma: any): LookupFn {
  const delegates: Record<string, { delegate: string; field: string }> = {
    CaseFields: { delegate: "caseFields", field: "displayName" },
    ResultFields: { delegate: "resultFields", field: "displayName" },
    Status: { delegate: "status", field: "name" },
    Workflows: { delegate: "workflows", field: "name" },
  };

  return async (table, field, id) => {
    const meta = delegates[table];
    if (!meta) {
      return null;
    }
    const row = await prisma[meta.delegate].findUnique({
      where: { id: Number(id) },
      select: { [meta.field]: true },
    });
    return (row?.[meta.field] as string | undefined) ?? null;
  };
}
