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
 * The db client is INJECTED (not a top-level import) so the worker passes rawDb and the
 * unit suite passes a spy. A missing catalog row falls back to the raw id and NEVER throws — a
 * humanization miss must not block an audit write.
 */

/** The injected catalog lookup: returns the display value for (table, field, id), or null. */
export type LookupFn = (
  table: string,
  field: string,
  id: number | string
) => Promise<string | null>;

export interface HumanizeCacheOptions {
  ttlMs: number;
}

export interface HumanizeCache {
  /** Returns the display name for (table, field, id), hitting `lookup` only on a cache miss. */
  resolve: (
    table: string,
    field: string,
    id: number | string
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
  opts: HumanizeCacheOptions
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
  ResultFieldValues: {
    fieldId: { table: "ResultFields", field: "displayName" },
  },
  // TestRunCases captures repositoryCaseId (the case added to the run); resolve it
  // to the case name so a bulk add reads as case names, not raw ids. The summary
  // step in correlation.ts then collapses these to "N test cases added: <names>".
  TestRunCases: {
    repositoryCaseId: { table: "RepositoryCases", field: "name" },
  },
  default: {
    statusId: { table: "Status", field: "name" },
    workflowId: { table: "Workflows", field: "name" },
    // Access-control / assignment join tables (GroupAssignment, RolePermission,
    // Project*Assignment, …) capture only their FK ids; resolve them to names so a
    // change reads "user: Administrator Account, group: QA" instead of raw ids.
    userId: { table: "User", field: "name" },
    groupId: { table: "Groups", field: "name" },
    roleId: { table: "Roles", field: "name" },
    projectId: { table: "Projects", field: "name" },
    configurationId: { table: "Configurations", field: "name" },
    milestoneTypeId: { table: "MilestoneTypes", field: "name" },
  },
};

/** Resolve the catalog mapping for a (tableName, column), or null if the column is not humanizable. */
function catalogFor(
  tableName: string,
  column: string
): { table: string; field: string } | null {
  const perTable = CATALOG_BY_COLUMN[tableName]?.[column];
  if (perTable) {
    return perTable;
  }
  return CATALOG_BY_COLUMN.default[column] ?? null;
}

/**
 * Value tables (CaseFieldValues / SessionFieldValues / ResultFieldValues) store only a generic
 * `value` plus the `fieldId` of the field it belongs to. Rendered generically that reads as the
 * opaque "value: 3 → 2"; instead we re-key the diff under the field's display name and resolve the
 * value to a label ("Priority: Medium → High"). `fieldCatalog` resolves fieldId → the field's
 * displayName; `typeCatalog` resolves fieldId → the field's type name (which decides how `value`
 * renders). Session fields reuse the case-field catalog (SessionFieldValues.fieldId → CaseFields).
 */
const VALUE_TABLES: Record<
  string,
  { fieldCatalog: string; typeCatalog: string }
> = {
  CaseFieldValues: { fieldCatalog: "CaseFields", typeCatalog: "CaseFieldType" },
  SessionFieldValues: {
    fieldCatalog: "CaseFields",
    typeCatalog: "CaseFieldType",
  },
  ResultFieldValues: {
    fieldCatalog: "ResultFields",
    typeCatalog: "ResultFieldType",
  },
};

/** Pull the concatenated plain text out of a Tiptap doc (string- or object-encoded), truncated. */
function tiptapToPlainText(value: unknown): string {
  let doc: unknown = value;
  if (typeof doc === "string") {
    const raw = doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      return raw.slice(0, 140);
    }
  }
  let out = "";
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") out += node.text;
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  out = out.trim();
  return out.length > 140 ? `${out.slice(0, 140)}…` : out;
}

/**
 * Render a value-table `value` to a human label according to the field's type. Option-backed types
 * resolve ids to their FieldOptions name; rich text is flattened; everything else is shown as-is.
 * Never throws — an unresolved option falls back to its raw id via resolveName.
 */
async function renderFieldValue(
  cache: HumanizeCache,
  type: string | null,
  value: number | string | boolean | null | unknown
): Promise<string | null> {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "Dropdown":
      return resolveName(
        cache,
        "FieldOptions",
        "name",
        value as number | string
      );
    case "Multi-Select": {
      const ids = Array.isArray(value) ? value : [value];
      const names = await Promise.all(
        ids.map((id) =>
          resolveName(cache, "FieldOptions", "name", id as number | string)
        )
      );
      const joined = names.filter(Boolean).join(", ");
      return joined || String(value);
    }
    case "Checkbox":
      return value ? "Checked" : "Unchecked";
    case "Text Long":
      return tiptapToPlainText(value) || "(empty)";
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/**
 * Re-key a value-table diff under the changed field's display name with a resolved label, e.g.
 * { fieldId: {2}, value: {old:3,new:2} } → { Priority: { old: "Medium", new: "High" } }. The raw
 * value/fieldId/FK columns are dropped. Returns null when fieldId is absent (no field context) so
 * the caller can fall back to the generic path.
 */
async function humanizeFieldValueChange(
  cache: HumanizeCache,
  config: { fieldCatalog: string; typeCatalog: string },
  changedCols: ChangedCols
): Promise<HumanizedCols | null> {
  const fieldEntry = changedCols.fieldId;
  const fieldId = fieldEntry?.new ?? fieldEntry?.old;
  if (fieldId === null || fieldId === undefined) return null;
  const displayName =
    (await resolveName(cache, config.fieldCatalog, "displayName", fieldId)) ??
    "Field";
  let type: string | null = null;
  try {
    type = await cache.resolve(config.typeCatalog, "type", fieldId);
  } catch {
    type = null;
  }
  const valueEntry = changedCols.value ?? { old: null, new: null };
  return {
    [displayName]: {
      old: await renderFieldValue(cache, type, valueEntry.old),
      new: await renderFieldValue(cache, type, valueEntry.new),
    },
  };
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
  id: number | string | null
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
/**
 * Implicit Prisma m2m join tables (`_*To*`). Their generic A/B columns are
 * unreadable in a diff ("{A:4,B:13}"), and the row already rolls up to its owner
 * (case/run/session) so the owner column is redundant. `col` is the NON-owner
 * column — the linked tag/issue — verified against ROLLUP_MAP.fkCol. humanize()
 * keeps ONLY that column, relabels it to its entity, and resolves its name.
 */
/**
 * Human-authored TipTap rich-text columns on root tables (mirrors the SAF-02 note in
 * scripts/trigger-registry.ts). These are captured raw in the DataChangeLog diff, so here we flatten
 * each side to a truncated plain-text string — "note: <old text…> → <new text…>" — exactly as case
 * Text-Long field values render via renderFieldValue. A column absent from this map is untouched.
 */
const RICH_TEXT_COLUMNS: Record<string, ReadonlySet<string>> = {
  Milestones: new Set(["note", "docs"]),
  Sessions: new Set(["note", "mission"]),
  Issue: new Set(["note"]),
  Comment: new Set(["content"]),
};

/** Flatten a raw TipTap column value in a diff: null stays null; a present doc → plain text or "(empty)". */
function renderRichTextValue(value: number | string | null): string | null {
  if (value === null || value === undefined) return null;
  return tiptapToPlainText(value) || "(empty)";
}

/**
 * Coerce an un-mapped diff value for display. `changed_cols` can carry raw Json columns — a TipTap
 * doc (e.g. TestRunResults/TestRunCases `notes`) or arbitrary JSON (e.g. `evidence`) — that the
 * generic path would otherwise pass through as an object and `String()` would render as the literal
 * "[object Object]" (visible in the audit detail view). Flatten a TipTap doc to plain text; render
 * any other object/array as compact JSON (empty {}/[] → "(empty)"); pass scalars through untouched.
 */
function coerceDiffValue(
  value: number | string | null
): number | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  // A TipTap document on any table (even one not in RICH_TEXT_COLUMNS) → readable plain text.
  if ((value as { type?: unknown }).type === "doc") {
    return renderRichTextValue(value);
  }
  try {
    const json = JSON.stringify(value);
    if (json === "{}" || json === "[]") return "(empty)";
    return json.length > 140 ? `${json.slice(0, 140)}…` : json;
  } catch {
    return "(unserializable)";
  }
}

const M2M_JOIN_TABLES: Record<
  string,
  { col: string; label: string; model: string }
> = {
  // Explicit join tables use named columns; implicit ones still use "A"/"B".
  RepositoryCaseTag: { col: "tagId", label: "Tags", model: "Tags" },
  RepositoryCaseIssue: { col: "issueId", label: "Issues", model: "Issue" },
  _SessionsToTags: { col: "B", label: "Tags", model: "Tags" },
  _TagsToTestRuns: { col: "A", label: "Tags", model: "Tags" },
  _IssueToTestRuns: { col: "A", label: "Issues", model: "Issue" },
  _IssueToTestRunResults: { col: "A", label: "Issues", model: "Issue" },
  _IssueToTestRunStepResults: { col: "A", label: "Issues", model: "Issue" },
  _IssueToSessions: { col: "A", label: "Issues", model: "Issue" },
  _IssueToSessionResults: { col: "A", label: "Issues", model: "Issue" },
};

export async function humanize(
  cache: HumanizeCache,
  tableName: string,
  changedCols: ChangedCols
): Promise<HumanizedCols> {
  // Value tables re-key their {fieldId, value} diff under the field's display name with a resolved
  // label ("Priority: Medium → High") instead of the opaque generic "value: 3 → 2".
  const valueTable = VALUE_TABLES[tableName];
  if (valueTable && changedCols.value !== undefined) {
    const rekeyed = await humanizeFieldValueChange(
      cache,
      valueTable,
      changedCols
    );
    if (rekeyed) {
      return rekeyed;
    }
  }

  // Implicit m2m join tables: collapse the opaque A/B diff to just the linked
  // tag/issue, named — "{A:4,B:13}" → { Tags: { new: "regression" } }. The owner
  // column is dropped (the row already attributes to that owner).
  const m2m = M2M_JOIN_TABLES[tableName];
  if (m2m) {
    const entry = changedCols[m2m.col];
    if (!entry) return {};
    return {
      [m2m.label]: {
        old: entry.old,
        new: entry.new,
        oldName: await resolveName(cache, m2m.model, "name", entry.old),
        newName: await resolveName(cache, m2m.model, "name", entry.new),
      },
    };
  }

  const richTextColumns = RICH_TEXT_COLUMNS[tableName];

  const out: HumanizedCols = {};
  for (const [column, entry] of Object.entries(changedCols)) {
    // Root-table TipTap columns: flatten each side to readable plain text instead of dumping the
    // raw doc JSON into the audit diff.
    if (richTextColumns?.has(column)) {
      out[column] = {
        old: renderRichTextValue(entry.old),
        new: renderRichTextValue(entry.new),
      };
      continue;
    }
    const catalog = catalogFor(tableName, column);
    if (!catalog) {
      // No FK catalog / not rich-text: coerce so a raw Json column (notes doc,
      // evidence, …) never reaches the diff as an object → "[object Object]".
      out[column] = {
        ...entry,
        old: coerceDiffValue(entry.old),
        new: coerceDiffValue(entry.new),
      };
      continue;
    }
    out[column] = {
      ...entry,
      oldName: await resolveName(
        cache,
        catalog.table,
        catalog.field,
        entry.old
      ),
      newName: await resolveName(
        cache,
        catalog.table,
        catalog.field,
        entry.new
      ),
    };
  }
  return out;
}

/**
 * The catalog lookup the worker injects, backed by the raw (extension-free) rawDb client.
 * Maps a catalog table name to its Prisma delegate + display column, selecting only that column.
 * Returns null on an unknown table or a missing row (humanize() then falls back to the raw id).
 */
export function createDbLookup(db: any): LookupFn {
  const delegates: Record<
    string,
    { delegate: string; field: string; stringId?: boolean }
  > = {
    CaseFields: { delegate: "caseFields", field: "displayName" },
    ResultFields: { delegate: "resultFields", field: "displayName" },
    // Dropdown / Multi-Select option id → its label (Critical, High, …); shared across case,
    // session, and result fields (all assign from FieldOptions).
    FieldOptions: { delegate: "fieldOptions", field: "name" },
    Status: { delegate: "status", field: "name" },
    Workflows: { delegate: "workflows", field: "name" },
    // Comment attribution: the comment rolls up to whichever parent FK is set,
    // and its actor is the row's creatorId — both resolved to a display name
    // here. User/ReviewRequest ids are cuids (string), the rest are Int.
    RepositoryCases: { delegate: "repositoryCases", field: "name" },
    Sessions: { delegate: "sessions", field: "name" },
    TestRuns: { delegate: "testRuns", field: "name" },
    Milestones: { delegate: "milestones", field: "name" },
    User: { delegate: "user", field: "name", stringId: true },
    // Access-control / assignment FK targets (see CATALOG_BY_COLUMN.default).
    Groups: { delegate: "groups", field: "name" },
    Roles: { delegate: "roles", field: "name" },
    Projects: { delegate: "projects", field: "name" },
    Configurations: { delegate: "configurations", field: "name" },
    MilestoneTypes: { delegate: "milestoneTypes", field: "name" },
    // Implicit-m2m link targets — the tag/issue named in a `_*To*` join row.
    Tags: { delegate: "tags", field: "name" },
    Issue: { delegate: "issue", field: "name" },
  };

  return async (table, field, id) => {
    // Field TYPE resolution for value-table rendering: a value table's fieldId → the field's
    // type name ("Dropdown", "Checkbox", …), one relation hop into CaseFieldTypes. Both CaseFields
    // and ResultFields point their `type` relation at CaseFieldTypes, so the shape is identical.
    if (table === "CaseFieldType" || table === "ResultFieldType") {
      const delegate =
        table === "ResultFieldType" ? "resultFields" : "caseFields";
      const row = await db[delegate].findUnique({
        where: { id: Number(id) },
        select: { type: { select: { type: true } } },
      });
      return (row?.type?.type as string | undefined) ?? null;
    }
    const meta = delegates[table];
    if (!meta) {
      return null;
    }
    const row = await db[meta.delegate].findUnique({
      where: { id: meta.stringId ? String(id) : Number(id) },
      select: { [meta.field]: true },
    });
    return (row?.[meta.field] as string | undefined) ?? null;
  };
}
