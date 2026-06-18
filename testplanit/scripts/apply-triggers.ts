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
 *   5. installs the ownership-independent append-only ENFORCEMENT triggers on DataChangeLog
 *      (the REAL SAF-03 guarantee — a BEFORE DELETE and a BEFORE UPDATE trigger that RAISE a
 *      42501 privilege error; the BEFORE UPDATE trigger allows worker-cursor-only updates),
 *   6. applies the INSERT-only GRANT/REVOKE as documented defense-in-depth (a no-op for the
 *      table owner — the enforcement triggers above are the real guard),
 *   7. self-checks via count(DISTINCT trigger_name) over tpl_audit_% against the registry length.
 *
 * Run:  cd testplanit && tsx scripts/apply-triggers.ts
 * Safe to run repeatedly — every function/trigger is CREATE OR REPLACE / DROP IF EXISTS first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import {
  TRIGGER_REGISTRY,
  DEFAULT_DENYLIST,
  assertRegistrySafe,
} from "./trigger-registry";

const PRISMA_DIR = join(__dirname, "..", "prisma");
const AUDIT_FN_SQL = join(PRISMA_DIR, "audit_row_change.sql");

/** tpl_audit_<lowercased table, non-alphanumeric → _>. Must match the drift test transform. */
function triggerNameFor(table: string): string {
  return "tpl_audit_" + table.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Append-only ENFORCEMENT for DataChangeLog. Ownership-independent: `prisma db push` makes the
 * app role the table owner, and an owner keeps every privilege, so GRANT/REVOKE cannot revoke
 * the owner's UPDATE/DELETE. These BEFORE triggers RAISE a 42501 privilege error regardless of
 * ownership — they are the real SAF-03 guarantee. The BEFORE UPDATE path allows worker-cursor-
 * only updates (processed/processedAt): subtracting a not-yet-existent key from jsonb is a
 * harmless no-op, future-proofing the Phase 14 worker cursor.
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
 * Defense-in-depth ONLY — NOT the append-only guarantee. The app role OWNS the table (db push
 * creates it), and an owner retains all privileges, so this REVOKE is a documented no-op for the
 * owner. The tpl_dcl_* enforcement triggers above are the real guard.
 */
const APPEND_ONLY_GRANT_SQL = `
GRANT INSERT ON "DataChangeLog" TO CURRENT_USER;
REVOKE UPDATE, DELETE ON "DataChangeLog" FROM CURRENT_USER; -- no-op for the table owner; the tpl_dcl_* enforcement triggers are the real guarantee
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

async function main() {
  const usingDirect = Boolean(process.env.DIRECT_DATABASE_URL);
  const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Set DIRECT_DATABASE_URL (preferred — bypasses pgbouncer for DDL) or DATABASE_URL before running apply-triggers.",
    );
  }

  // Fail fast before connecting if a prohibited table slipped into the registry.
  assertRegistrySafe();

  const auditFnSql = readFileSync(AUDIT_FN_SQL, "utf8");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    // 1. Generic trigger function (CREATE OR REPLACE — idempotent).
    await client.query(auditFnSql);

    // 2. One audit trigger per registry entry (DROP IF EXISTS + CREATE — idempotent).
    for (const entry of TRIGGER_REGISTRY) {
      const triggerName = triggerNameFor(entry.table);
      const pkCol = entry.pkCol ?? "id";
      const denylistCsv = (entry.denylist ?? DEFAULT_DENYLIST).join(",");

      // Identifiers/args come ONLY from the static in-repo registry — no user input in this DDL.
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON "${entry.table}";`);
      await client.query(
        `CREATE TRIGGER ${triggerName}
           AFTER INSERT OR UPDATE OR DELETE ON "${entry.table}"
           FOR EACH ROW EXECUTE FUNCTION audit_row_change('${pkCol}', '${denylistCsv}');`,
      );
    }

    // 3. Append-only ENFORCEMENT triggers on DataChangeLog (the real SAF-03 guarantee).
    await client.query(APPEND_ONLY_ENFORCEMENT_SQL);

    // 4. INSERT-only GRANT/REVOKE as documented defense-in-depth (no-op for the table owner).
    await client.query(APPEND_ONLY_GRANT_SQL);

    // 5. CDC idempotency partial unique index on AuditLog (CREATE ... IF NOT EXISTS — idempotent).
    //    The drift self-check below counts only tpl_audit_* triggers, so this index does not affect it.
    await client.query(CDC_IDEMPOTENCY_INDEX_SQL);

    // 6. Drift self-check: count DISTINCT tpl_audit_* triggers (the tpl_dcl_* enforcement
    //    triggers are intentionally excluded by the tpl_audit_% prefix) and assert == registry length.
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(DISTINCT trigger_name)::int AS n
         FROM information_schema.triggers
        WHERE trigger_name LIKE 'tpl_audit_%'`,
    );
    const liveCount = rows[0]?.n ?? 0;
    if (liveCount !== TRIGGER_REGISTRY.length) {
      const { rows: present } = await client.query<{ trigger_name: string }>(
        `SELECT DISTINCT trigger_name
           FROM information_schema.triggers
          WHERE trigger_name LIKE 'tpl_audit_%'`,
      );
      const presentNames = new Set(present.map((r) => r.trigger_name));
      const expectedNames = TRIGGER_REGISTRY.map((e) => triggerNameFor(e.table));
      const missing = expectedNames.filter((n) => !presentNames.has(n));
      const extra = [...presentNames].filter((n) => !expectedNames.includes(n));
      console.error(
        `[apply-triggers] DRIFT: live tpl_audit_* count ${liveCount} != registry ${TRIGGER_REGISTRY.length}.`,
      );
      if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra:   ${extra.join(", ")}`);
      throw new Error("Trigger drift detected after apply (see missing/extra above).");
    }

    console.log(
      `[apply-triggers] applied audit_row_change() + ${TRIGGER_REGISTRY.length} tpl_audit_* triggers ` +
        `+ DataChangeLog append-only enforcement (tpl_dcl_no_delete/tpl_dcl_no_update) + INSERT-only GRANT ` +
        `+ AuditLog CDC idempotency index (audit_log_cdc_idempotency) ` +
        `(idempotent, via ${usingDirect ? "DIRECT_DATABASE_URL" : "DATABASE_URL"}).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[apply-triggers] apply failed:", err);
  process.exit(1);
});
