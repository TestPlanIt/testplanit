/**
 * Idempotent trigger DDL applier — the SOLE source of audit trigger DDL (CAP-02).
 *
 * Generalizes the proven Phase 12 spike applier (prisma/spike/apply-spike-trigger.ts) from a
 * single hard-coded table to the full TRIGGER_REGISTRY. Run on every `pnpm generate` and from
 * the deploy entrypoint AFTER `prisma db push` (which silently drops triggers), so the audit
 * substrate is re-attached on every schema sync.
 *
 * In order, against a DIRECT (pooler-bypassing) connection, it:
 *   1. resolves DIRECT_DATABASE_URL ?? DATABASE_URL,
 *   2. asserts the registry is safe (no prohibited table),
 *   3. executes prisma/audit_row_change.sql (CREATE OR REPLACE FUNCTION — idempotent),
 *   4. attaches one tpl_audit_<table> trigger per registry entry (DROP IF EXISTS + CREATE),
 *   5. installs the append-only ENFORCEMENT triggers on DataChangeLog regardless of ownership
 *      (the REAL SAF-03 guarantee — a BEFORE DELETE and a BEFORE UPDATE trigger that RAISE a
 *      42501 privilege error; the BEFORE UPDATE trigger allows worker-cursor-only updates),
 *   6. converges the GRANT/REVOKE as defense-in-depth — the connecting role keeps
 *      INSERT/SELECT/UPDATE/DELETE (the worker advances the processed cursor and the retention job
 *      purges rows), UPDATE/DELETE are revoked from PUBLIC, and the enforcement triggers above
 *      remain the real guard,
 *   7. self-checks: count(DISTINCT trigger_name) over tpl_audit_% against the registry length, and
 *      asserts the connecting role holds INSERT/SELECT/UPDATE/DELETE on DataChangeLog.
 *
 * Run:  cd testplanit && tsx scripts/apply-triggers.ts
 * Safe to run repeatedly — every function/trigger is CREATE OR REPLACE / DROP IF EXISTS first.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import {
  TRIGGER_REGISTRY,
  DEFAULT_DENYLIST,
  assertRegistrySafe,
} from "./trigger-registry";
import { ROLLUP_MAP } from "../lib/audit/rollupMap";

/**
 * Locate prisma/audit_row_change.sql robustly. `__dirname` is correct under tsx (scripts/), but when
 * this module is imported from the running app (the instrumentation boot hook) it may be bundled and
 * `__dirname` repointed, so we also try the process working directory and the monorepo layout. First
 * existing candidate wins; otherwise fall back to the original path so readFileSync raises a clear
 * ENOENT.
 */
function resolveAuditFnSqlPath(): string {
  const candidates = [
    join(process.cwd(), "prisma", "audit_row_change.sql"),
    join(__dirname, "..", "prisma", "audit_row_change.sql"),
    join(process.cwd(), "testplanit", "prisma", "audit_row_change.sql"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/**
 * Session-level advisory-lock key for the apply critical section. Concurrent runners — e.g. two app
 * replicas hitting the instrumentation boot hook at once — serialize on this so their parallel
 * DROP/CREATE TRIGGER churn cannot deadlock on the system catalogs. Auto-released on disconnect.
 */
const APPLY_TRIGGERS_LOCK_KEY = 798_113_001;

export interface ApplyAuditTriggersOptions {
  /** Connection string override. Defaults to DIRECT_DATABASE_URL ?? DATABASE_URL. */
  connectionString?: string;
  /** Serialize concurrent runners with a session advisory lock. Default true. */
  lock?: boolean;
  /** Log sink. Defaults to console.log; pass () => {} to silence. */
  log?: (message: string) => void;
}

/** tpl_audit_<lowercased table, non-alphanumeric → _>. Must match the drift test transform. */
function triggerNameFor(table: string): string {
  return "tpl_audit_" + table.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Append-only ENFORCEMENT for DataChangeLog. These BEFORE triggers RAISE a 42501 privilege error
 * regardless of table ownership or grant state — they are the real SAF-03 guarantee, not the
 * GRANT/REVOKE below. Because the triggers enforce integrity, the grant layer is free to leave the
 * connecting role holding UPDATE/DELETE: the worker needs UPDATE to advance the processed cursor
 * and DELETE to run the retention purge, and these triggers still reject every other mutation. The
 * BEFORE UPDATE path allows worker-cursor-only updates (processed/processedAt): subtracting a
 * not-yet-existent key from jsonb is a harmless no-op, future-proofing the Phase 14 worker cursor.
 *
 * DELETE carve-out: unprocessed rows (processed = false) are immutable and cannot be deleted;
 * processed rows (processed = true) may be pruned by the retention job. This is DB-enforced,
 * not app-trust — the retention worker's WHERE processed = true is a belt, this trigger is a
 * suspender: a bug in the worker that omits the filter still hits RAISE here.
 */
const APPEND_ONLY_ENFORCEMENT_SQL = `
CREATE OR REPLACE FUNCTION datachangelog_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.processed = false THEN
      RAISE EXCEPTION 'DataChangeLog is append-only: DELETE of unprocessed rows not permitted' USING ERRCODE = 'insufficient_privilege'; -- 42501
    END IF;
    RETURN OLD; -- processed = true rows may be pruned by the retention job
  END IF;
  -- UPDATE: only the worker-cursor columns (processed/processedAt) may change; everything else is rejected.
  IF (to_jsonb(OLD) - 'processed' - 'processedAt') IS DISTINCT FROM (to_jsonb(NEW) - 'processed' - 'processedAt') THEN
    RAISE EXCEPTION 'DataChangeLog is append-only: UPDATE not permitted' USING ERRCODE = 'insufficient_privilege'; -- 42501
  END IF;
  RETURN NEW; -- worker-cursor-only update (e.g. processed = true) is allowed
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tpl_dcl_no_delete ON "DataChangeLog";
CREATE TRIGGER tpl_dcl_no_delete BEFORE DELETE ON "DataChangeLog"
  FOR EACH ROW EXECUTE FUNCTION datachangelog_append_only();

DROP TRIGGER IF EXISTS tpl_dcl_no_update ON "DataChangeLog";
CREATE TRIGGER tpl_dcl_no_update BEFORE UPDATE ON "DataChangeLog"
  FOR EACH ROW EXECUTE FUNCTION datachangelog_append_only();
`;

/**
 * Defense-in-depth ONLY — NOT the append-only guarantee; the tpl_dcl_* enforcement triggers above
 * are the real guard. Converges on a working grant set on every run: the connecting role keeps the
 * full INSERT/SELECT/UPDATE/DELETE it needs (the worker sets processed = true and the retention job
 * DELETEs pruned rows), while UPDATE/DELETE are revoked from PUBLIC so no unprivileged role can
 * touch the log.
 *
 * Earlier revisions revoked UPDATE/DELETE from CURRENT_USER on the false premise that the
 * connecting role always owns the table, so the REVOKE would be a no-op (an owner's implicit rights
 * survive a REVOKE). In prod the runtime role is NOT the table owner, so that REVOKE actually
 * stripped the worker's UPDATE/DELETE and silently stalled the CDC cursor and the retention purge.
 * Integrity is unaffected either way: the enforcement triggers reject every non-cursor mutation
 * regardless of grant state, so granting these privileges back is safe.
 */
const APPEND_ONLY_GRANT_SQL = `
GRANT INSERT, SELECT, UPDATE, DELETE ON "DataChangeLog" TO CURRENT_USER;
REVOKE UPDATE, DELETE ON "DataChangeLog" FROM PUBLIC; -- defense-in-depth without touching the owner/worker; the tpl_dcl_* enforcement triggers are the real guarantee
`;

/**
 * CDC idempotency: the conflict target for the worker's INSERT ... ON CONFLICT DO NOTHING.
 * A partial unique index (WHERE operationId IS NOT NULL) makes the auditLogWorker's
 * DataChangeLog → AuditLog materialization restart-safe — a mid-batch crash that re-reads
 * the same unprocessed rows cannot duplicate AuditLog rows (research Pitfall A/H). Semantic
 * events (operationId null) are excluded from the index (BullMQ handles their at-least-once).
 * Not expressible as a Prisma @@unique (partial WHERE clause), so it lives here as raw DDL.
 */
const CDC_IDEMPOTENCY_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_cdc_idempotency
  ON "AuditLog" ("operationId", "sourceTable", "entityId", "action")
  WHERE "operationId" IS NOT NULL;
`;

/**
 * Apply the full audit-trigger substrate to one database, idempotently. Importable so the app can
 * self-install on boot (see lib/audit/ensureAuditTriggers + instrumentation.ts) in addition to the
 * CLI / deploy-entrypoint paths — `prisma db push` silently drops these triggers, so they must be
 * re-attached on every schema sync AND on every app start, regardless of how the app is launched.
 */
export async function applyAuditTriggers(
  opts: ApplyAuditTriggersOptions = {}
): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const useLock = opts.lock ?? true;
  const connectionString =
    opts.connectionString ??
    process.env.DIRECT_DATABASE_URL ??
    process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Set DIRECT_DATABASE_URL (preferred — bypasses pgbouncer for DDL) or DATABASE_URL before applying audit triggers."
    );
  }
  const usingDirect = Boolean(
    opts.connectionString ?? process.env.DIRECT_DATABASE_URL
  );

  // Fail fast before connecting if a prohibited table slipped into the registry.
  assertRegistrySafe();

  const auditFnSql = readFileSync(resolveAuditFnSqlPath(), "utf8");

  const client = new Client({ connectionString });
  await client.connect();
  let locked = false;
  try {
    // 0. Serialize concurrent appliers (multiple booting replicas) so their DROP/CREATE TRIGGER
    //    churn can't deadlock. Session-level lock; auto-released on disconnect, unlocked in finally.
    if (useLock) {
      await client.query("SELECT pg_advisory_lock($1::bigint)", [
        APPLY_TRIGGERS_LOCK_KEY,
      ]);
      locked = true;
    }

    // 1. Generic trigger function (CREATE OR REPLACE — idempotent).
    await client.query(auditFnSql);

    // 2. One audit trigger per registry entry (DROP IF EXISTS + CREATE — idempotent).
    for (const entry of TRIGGER_REGISTRY) {
      const triggerName = triggerNameFor(entry.table);
      const pkCol = entry.pkCol ?? "id";
      const denylistCsv = (entry.denylist ?? DEFAULT_DENYLIST).join(",");
      // Write-time name/project snapshot columns (empty string = none for this table).
      const nameCol = entry.nameCol ?? "";
      const projectCol = entry.projectCol ?? "";
      // Columns the trigger captures on EVERY update even when unchanged, so a value-only child
      // edit still carries the ids correlation needs. The rollup FK (from ROLLUP_MAP) lets the row
      // attribute to its owner instead of falling back to its own pk; the per-table captureCols
      // (e.g. a value table's fieldId) say WHICH sub-entity changed so correlation can render
      // "Priority: Medium → High" instead of a bare "value: 3 → 2". Deduped, comma-separated.
      const captureCols = [
        ...new Set(
          [ROLLUP_MAP[entry.table]?.fkCol, ...(entry.captureCols ?? [])].filter(
            (c): c is string => !!c
          )
        ),
      ].join(",");

      // Identifiers/args come ONLY from the static in-repo registry — no user input in this DDL.
      await client.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON "${entry.table}";`
      );
      await client.query(
        `CREATE TRIGGER ${triggerName}
           AFTER INSERT OR UPDATE OR DELETE ON "${entry.table}"
           FOR EACH ROW EXECUTE FUNCTION audit_row_change('${pkCol}', '${denylistCsv}', '${nameCol}', '${projectCol}', '${captureCols}');`
      );
    }

    // 2b. Drop orphaned audit triggers — tables removed from the registry. Without this a removed
    //     entry leaves its tpl_audit_* trigger live (still writing DataChangeLog) and fails the
    //     drift self-check below. This keeps the live trigger set in exact lockstep with the registry.
    const expectedTriggerNames = new Set(
      TRIGGER_REGISTRY.map((e) => triggerNameFor(e.table))
    );
    const { rows: liveAuditTriggers } = await client.query<{
      trigger_name: string;
      event_object_table: string;
    }>(
      `SELECT DISTINCT trigger_name, event_object_table
         FROM information_schema.triggers
        WHERE trigger_name LIKE 'tpl_audit_%'`
    );
    for (const t of liveAuditTriggers) {
      if (!expectedTriggerNames.has(t.trigger_name)) {
        await client.query(
          `DROP TRIGGER IF EXISTS ${t.trigger_name} ON "${t.event_object_table}";`
        );
        log(
          `[apply-triggers] dropped orphaned trigger ${t.trigger_name} on "${t.event_object_table}"`
        );
      }
    }

    // 3. Append-only ENFORCEMENT triggers on DataChangeLog (the real SAF-03 guarantee).
    await client.query(APPEND_ONLY_ENFORCEMENT_SQL);

    // 4. GRANT/REVOKE defense-in-depth: the connecting role keeps INSERT/SELECT/UPDATE/DELETE (the
    //    worker cursor + retention purge need UPDATE/DELETE); UPDATE/DELETE revoked from PUBLIC. The
    //    tpl_dcl_* enforcement triggers guard integrity regardless of grant state.
    await client.query(APPEND_ONLY_GRANT_SQL);

    // 5. CDC idempotency partial unique index on AuditLog (CREATE ... IF NOT EXISTS — idempotent).
    //    The drift self-check below counts only tpl_audit_* triggers, so this index does not affect it.
    await client.query(CDC_IDEMPOTENCY_INDEX_SQL);

    // 6. Drift self-check: count DISTINCT tpl_audit_* triggers (the tpl_dcl_* enforcement
    //    triggers are intentionally excluded by the tpl_audit_% prefix) and assert == registry length.
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(DISTINCT trigger_name)::int AS n
         FROM information_schema.triggers
        WHERE trigger_name LIKE 'tpl_audit_%'`
    );
    const liveCount = rows[0]?.n ?? 0;
    if (liveCount !== TRIGGER_REGISTRY.length) {
      const { rows: present } = await client.query<{ trigger_name: string }>(
        `SELECT DISTINCT trigger_name
           FROM information_schema.triggers
          WHERE trigger_name LIKE 'tpl_audit_%'`
      );
      const presentNames = new Set(present.map((r) => r.trigger_name));
      const expectedNames = TRIGGER_REGISTRY.map((e) =>
        triggerNameFor(e.table)
      );
      const missing = expectedNames.filter((n) => !presentNames.has(n));
      const extra = [...presentNames].filter((n) => !expectedNames.includes(n));
      console.error(
        `[apply-triggers] DRIFT: live tpl_audit_* count ${liveCount} != registry ${TRIGGER_REGISTRY.length}.`
      );
      if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra:   ${extra.join(", ")}`);
      throw new Error(
        "Trigger drift detected after apply (see missing/extra above)."
      );
    }

    // 6b. Grant self-check: assert the connecting role can actually INSERT/SELECT/UPDATE/DELETE on
    //     DataChangeLog. The worker needs UPDATE (advance the processed cursor) and DELETE (retention
    //     purge); a regression that revokes either from this role would silently stall CDC, so fail
    //     loudly here instead. has_table_privilege reflects effective rights (owner-implicit OR an
    //     explicit GRANT), so this passes whether or not the connecting role owns the table.
    const { rows: grantRows } = await client.query<{
      ins: boolean;
      sel: boolean;
      upd: boolean;
      del: boolean;
    }>(
      `SELECT has_table_privilege('"DataChangeLog"', 'INSERT') AS ins,
              has_table_privilege('"DataChangeLog"', 'SELECT') AS sel,
              has_table_privilege('"DataChangeLog"', 'UPDATE') AS upd,
              has_table_privilege('"DataChangeLog"', 'DELETE') AS del`
    );
    const grant = grantRows[0];
    const missingPrivs = (
      [
        ["INSERT", grant?.ins],
        ["SELECT", grant?.sel],
        ["UPDATE", grant?.upd],
        ["DELETE", grant?.del],
      ] as const
    )
      .filter(([, held]) => !held)
      .map(([priv]) => priv);
    if (missingPrivs.length) {
      throw new Error(
        `[apply-triggers] GRANT regression: the connecting role lacks ${missingPrivs.join(", ")} ` +
          `on DataChangeLog (the audit worker needs UPDATE for the processed cursor and DELETE for retention).`
      );
    }

    log(
      `[apply-triggers] applied audit_row_change() + ${TRIGGER_REGISTRY.length} tpl_audit_* triggers ` +
        `+ DataChangeLog append-only enforcement (tpl_dcl_no_delete/tpl_dcl_no_update) + GRANT/REVOKE defense-in-depth ` +
        `+ AuditLog CDC idempotency index (audit_log_cdc_idempotency) ` +
        `(idempotent, via ${usingDirect ? "DIRECT_DATABASE_URL" : "DATABASE_URL"}).`
    );
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [
          APPLY_TRIGGERS_LOCK_KEY,
        ]);
      } catch {
        // Best-effort: the session advisory lock is released on disconnect anyway.
      }
    }
    await client.end();
  }
}

async function main() {
  await applyAuditTriggers();
}

// CLI entry only — guarded so importing applyAuditTriggers() (e.g. the instrumentation boot hook)
// never auto-runs the apply or calls process.exit. `require.main` is undefined when bundled.
if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error("[apply-triggers] apply failed:", err);
    process.exit(1);
  });
}
