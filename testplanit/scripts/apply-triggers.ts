/**
 * Idempotent trigger DDL applier — the SOLE source of audit trigger DDL (CAP-02).
 *
 * Attaches one capture trigger per TRIGGER_REGISTRY entry (each writes "DataChangeLog") plus the
 * DataChangeLog append-only enforcement triggers and grants. `db push` silently DROPS these
 * triggers, and not every launch path re-runs the applier, so the substrate is re-attached from
 * three places — losing it means silent audit-capture loss with no error:
 *   - `pnpm generate` / `pnpm db:push`, immediately AFTER `db push` (every schema sync),
 *   - the deploy entrypoint (docker-entrypoint.sh), after db push,
 *   - the application's own boot, launch-agnostic, via the exported applyAuditTriggers() — called by
 *     lib/audit/ensureAuditTriggers from instrumentation.ts (web tier) and the audit-log worker
 *     (worker tier), so capture survives however the app is installed, updated, or relaunched.
 *
 * In order, against a DIRECT (pooler-bypassing) connection, it:
 *   1. resolves DIRECT_DATABASE_URL ?? DATABASE_URL,
 *   2. asserts the registry is safe (no prohibited table),
 *   3. executes db/audit_row_change.sql (CREATE OR REPLACE FUNCTION — idempotent),
 *   4. attaches one tpl_audit_<table> trigger per registry entry (DROP IF EXISTS + CREATE),
 *   5. installs the append-only ENFORCEMENT triggers on DataChangeLog regardless of ownership
 *      (the REAL SAF-03 guarantee — a BEFORE DELETE and a BEFORE UPDATE trigger that RAISE a
 *      42501 privilege error; the BEFORE UPDATE trigger allows worker-cursor-only updates),
 *   6. converges the GRANT/REVOKE as defense-in-depth — the connecting role keeps
 *      INSERT/SELECT/UPDATE/DELETE (the worker advances the processed cursor and the retention job
 *      purges rows), UPDATE/DELETE are revoked from PUBLIC, and the enforcement triggers above
 *      remain the real guard,
 *   7. self-checks: every registry entry's tpl_audit_% trigger is attached (strict lockstep with the
 *      registry, unless a table was skipped — see below), and asserts the connecting role holds
 *      INSERT/SELECT/UPDATE/DELETE on DataChangeLog.
 *
 * Cross-version boots: a registry entry whose table does not exist in the connected database (42P01)
 * is skipped with a warning rather than aborting the bootstrap, and any skip suppresses the
 * orphan-trigger cleanup and relaxes the drift check — the schema was migrated by a different release
 * channel, and its own triggers must not be treated as orphans.
 *
 * Run as a CLI:  cd testplanit && tsx scripts/apply-triggers.ts
 * Or import applyAuditTriggers() to apply from the running app. Safe to run repeatedly — every
 * function/trigger is CREATE OR REPLACE / DROP IF EXISTS first, and concurrent runners serialize on
 * a session advisory lock so parallel replica boots can't deadlock on the catalogs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import {
  TRIGGER_REGISTRY,
  SINGLE_DEFAULT_REGISTRY,
  SOFT_DELETE_REGISTRY,
  DEFAULT_DENYLIST,
  assertRegistrySafe,
} from "./trigger-registry";
import { ROLLUP_MAP } from "../lib/audit/rollupMap";

/**
 * Locate db/audit_row_change.sql robustly. `__dirname` is correct under tsx (scripts/), but when
 * this module is imported from the running app (the instrumentation boot hook) it may be bundled and
 * `__dirname` repointed, so we also try the process working directory and the monorepo layout. First
 * existing candidate wins; otherwise fall back to the original path so readFileSync raises a clear
 * ENOENT.
 */
function resolveAuditFnSqlPath(): string {
  const candidates = [
    join(process.cwd(), "db", "audit_row_change.sql"),
    join(__dirname, "..", "db", "audit_row_change.sql"),
    join(process.cwd(), "testplanit", "db", "audit_row_change.sql"),
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

/** tpl_single_default_<lowercased table>. Distinct prefix keeps these out of the tpl_audit_% drift check. */
function singleDefaultTriggerNameFor(table: string): string {
  return "tpl_single_default_" + table.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/** The single live-step-count trigger. Its own prefix keeps it out of the tpl_audit_% / tpl_single_default_% / tpl_stamp_deleted_at_% drift checks. */
const CASE_STEP_COUNT_TRIGGER = "tpl_case_step_count_steps";

/** tpl_stamp_deleted_at_<lowercased table>. Distinct prefix keeps these out of the tpl_audit_% / tpl_single_default_% drift checks. */
function stampDeletedAtTriggerNameFor(table: string): string {
  return (
    "tpl_stamp_deleted_at_" + table.toLowerCase().replace(/[^a-z0-9]/g, "_")
  );
}

/**
 * Business-rule trigger (NOT audit): enforce "at most one isDefault = true" per
 * table (optionally scoped by TG_ARGV[0]). Fires AFTER a row is set default and
 * clears the OTHER in-scope defaults in the same transaction — so exclusivity is
 * atomic and the app never has to run its own non-atomic clear-all. Excludes the
 * target row (`id <> NEW.id`), so re-saving an already-default row is a no-op.
 * The clear sets isDefault = false, and the WHEN clause fires only on TRUE, so
 * the trigger's own UPDATE never re-fires it (no recursion).
 */
const SINGLE_DEFAULT_FN_SQL = `
CREATE OR REPLACE FUNCTION tpl_enforce_single_default() RETURNS TRIGGER AS $$
DECLARE
  scope_col text := NULLIF(TG_ARGV[0], '');
  scope_val text;
BEGIN
  -- Only enforce when a row BECOMES default (INSERT with true, or an UPDATE
  -- transitioning false→true). Re-saving an already-default row (e.g. editing
  -- its name) must NOT clear sibling defaults — that would be a surprising side
  -- effect, and it lets a pre-existing multi-default state be reconciled
  -- explicitly rather than by an unrelated edit.
  IF TG_OP = 'UPDATE' AND OLD."isDefault" IS TRUE THEN
    RETURN NULL;
  END IF;
  IF scope_col IS NULL THEN
    EXECUTE format(
      'UPDATE %I SET "isDefault" = false WHERE "isDefault" = true AND "id" <> $1',
      TG_TABLE_NAME
    ) USING NEW."id";
  ELSE
    scope_val := to_jsonb(NEW) ->> scope_col;
    EXECUTE format(
      'UPDATE %I SET "isDefault" = false WHERE "isDefault" = true AND "id" <> $1 AND (%I)::text IS NOT DISTINCT FROM $2',
      TG_TABLE_NAME, scope_col
    ) USING NEW."id", scope_val;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Live step-count maintenance (a business rule, NOT audit). Keeps
 * `RepositoryCases."liveStepCount"` equal to the number of that case's `Steps` rows
 * with `isDeleted = false`.
 *
 * It exists because the repository/run list can sort by the Steps column, and
 * `orderBy: { steps: { _count } }` cannot take a `where` — ZenStack's
 * applyRelationOrderBy builds a correlated `count(1)` with only the join predicate,
 * so retired steps are counted and the sort disagrees with the number the column
 * shows. A denormalized scalar is the only form the ORM can sort by in BOTH the
 * repository and run lists (the ordered-page-ids pattern used for latestResults is
 * disabled in run mode).
 *
 * In the DB rather than app code because steps are written from many paths —
 * the step editor, bulk edit, CSV/Excel import, copy/move, the Testmo importer,
 * the shared-step conversion service, and one-off SQL scripts. A trigger cannot
 * drift; a counter maintained by hand in eight call sites will.
 *
 * AFTER INSERT/UPDATE/DELETE, and it recomputes rather than applying a delta:
 * recomputing is idempotent, so a re-run, a bulk `updateMany`, or a row moving
 * between cases can never accumulate error. Both the old and new `testCaseId` are
 * refreshed so a step reparented by an UPDATE settles both sides.
 */
const CASE_STEP_COUNT_FN_SQL = `
CREATE OR REPLACE FUNCTION tpl_refresh_case_step_count() RETURNS TRIGGER AS $$
DECLARE
  affected int[];
BEGIN
  affected := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."testCaseId" END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."testCaseId" END
    ]) AS x WHERE x IS NOT NULL
  );

  UPDATE "RepositoryCases" rc
     SET "liveStepCount" = COALESCE(s.cnt, 0)
    FROM unnest(affected) AS a(case_id)
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt FROM "Steps" st
       WHERE st."testCaseId" = a.case_id AND st."isDeleted" = false
    ) s ON true
   WHERE rc.id = a.case_id
     AND rc."liveStepCount" IS DISTINCT FROM COALESCE(s.cnt, 0);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
`;

/**
 * Soft-delete stamping (a business rule, NOT audit). Records WHEN a row was soft-deleted so a
 * retention/purge job has a timestamp to key off (Option A — additive alongside `isDeleted`, which
 * stays the queryable liveness flag). This is a BEFORE UPDATE trigger because it MODIFIES the row
 * being written (sets NEW."deletedAt") rather than running a side-effect UPDATE like the AFTER
 * business-rule/audit triggers.
 *
 * The attaching trigger is gated `WHEN (NEW."isDeleted" IS DISTINCT FROM OLD."isDeleted")`, so the
 * function body runs ONLY on an actual flip — a no-op re-save or any unrelated column update never
 * enters it (no overhead on hot write paths, and no risk of re-stamping an already-deleted row).
 * Given that gate, NEW."isDeleted" TRUE means false→true (stamp) and FALSE means true→false (restore,
 * clear). An explicit deletedAt supplied in the same flip write is respected (stamped only when NULL).
 * Deliberately UPDATE-only: a row INSERTed already-deleted keeps deletedAt NULL (a safe omission — the
 * purge job simply never sweeps a NULL-deletedAt row; it is not a wrong deletion time).
 */
const STAMP_DELETED_AT_FN_SQL = `
CREATE OR REPLACE FUNCTION tpl_stamp_deleted_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."isDeleted" IS TRUE THEN
    -- false -> true: stamp the deletion moment, unless the write set one explicitly.
    IF NEW."deletedAt" IS NULL THEN
      NEW."deletedAt" := now();
    END IF;
  ELSE
    -- true -> false (restore): the row is live again, so drop the tombstone timestamp.
    NEW."deletedAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`;

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
 * Execution-start composition lock (BOR-1) — the authoritative DB-level guard.
 * When a TestRun is composition-locked (compositionLockedAt IS NOT NULL) its case
 * SET is frozen: no adding cases (INSERT) and no removing/reordering
 * (UPDATE of "isDeleted"/"order"). Execution and assignment writes (statusId,
 * iteration counts, assignedToId, notes, timestamps) are untouched — the UPDATE
 * trigger is scoped to the two composition columns, so those never reach here.
 *
 * Mirrors the ZenStack @@deny/@deny policy rules on TestRunCases and holds even
 * for raw SQL / baseDb / rawClient paths that bypass the ORM policy layer.
 *
 * Intentionally NOT a BEFORE DELETE guard: the app removes a case by
 * soft-deleting it (UPDATE "isDeleted" = true, caught above), never by hard
 * DELETE. Hard DELETE of a TestRunCases row happens only via ON DELETE CASCADE
 * (deleting the run or its repository case) or the retention purge — legitimate
 * operations a delete guard would wrongly block (the parent run row is still
 * visible mid-cascade and would look "locked"). The distinct tpl_composition_*
 * prefix keeps these out of the tpl_audit_% / tpl_single_default_% / tpl_stamp_%
 * drift checks.
 */
export const COMPOSITION_LOCK_GUARD_SQL = `
CREATE OR REPLACE FUNCTION tpl_composition_lock_guard() RETURNS TRIGGER AS $$
DECLARE
  locked timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "compositionLockedAt" INTO locked FROM "TestRuns" WHERE "id" = NEW."testRunId";
    IF locked IS NOT NULL THEN
      RAISE EXCEPTION 'Test run % composition is locked: cannot add cases', NEW."testRunId" USING ERRCODE = 'check_violation'; -- 23514
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE (fires only on "order"/"isDeleted" via UPDATE OF); re-check the value actually changed.
  IF NEW."order" IS DISTINCT FROM OLD."order"
     OR NEW."isDeleted" IS DISTINCT FROM OLD."isDeleted" THEN
    SELECT "compositionLockedAt" INTO locked FROM "TestRuns" WHERE "id" = NEW."testRunId";
    IF locked IS NOT NULL THEN
      RAISE EXCEPTION 'Test run % composition is locked: cannot add, remove, or reorder cases', NEW."testRunId" USING ERRCODE = 'check_violation'; -- 23514
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tpl_composition_lock_guard_ins ON "TestRunCases";
CREATE TRIGGER tpl_composition_lock_guard_ins BEFORE INSERT ON "TestRunCases"
  FOR EACH ROW EXECUTE FUNCTION tpl_composition_lock_guard();

DROP TRIGGER IF EXISTS tpl_composition_lock_guard_upd ON "TestRunCases";
CREATE TRIGGER tpl_composition_lock_guard_upd BEFORE UPDATE OF "order", "isDeleted" ON "TestRunCases"
  FOR EACH ROW EXECUTE FUNCTION tpl_composition_lock_guard();
`;

/**
 * Issue hierarchy cycle guard (HIER-03) — the authoritative DB-level guard against a
 * parentId write that would make an issue its own descendant. Fires for ALL Issue rows
 * unconditionally, not gated on the requirement-classification flag: a cycle is
 * structurally wrong for any hierarchy, and an issue's requirement classification can
 * change after its parent was set. This is the one enforcement point below every
 * client tier (policy, base, raw, psql, sync) — the declarative @deny policy layer
 * cannot express recursion.
 *
 * BEFORE INSERT: rejects only the self-parent case (parentId = id); a brand-new row
 * cannot already be an ancestor of anything else.
 *
 * BEFORE UPDATE of the parentId column: takes a transaction-scoped advisory lock
 * (pg_advisory_xact_lock) before walking ancestors. This is the only thing that closes
 * the concurrent-reparent race, where two sessions each reparent a different node so
 * that together they form a cycle — each statement's own ancestor walk can read a
 * snapshot that predates the other session's commit. The lock is deliberately NOT taken
 * on INSERT: a brand-new row cannot already be an ancestor of anything, and the
 * parentId foreign key itself already serializes the mutual-insert case by blocking on
 * the other transaction's uncommitted parent row. Do not "optimize" this lock away.
 *
 * The ancestor walk is a WITH RECURSIVE CTE capped at depth < 100 so malformed
 * pre-existing cyclic data errors out instead of hanging a connection inside a BEFORE
 * trigger.
 *
 * The distinct tpl_issue_hierarchy_* prefix keeps this out of the tpl_audit_% /
 * tpl_composition_% / tpl_single_default_% / tpl_stamp_% drift checks.
 */
export const ISSUE_HIERARCHY_CYCLE_GUARD_SQL = `
CREATE OR REPLACE FUNCTION tpl_issue_hierarchy_cycle_guard() RETURNS TRIGGER AS $$
DECLARE
  found_cycle boolean;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."parentId" = NEW.id THEN
    RAISE EXCEPTION 'Issue % cannot be its own parent', NEW.id USING ERRCODE = 'check_violation'; -- 23514
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM pg_advisory_xact_lock(hashtext('tpl_issue_hierarchy_cycle_guard'), 0);
  END IF;

  SELECT EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT "parentId" AS id, 1 AS depth FROM "Issue" WHERE id = NEW."parentId"
      UNION ALL
      SELECT i."parentId", a.depth + 1 FROM "Issue" i
      INNER JOIN ancestors a ON i.id = a.id
      WHERE i."parentId" IS NOT NULL AND a.depth < 100
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) INTO found_cycle;

  IF found_cycle THEN
    RAISE EXCEPTION 'Reparenting issue % under % would create a cycle', NEW.id, NEW."parentId" USING ERRCODE = 'check_violation'; -- 23514
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tpl_issue_hierarchy_cycle_guard_ins ON "Issue";
CREATE TRIGGER tpl_issue_hierarchy_cycle_guard_ins BEFORE INSERT ON "Issue"
  FOR EACH ROW EXECUTE FUNCTION tpl_issue_hierarchy_cycle_guard();

DROP TRIGGER IF EXISTS tpl_issue_hierarchy_cycle_guard_upd ON "Issue";
CREATE TRIGGER tpl_issue_hierarchy_cycle_guard_upd BEFORE UPDATE OF "parentId" ON "Issue"
  FOR EACH ROW EXECUTE FUNCTION tpl_issue_hierarchy_cycle_guard();
`;

/**
 * Apply the full audit-trigger substrate to one database, idempotently. Importable so the app can
 * self-install on boot (see lib/audit/ensureAuditTriggers + instrumentation.ts) in addition to the
 * CLI / deploy-entrypoint paths — `db push` silently drops these triggers, so they must be
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
    //    A registry entry whose TABLE does not exist (42P01) is skipped with a warning
    //    instead of aborting the whole bootstrap: this code may boot against a database
    //    migrated by a different release channel (e.g. a main-era checkout on a DB whose
    //    implicit m2m tables became explicit models), and one phantom entry must not cost
    //    the remaining tables their re-attach. Skips flip the applier into a conservative
    //    cross-version mode: see the orphan-drop and drift-check gates below.
    const skippedMissingTables: string[] = [];
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
      try {
        await client.query(
          `DROP TRIGGER IF EXISTS ${triggerName} ON "${entry.table}";`
        );
        await client.query(
          `CREATE TRIGGER ${triggerName}
             AFTER INSERT OR UPDATE OR DELETE ON "${entry.table}"
             FOR EACH ROW EXECUTE FUNCTION audit_row_change('${pkCol}', '${denylistCsv}', '${nameCol}', '${projectCol}', '${captureCols}');`
        );
      } catch (err) {
        if ((err as { code?: string }).code === "42P01") {
          skippedMissingTables.push(entry.table);
          log(
            `[apply-triggers] WARNING: table "${entry.table}" does not exist in this database — skipping its audit trigger (schema/registry version mismatch?)`
          );
          continue;
        }
        throw err;
      }
    }

    // 2b. Drop orphaned audit triggers — tables removed from the registry. Without this a removed
    //     entry leaves its tpl_audit_* trigger live (still writing DataChangeLog) and fails the
    //     drift self-check below. This keeps the live trigger set in exact lockstep with the registry.
    //
    //     GATED on zero skips above: a skipped entry means this code's registry does not match the
    //     database's schema (cross-version boot), so a trigger this registry doesn't know is NOT an
    //     orphan — it is live capture belonging to the schema's own release (e.g. beta's explicit
    //     RepositoryCaseTag trigger, seen from a main-era registry). Dropping it would silently
    //     lose capture until the matching release next boots. In mismatch mode only ADD, never remove.
    if (skippedMissingTables.length === 0) {
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
    } else {
      log(
        `[apply-triggers] WARNING: ${skippedMissingTables.length} registry table(s) missing from this database (${skippedMissingTables.join(", ")}) — skipping orphan-trigger cleanup (cross-version boot; leaving unrecognized triggers in place)`
      );
    }

    // 2c. Single-default enforcement (business rule). CREATE OR REPLACE the shared
    //     function, then attach one tpl_single_default_<table> trigger per entry and
    //     drop orphans. Distinct prefix keeps these out of the tpl_audit_% drift check.
    await client.query(SINGLE_DEFAULT_FN_SQL);
    for (const entry of SINGLE_DEFAULT_REGISTRY) {
      const triggerName = singleDefaultTriggerNameFor(entry.table);
      const scopeArg = entry.scopeCol ?? "";
      await client.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON "${entry.table}";`
      );
      await client.query(
        `CREATE TRIGGER ${triggerName}
           AFTER INSERT OR UPDATE OF "isDefault" ON "${entry.table}"
           FOR EACH ROW WHEN (NEW."isDefault" IS TRUE)
           EXECUTE FUNCTION tpl_enforce_single_default('${scopeArg}');`
      );
    }
    const expectedSingleDefault = new Set(
      SINGLE_DEFAULT_REGISTRY.map((e) => singleDefaultTriggerNameFor(e.table))
    );
    const { rows: liveSingleDefault } = await client.query<{
      trigger_name: string;
      event_object_table: string;
    }>(
      `SELECT DISTINCT trigger_name, event_object_table
         FROM information_schema.triggers
        WHERE trigger_name LIKE 'tpl_single_default_%'`
    );
    for (const t of liveSingleDefault) {
      if (!expectedSingleDefault.has(t.trigger_name)) {
        await client.query(
          `DROP TRIGGER IF EXISTS ${t.trigger_name} ON "${t.event_object_table}";`
        );
        log(
          `[apply-triggers] dropped orphaned single-default trigger ${t.trigger_name} on "${t.event_object_table}"`
        );
      }
    }

    // 2d. Soft-delete deletedAt stamping (business rule). CREATE OR REPLACE the shared function, then
    //     attach one tpl_stamp_deleted_at_<table> BEFORE UPDATE OF "isDeleted" trigger per entry and
    //     drop orphans. The WHEN gate fires the function only on a real isDeleted flip. Distinct prefix
    //     keeps these out of the tpl_audit_% / tpl_single_default_% drift checks.
    await client.query(STAMP_DELETED_AT_FN_SQL);
    for (const entry of SOFT_DELETE_REGISTRY) {
      const triggerName = stampDeletedAtTriggerNameFor(entry.table);
      await client.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON "${entry.table}";`
      );
      await client.query(
        `CREATE TRIGGER ${triggerName}
           BEFORE UPDATE OF "isDeleted" ON "${entry.table}"
           FOR EACH ROW WHEN (NEW."isDeleted" IS DISTINCT FROM OLD."isDeleted")
           EXECUTE FUNCTION tpl_stamp_deleted_at();`
      );
    }
    const expectedStampDeletedAt = new Set(
      SOFT_DELETE_REGISTRY.map((e) => stampDeletedAtTriggerNameFor(e.table))
    );
    const { rows: liveStampDeletedAt } = await client.query<{
      trigger_name: string;
      event_object_table: string;
    }>(
      `SELECT DISTINCT trigger_name, event_object_table
         FROM information_schema.triggers
        WHERE trigger_name LIKE 'tpl_stamp_deleted_at_%'`
    );
    for (const t of liveStampDeletedAt) {
      if (!expectedStampDeletedAt.has(t.trigger_name)) {
        await client.query(
          `DROP TRIGGER IF EXISTS ${t.trigger_name} ON "${t.event_object_table}";`
        );
        log(
          `[apply-triggers] dropped orphaned stamp-deletedAt trigger ${t.trigger_name} on "${t.event_object_table}"`
        );
      }
    }

    // 2e. Live step-count maintenance (business rule). One trigger on "Steps" keeps
    //     RepositoryCases."liveStepCount" in step with the live rows so the Steps
    //     column can be sorted on (a relation _count orderBy cannot exclude retired
    //     steps). Its own prefix keeps it out of the three drift checks above.
    await client.query(CASE_STEP_COUNT_FN_SQL);
    await client.query(
      `DROP TRIGGER IF EXISTS ${CASE_STEP_COUNT_TRIGGER} ON "Steps";`
    );
    await client.query(
      `CREATE TRIGGER ${CASE_STEP_COUNT_TRIGGER}
         AFTER INSERT OR UPDATE OR DELETE ON "Steps"
         FOR EACH ROW EXECUTE FUNCTION tpl_refresh_case_step_count();`
    );
    // No reconciliation pass here: the column is populated once by the migration
    // that adds it, and this trigger keeps it in step from then on. If a `db push`
    // ever drops the trigger, steps written before the next apply leave stale
    // counts — recompute them with the UPDATE in that migration.

    // 3. Append-only ENFORCEMENT triggers on DataChangeLog (the real SAF-03 guarantee).
    await client.query(APPEND_ONLY_ENFORCEMENT_SQL);

    // 3b. Composition-lock ENFORCEMENT on TestRunCases (BOR-1). Idempotent
    //     CREATE OR REPLACE + DROP/CREATE TRIGGER. Distinct tpl_composition_*
    //     prefix keeps it out of every drift self-check below.
    await client.query(COMPOSITION_LOCK_GUARD_SQL);

    // 3c. Issue hierarchy cycle guard (HIER-03) — the authoritative DB-level guard
    //     against a parentId write that reparents an issue under its own descendant.
    //     Idempotent CREATE OR REPLACE + DROP/CREATE TRIGGER pair. Distinct
    //     tpl_issue_hierarchy_* prefix keeps it out of every drift self-check below,
    //     exactly like tpl_composition_* above.
    await client.query(ISSUE_HIERARCHY_CYCLE_GUARD_SQL);

    // 4. GRANT/REVOKE defense-in-depth: the connecting role keeps INSERT/SELECT/UPDATE/DELETE (the
    //    worker cursor + retention purge need UPDATE/DELETE); UPDATE/DELETE revoked from PUBLIC. The
    //    tpl_dcl_* enforcement triggers guard integrity regardless of grant state.
    await client.query(APPEND_ONLY_GRANT_SQL);

    // 5. CDC idempotency partial unique index on AuditLog (CREATE ... IF NOT EXISTS — idempotent).
    //    The drift self-check below counts only tpl_audit_* triggers, so this index does not affect it.
    await client.query(CDC_IDEMPOTENCY_INDEX_SQL);

    // 6. Drift self-check: count DISTINCT tpl_audit_* triggers (the tpl_dcl_* enforcement
    //    triggers are intentionally excluded by the tpl_audit_% prefix) and assert == registry length.
    //    In cross-version mode (skips above) the strict count is meaningless — skipped entries have
    //    no trigger and the schema's own release may hold triggers this registry doesn't know — so
    //    assert only that every NON-skipped entry's trigger is attached, and warn instead of throw
    //    on extras.
    const skippedNames = new Set(
      skippedMissingTables.map((t) => triggerNameFor(t))
    );
    const { rows: present } = await client.query<{ trigger_name: string }>(
      `SELECT DISTINCT trigger_name
         FROM information_schema.triggers
        WHERE trigger_name LIKE 'tpl_audit_%'`
    );
    const presentNames = new Set(present.map((r) => r.trigger_name));
    const expectedNames = TRIGGER_REGISTRY.map((e) => triggerNameFor(e.table));
    const missing = expectedNames.filter(
      (n) => !presentNames.has(n) && !skippedNames.has(n)
    );
    const extra = [...presentNames].filter((n) => !expectedNames.includes(n));
    if (missing.length) {
      console.error(
        `[apply-triggers] DRIFT: live tpl_audit_* count ${presentNames.size} != registry ${TRIGGER_REGISTRY.length}.`
      );
      console.error(`  missing: ${missing.join(", ")}`);
      if (extra.length) console.error(`  extra:   ${extra.join(", ")}`);
      throw new Error(
        "Trigger drift detected after apply (see missing/extra above)."
      );
    }
    if (extra.length) {
      if (skippedMissingTables.length === 0) {
        console.error(
          `[apply-triggers] DRIFT: live tpl_audit_* count ${presentNames.size} != registry ${TRIGGER_REGISTRY.length}.`
        );
        console.error(`  extra:   ${extra.join(", ")}`);
        throw new Error(
          "Trigger drift detected after apply (see missing/extra above)."
        );
      }
      log(
        `[apply-triggers] cross-version boot: leaving unrecognized trigger(s) in place: ${extra.join(", ")}`
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
      `[apply-triggers] applied audit_row_change() + ${TRIGGER_REGISTRY.length - skippedMissingTables.length} tpl_audit_* triggers` +
        (skippedMissingTables.length
          ? ` (${skippedMissingTables.length} skipped — tables missing in this database) `
          : " ") +
        `+ tpl_enforce_single_default() + ${SINGLE_DEFAULT_REGISTRY.length} tpl_single_default_* triggers ` +
        `+ tpl_stamp_deleted_at() + ${SOFT_DELETE_REGISTRY.length} tpl_stamp_deleted_at_* triggers ` +
        `+ tpl_refresh_case_step_count() + ${CASE_STEP_COUNT_TRIGGER} ` +
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

// CLI entry only. `require.main === module` is NOT safe here: esbuild inlines this file into the
// worker bundle (dist/workers/auditLogWorker.js), where `require.main === module` is TRUE for the
// bundle entry — so it would wrongly run the CLI, connect to the worker's placeholder DB, and crash
// it on a loop. Gate on the actual process entry-script path instead: argv[1] only contains
// "apply-triggers" when this is invoked directly as the CLI (tsx scripts/apply-triggers.ts), and
// never when bundled into auditLogWorker.js or the Next server.
const isCliEntry = /apply-triggers/.test(process.argv[1] ?? "");
if (isCliEntry) {
  main().catch((err) => {
    console.error("[apply-triggers] apply failed:", err);
    process.exit(1);
  });
}
