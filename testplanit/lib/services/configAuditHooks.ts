import {
  auditBulkCreate,
  auditBulkDelete,
  auditCreate,
  auditDelete,
  auditUpdate,
  type AuditedConfigModel,
} from "./auditLog";

/**
 * Minimal delegate surface the hooks need to capture pre-mutation state for
 * update/upsert/delete diffs. Matches the shape of a Prisma model delegate.
 */
export interface ConfigAuditDelegate {
  findUnique(args: { where: unknown }): Promise<Record<string, unknown> | null>;
}

interface QueryContext {
  args: any;
  query: (args: any) => Promise<any>;
}

type QueryHook = (ctx: QueryContext) => Promise<any>;

/**
 * Build the standard audit hook set for one admin-config model. Kept free of
 * any Prisma client coupling (the delegate is injected) so the behavior is
 * unit-testable without a database. Wired into the `lib/db.ts` `$extends`
 * block, one entry per AUDITED_CONFIG_MODELS row.
 *
 * - catalog: create + update + upsert + delete (update captures the
 *   soft-delete `isDeleted` flip; auditUpdate no-ops when nothing changed).
 * - join: the above plus createMany + deleteMany for the bulk assignment
 *   mutations the admin UI issues.
 */
export function buildConfigAuditHooks(
  cfg: AuditedConfigModel,
  delegate: ConfigAuditDelegate
): Record<string, QueryHook> {
  const projectIdOf = (row: any): number | undefined =>
    cfg.hasProjectId && typeof row?.projectId === "number"
      ? row.projectId
      : undefined;

  const hooks: Record<string, QueryHook> = {
    async create({ args, query }) {
      const result = await query(args);
      if (result) {
        await auditCreate(cfg.entityType, result, projectIdOf(result));
      }
      return result;
    },
    async update({ args, query }) {
      const oldEntity = args.where
        ? await delegate.findUnique({ where: args.where })
        : null;
      const result = await query(args);
      if (result) {
        await auditUpdate(
          cfg.entityType,
          oldEntity,
          result,
          projectIdOf(result)
        );
      }
      return result;
    },
    async upsert({ args, query }) {
      const oldEntity = args.where
        ? await delegate.findUnique({ where: args.where })
        : null;
      const result = await query(args);
      if (result) {
        if (oldEntity) {
          await auditUpdate(
            cfg.entityType,
            oldEntity,
            result,
            projectIdOf(result)
          );
        } else {
          await auditCreate(cfg.entityType, result, projectIdOf(result));
        }
      }
      return result;
    },
    async delete({ args, query }) {
      const oldEntity = args.where
        ? await delegate.findUnique({ where: args.where })
        : null;
      const result = await query(args);
      if (oldEntity) {
        await auditDelete(cfg.entityType, oldEntity, projectIdOf(oldEntity));
      }
      return result;
    },
  };

  if (cfg.kind === "join") {
    hooks.createMany = async ({ args, query }) => {
      const result = await query(args);
      if (result?.count > 0) {
        const projectId = cfg.hasProjectId
          ? args.data?.[0]?.projectId
          : undefined;
        await auditBulkCreate(cfg.entityType, result.count, projectId);
      }
      return result;
    };
    hooks.deleteMany = async ({ args, query }) => {
      const result = await query(args);
      if (result?.count > 0) {
        await auditBulkDelete(cfg.entityType, result.count, args.where);
      }
      return result;
    };
  }

  return hooks;
}
