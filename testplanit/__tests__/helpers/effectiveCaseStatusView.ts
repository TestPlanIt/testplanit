import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_SQL_PATH = join(
  process.cwd(),
  "migrations/20260821180000_add_effective_case_status_view/migration.sql"
);

/**
 * Create the "EffectiveCaseStatus" view inside a rollback-scoped test
 * transaction, from the shipped migration file — so tests always exercise
 * the exact DDL production runs. Needed because the integration databases
 * are built with `zenstack db push`, which only materialises schema.zmodel
 * models; the view exists only via its migration. `CREATE OR REPLACE` makes
 * this a no-op-shaped statement on databases that already ran the migration,
 * and the surrounding rollback discards it either way.
 */
export async function ensureEffectiveCaseStatusView(tx: {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
}): Promise<void> {
  await tx.$executeRawUnsafe(readFileSync(MIGRATION_SQL_PATH, "utf8"));
}
