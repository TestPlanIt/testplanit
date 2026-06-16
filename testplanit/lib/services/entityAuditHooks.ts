import { auditEntity, ENTITY_NAME_FIELDS, extractEntityName } from "./auditLog";

/**
 * Minimal delegate surface the hooks need: a findUnique that accepts an
 * optional include/select. Matches the shape of a Prisma model delegate and is
 * injected so the hooks are unit-testable without a database (mirrors
 * ConfigAuditDelegate in configAuditHooks.ts).
 */
export interface EntityAuditDelegate {
  findUnique(args: {
    where: unknown;
    include?: unknown;
    select?: unknown;
  }): Promise<Record<string, unknown> | null>;
}

/** The model's own delegate plus, for join/link models, the related model's. */
export interface EntityAuditDeps {
  self: EntityAuditDelegate;
  related?: EntityAuditDelegate;
}

/** One model wired into buildEntityAuditHooks. */
export interface EntityAuditModel {
  /** Audit entityType (PascalCase); must be an ENTITY_NAME_FIELDS key. */
  entityType: string;
  /** Prisma client accessor (camelCase) — the `$extends` query key. */
  accessor: string;
  /** Forward the row's projectId to the audit entry when present. */
  hasProjectId?: boolean;
  /**
   * For join/link models whose display name comes from a relation (an
   * ENTITY_NAME_FIELDS entry in `relation.field` dot-notation): the Prisma
   * delegate key of that related model. Used to resolve the name by FK on
   * CREATE — the just-created join row cannot be safely re-read inside an
   * enclosing interactive transaction (a separate connection would not see the
   * uncommitted row), but the related row already exists and is committed, so a
   * FK lookup is always safe.
   */
  relatedAccessor?: string;
}

/**
 * Entity models whose audit rows were previously written from a partial
 * `select: { id: true }` mutation result on the ZenStack RPC path — yielding a
 * blank entityName and a degenerate `{ id }`-only change diff. Unlike the
 * admin-config catalog models (AUDITED_CONFIG_MODELS), these are NOT registered
 * with the RPC route's audit shim, so the generic `$extends` hook is their sole
 * audit path on both the RPC and direct-Prisma routes. The factory below
 * repairs the name + diff on every path using only pre-reads and committed FK
 * lookups, so it stays correct even when the mutation runs inside an
 * interactive transaction.
 */
export const ENTITY_AUDIT_MODELS: EntityAuditModel[] = [
  { entityType: "Integration", accessor: "integration" },
  { entityType: "PromptConfig", accessor: "promptConfig" },
  {
    entityType: "ProjectIntegration",
    accessor: "projectIntegration",
    hasProjectId: true,
    relatedAccessor: "integration",
  },
  {
    entityType: "TestRunCases",
    accessor: "testRunCases",
    relatedAccessor: "repositoryCases",
  },
];

interface QueryContext {
  args: any;
  query: (args: any) => Promise<any>;
}
type QueryHook = (ctx: QueryContext) => Promise<any>;

/** Parse a dot-notation ENTITY_NAME_FIELDS entry into its relation + field. */
function parseRelationName(
  entityType: string
): { relationKey: string; nameField: string } | null {
  const cfg = ENTITY_NAME_FIELDS[entityType];
  if (typeof cfg === "string" && cfg.includes(".")) {
    const [relationKey, nameField] = cfg.split(".", 2);
    return { relationKey, nameField };
  }
  return null;
}

/**
 * Build create/update/delete audit hooks for one entity model. The display name
 * and diff are reconstructed without any post-mutation re-read (which would be
 * invisible inside an interactive transaction): UPDATE/DELETE pre-read the old
 * row (committed, always visible), and CREATE combines the returned row / input
 * with a committed FK lookup of the related entity for join/link models. Kept
 * free of Prisma client coupling (delegates injected) so it is unit-testable
 * without a database — mirrors buildConfigAuditHooks.
 */
export function buildEntityAuditHooks(
  cfg: EntityAuditModel,
  deps: EntityAuditDelegate | EntityAuditDeps
): Record<string, QueryHook> {
  // Accept either a bare delegate (named models) or a {self, related} pair.
  const { self, related } =
    "findUnique" in deps
      ? { self: deps as EntityAuditDelegate, related: undefined }
      : (deps as EntityAuditDeps);

  const relationName = parseRelationName(cfg.entityType);
  // Pre-read include that pulls ONLY the relation's name field — never the whole
  // related row, so secrets like Integration.credentials stay out of the read.
  const include = relationName
    ? {
        [relationName.relationKey]: {
          select: { [relationName.nameField]: true },
        },
      }
    : undefined;

  const projectIdOf = (row: any): number | undefined =>
    cfg.hasProjectId && typeof row?.projectId === "number"
      ? row.projectId
      : undefined;

  // Strip the included relation object so it never pollutes the scalar diff.
  const scalarsOf = (
    row: Record<string, unknown> | null | undefined
  ): Record<string, unknown> | null => {
    if (!row) return null;
    if (!relationName) return { ...row };
    const { [relationName.relationKey]: _relation, ...rest } = row;
    return rest;
  };

  const reread = (where: unknown) =>
    self.findUnique(include ? { where, include } : { where });

  // Resolve the related FK from create/update input or a returned scalar row,
  // supporting both the scalar (`integrationId`) and connect (`{connect:{id}}`)
  // shapes Prisma accepts.
  const fkOf = (...sources: any[]): unknown => {
    if (!relationName) return undefined;
    const fkField = `${relationName.relationKey}Id`;
    for (const src of sources) {
      if (src?.[fkField] != null) return src[fkField];
      const connectId = src?.[relationName.relationKey]?.connect?.id;
      if (connectId != null) return connectId;
    }
    return undefined;
  };

  // CREATE-time name for join models: look the pre-existing (committed) related
  // entity up by FK. Safe even inside an interactive transaction.
  const relatedNameByFk = async (
    ...sources: any[]
  ): Promise<string | undefined> => {
    if (!relationName || !related) return undefined;
    const fk = fkOf(...sources);
    if (fk == null) return undefined;
    const row = await related.findUnique({
      where: { id: fk },
      select: { [relationName.nameField]: true },
    });
    const value = row?.[relationName.nameField];
    return value != null ? String(value) : undefined;
  };

  const isFullRow = (row: any): boolean => !!row && Object.keys(row).length > 1;

  return {
    async create({ args, query }) {
      const result = await query(args);
      const id = result?.id;
      if (id == null) return result;

      // Off-RPC create returns the full scalar row; the RPC path returns only
      // { id }, in which case the create input carries the new values + FK.
      const newRow = scalarsOf(
        isFullRow(result) ? result : { ...args?.data, id }
      );

      const entityName = relationName
        ? await relatedNameByFk(result, args?.data)
        : (extractEntityName(cfg.entityType, result) ??
          extractEntityName(cfg.entityType, args?.data));

      await auditEntity({
        action: "CREATE",
        entityType: cfg.entityType,
        entityId: String(id),
        entityName,
        newRow,
        projectId: projectIdOf(result) ?? projectIdOf(args?.data),
      });
      return result;
    },

    async update({ args, query }) {
      const oldRow = args?.where ? await reread(args.where) : null;
      const result = await query(args);
      const id = result?.id ?? (oldRow as any)?.id;
      if (id == null) return result;

      // Off-RPC update returns the full new row; the RPC path returns { id }, so
      // apply the update input onto the old row to reconstruct the new state.
      const merged = isFullRow(result)
        ? { ...oldRow, ...result }
        : { ...oldRow, ...args?.data };

      const entityName = relationName
        ? extractEntityName(cfg.entityType, oldRow)
        : (extractEntityName(cfg.entityType, result) ??
          extractEntityName(cfg.entityType, args?.data) ??
          extractEntityName(cfg.entityType, oldRow));

      await auditEntity({
        action: "UPDATE",
        entityType: cfg.entityType,
        entityId: String(id),
        entityName,
        oldRow: scalarsOf(oldRow),
        newRow: scalarsOf(merged),
        projectId: projectIdOf(result) ?? projectIdOf(oldRow),
      });
      return result;
    },

    async delete({ args, query }) {
      const oldRow = args?.where ? await reread(args.where) : null;
      const result = await query(args);
      if (!oldRow) return result;

      await auditEntity({
        action: "DELETE",
        entityType: cfg.entityType,
        entityId: String((oldRow as any).id),
        entityName: extractEntityName(cfg.entityType, oldRow),
        oldRow: scalarsOf(oldRow),
        projectId: projectIdOf(oldRow),
      });
      return result;
    },
  };
}
