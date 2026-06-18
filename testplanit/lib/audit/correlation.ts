/**
 * COR-01 — the CDC consumer that makes the Phase 13 capture substrate readable.
 *
 * The Phase 13 triggers append one DataChangeLog row per INSERT/UPDATE/DELETE on the 23-table
 * allowlist. This module drains those rows into the user-facing AuditLog: it groups rows by
 * operationId (one logical save → one group), rolls each child/value/join row up to its owning
 * root entity via ROLLUP_MAP (COR-02), humanizes the FK ids in the diff to display names (COR-03),
 * maps an isDeleted false→true soft-delete to a DELETE action (Phase 12 Decision 4), and inserts
 * AuditLog rows idempotently. `pollDataChangeLogs(prisma, …)` runs the loop forever as the worker's
 * Loop B; `pollDataChangeLogsOnce(prisma, …)` does a single pass (the test + manual-drain entry).
 *
 * ── LOAD-BEARING INVARIANTS ────────────────────────────────────────────────────────────────────
 *  1. SOLE AUTHORIZED READER. DataChangeLog is `@@deny('all', true)` at the ZenStack policy layer.
 *     This module reads + marks it ONLY through the raw `prismaBase` client (passed in), which
 *     bypasses policy by design — the same raw-client pattern the existing AuditLog writes use. No
 *     other code path reads DataChangeLog. The `processed=true` UPDATE is the single sanctioned
 *     exception to Phase 13's append-only enforcement triggers (the worker-cursor write).
 *
 *  2. RESTART-SAFE + MULTI-REPLICA-SAFE. The unprocessed SELECT uses `FOR UPDATE SKIP LOCKED` and is
 *     wrapped — together with the `processed=true` UPDATE — in ONE `$transaction`. Autocommit would
 *     release the row locks immediately and let a second replica double-claim the same batch
 *     (research Pitfall B); the single transaction holds the locks for the batch's lifetime and
 *     commits the cursor advance atomically with the read.
 *
 *  3. CRASH-RESUME YIELDS ZERO DUPLICATES (criterion #5). The AuditLog INSERT(s) AND the
 *     `processed=true` UPDATE share the SAME transaction, so a crash rolls back BOTH — the source
 *     rows stay processed=false and are simply re-polled, with NO half-written AuditLog committed.
 *     This is the primary guarantee and covers ALL rows, including null-operationId singletons (the
 *     partial idempotency index only covers non-null operationId). Belt-and-suspenders: the INSERT
 *     also carries `ON CONFLICT (audit_log_cdc_idempotency: operationId, sourceTable, entityId,
 *     action) DO NOTHING`, so even a crash that somehow committed AuditLog before the cursor advance
 *     (or a re-run with markProcessed disabled, as the test simulates) cannot duplicate a non-null
 *     operationId row.
 *
 *  4. SPOOFABLE ATTRIBUTION (T-14-05-01, accepted). actor/operationId originate from the
 *     app.audit_context GUC, which a determined writer could set on their own transaction. AuditLog
 *     is the READABLE PROJECTION of the append-only DataChangeLog — a claim, not cryptographic
 *     proof. A spoofed actor/operationId only mis-attributes or mis-groups the spoofer's OWN writes;
 *     it grants no access. The append-only substrate is the integrity boundary, not this projection.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { ROLLUP_MAP, resolveTwoHop, type TwoHopRow } from "~/lib/audit/rollupMap";
import {
  createHumanizeCache,
  createPrismaLookup,
  humanize,
  type ChangedCols,
  type HumanizedCols,
} from "~/lib/audit/humanize";

/** Batch cap — keeps the FOR UPDATE SKIP LOCKED transaction small (research: ≤ 500). */
const DEFAULT_BATCH_SIZE = 500;
/** Idle sleep between empty polls. */
const DEFAULT_POLL_INTERVAL_MS = 500;
/** Humanization cache TTL (catalog data is infrequently updated). */
const HUMANIZE_TTL_MS = 60_000;

/**
 * A raw DataChangeLog row as returned by `SELECT *` (snake_case Postgres columns). BigInt columns
 * (id, seq, txid) arrive as `bigint` through node-postgres' default parser as configured by Prisma.
 */
interface RawDclRow {
  id: bigint | number | string;
  seq: bigint | number | string;
  table: string;
  op: string; // 'I' | 'U' | 'D'
  pk: string;
  changed_cols: ChangedCols | null;
  actor: string | null;
  operation_id: string | null;
  tenant: string | null;
  txid: bigint | number | string;
  ts: Date;
  processed: boolean;
}

/** A DataChangeLog row resolved to its owning root entity + humanized diff, ready for AuditLog. */
interface MaterializedRow {
  sourceRowId: bigint | number | string;
  sourceTable: string;
  op: string;
  /** The owning root entity table (self for root tables, the rollup ownerTable for children). */
  entityType: string;
  /** The owning root entity id (the row's own pk for root tables, the resolved FK for children). */
  entityId: string;
  action: AuditActionLiteral;
  actor: string | null;
  operationId: string | null;
  tenant: string | null;
  changes: HumanizedCols;
}

/** AuditAction values this worker emits (string literals — avoids a generated-enum import). */
type AuditActionLiteral = "CREATE" | "UPDATE" | "DELETE";

export interface PollOnceOptions {
  batchSize?: number;
  /**
   * When false, the AuditLog INSERTs commit but the `processed=true` cursor UPDATE is skipped. This
   * exists ONLY to let the crash-resume test simulate a worker that wrote AuditLog and then died
   * before advancing the cursor. Production callers leave it true (atomic insert + mark).
   */
  markProcessed?: boolean;
}

export interface PollOnceResult {
  processed: number;
  auditLogsWritten: number;
}

/**
 * Group raw rows by operationId. A null operationId is NOT a group key — each null-operationId row
 * is its OWN singleton group (otherwise unrelated null-op rows would collapse together). Non-null
 * operationIds group regardless of contiguity (research Pitfall G — concurrent saves can interleave
 * in seq order, so a Map keyed by operationId, not a contiguous run, is the correct grouping).
 */
export function groupByOperationId(rows: RawDclRow[]): RawDclRow[][] {
  const groups: RawDclRow[][] = [];
  const byOp = new Map<string, number>(); // operationId → index in groups
  for (const row of rows) {
    if (row.operation_id == null) {
      groups.push([row]); // singleton — never merged with other null-op rows
      continue;
    }
    const existing = byOp.get(row.operation_id);
    if (existing === undefined) {
      byOp.set(row.operation_id, groups.length);
      groups.push([row]);
    } else {
      groups[existing].push(row);
    }
  }
  return groups;
}

/**
 * Resolve every row in a group to its owning root entity (COR-02). Root tables (absent from
 * ROLLUP_MAP) attribute to themselves: entityType = the table, entityId = the row's own pk. Direct
 * rollups read the owning FK straight off the changed_cols diff (or are left attributed to the row's
 * own pk when the FK is not in the diff). Two-hop rollups are resolved in ONE batched lookup per
 * distinct intermediate FK value (research Pitfall F — no per-row N+1), via `resolveTwoHop` and the
 * injected `twoHopQuery`.
 */
export async function applyRollupMap(
  group: RawDclRow[],
  twoHopQuery: (
    hopTable: string,
    hopFkCol: string,
    fkValues: Array<number | string>,
  ) => Promise<TwoHopRow[]>,
): Promise<Array<{ row: RawDclRow; entityType: string; entityId: string }>> {
  const out: Array<{ row: RawDclRow; entityType: string; entityId: string }> = [];

  // Pre-resolve two-hop owners for the whole group in one query per distinct fk value set.
  const twoHopOwners = new Map<string, Map<number | string, number | string>>();
  const twoHopTables = new Set(
    group
      .map((r) => r.table)
      .filter((t) => {
        const cfg = ROLLUP_MAP[t];
        return cfg && cfg.twoHop === true;
      }),
  );
  for (const table of twoHopTables) {
    const cfg = ROLLUP_MAP[table];
    if (!cfg || cfg.twoHop !== true) continue;
    const fkValues = group
      .filter((r) => r.table === table)
      .map((r) => extractFk(r, cfg.fkCol))
      .filter((v): v is number | string => v !== null);
    twoHopOwners.set(table, await resolveTwoHop(cfg, fkValues, twoHopQuery));
  }

  for (const row of group) {
    const cfg = ROLLUP_MAP[row.table];
    if (!cfg) {
      // Root entity — attributes to itself.
      out.push({ row, entityType: row.table, entityId: row.pk });
      continue;
    }
    const fk = extractFk(row, cfg.fkCol);
    if (fk === null) {
      // FK not present in the diff — fall back to the row's own pk under its owner table so the
      // event is never silently dropped (a humanization/rollup miss must not lose the audit row).
      out.push({ row, entityType: cfg.ownerTable, entityId: row.pk });
      continue;
    }
    if (cfg.twoHop === true) {
      const owner = twoHopOwners.get(row.table)?.get(fk);
      out.push({
        row,
        entityType: cfg.ownerTable,
        entityId: owner != null ? String(owner) : String(fk),
      });
    } else {
      out.push({ row, entityType: cfg.ownerTable, entityId: String(fk) });
    }
  }
  return out;
}

/**
 * Pull a FK value for a rollup from a DataChangeLog row. The trigger records the FK inside
 * changed_cols only when it actually changed; for the common case (a child created/updated under a
 * stable parent) the FK is the `new` value of that column. Returns null when the FK column is not in
 * the diff (caller falls back to the row's own pk).
 */
function extractFk(row: RawDclRow, fkCol: string): number | string | null {
  const entry = row.changed_cols?.[fkCol];
  if (!entry) return null;
  const value = entry.new ?? entry.old;
  return value == null ? null : (value as number | string);
}

/**
 * Derive the AuditLog action. A soft-delete (op='U' with changed_cols.isDeleted {old:false →
 * new:true}) is surfaced as DELETE (Phase 12 Decision 4 — generic across any isDeleted table).
 * Otherwise: I→CREATE, U→UPDATE, D→DELETE.
 */
export function deriveAction(row: RawDclRow): AuditActionLiteral {
  if (row.op === "U") {
    const isDeleted = row.changed_cols?.isDeleted;
    // changed_cols stores isDeleted as a boolean JSON value; ChangedColEntry types old/new as
    // number|string|null, so compare against the raw (unknown-cast) values for the false→true flip.
    if (
      isDeleted &&
      (isDeleted.old as unknown) === false &&
      (isDeleted.new as unknown) === true
    ) {
      return "DELETE";
    }
    return "UPDATE";
  }
  return row.op === "I" ? "CREATE" : "DELETE";
}

/**
 * Insert the materialized rows into AuditLog inside the given transaction, idempotently. Each row is
 * a single INSERT carrying `ON CONFLICT (audit_log_cdc_idempotency columns) DO NOTHING` — a partial
 * unique index over (operationId, sourceTable, entityId, action) WHERE operationId IS NOT NULL — so
 * a re-poll over already-materialized non-null-operationId rows inserts nothing. Returns the count
 * actually inserted (conflicts return 0 rowcount). Uses raw SQL because the named partial-index
 * conflict arbiter is not expressible through the Prisma model API.
 */
export async function writeAuditLogRows(
  tx: RawTxClient,
  materialized: MaterializedRow[],
): Promise<number> {
  let written = 0;
  for (const m of materialized) {
    const changesJson = JSON.stringify(m.changes);
    const metadataJson = JSON.stringify({
      cdc: true,
      sourceTable: m.sourceTable,
      sourceRowId: String(m.sourceRowId),
      tenant: m.tenant,
    });
    // cuid()-style id is provided by a DB default? AuditLog.id has @default(cuid()) which Prisma
    // generates application-side, NOT in Postgres. For a raw INSERT we must supply the id, so use
    // gen_random_uuid()::text — a stable unique id; the idempotency index (not the PK) is what
    // de-dupes CDC rows, so any unique id is correct here.
    const result = await tx.$executeRaw`
      INSERT INTO "AuditLog"
        ("id", "userId", "action", "entityType", "entityId", "changes", "metadata", "operationId", "sourceTable", "timestamp")
      VALUES (
        gen_random_uuid()::text,
        ${m.actor},
        ${m.action}::"AuditAction",
        ${m.entityType},
        ${m.entityId},
        ${changesJson}::jsonb,
        ${metadataJson}::jsonb,
        ${m.operationId},
        ${m.sourceTable},
        now()
      )
      ON CONFLICT ("operationId", "sourceTable", "entityId", "action") WHERE "operationId" IS NOT NULL
      DO NOTHING
    `;
    written += Number(result) || 0;
  }
  return written;
}

/** The minimal raw-client surface this module needs (prismaBase satisfies it). */
interface RawTxClient {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
}
interface RawPrismaClient extends RawTxClient {
  $transaction: <T>(fn: (tx: RawTxClient) => Promise<T>) => Promise<T>;
}

/**
 * One poll pass: read up to `batchSize` unprocessed rows under FOR UPDATE SKIP LOCKED, materialize
 * them into AuditLog, and (unless markProcessed=false) mark the source rows processed=true — ALL in
 * a single transaction so a crash rolls back both the cursor advance and the inserts.
 */
export async function pollDataChangeLogsOnce(
  prisma: RawPrismaClient,
  opts: PollOnceOptions = {},
): Promise<PollOnceResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const markProcessed = opts.markProcessed ?? true;

  const cache = createHumanizeCache(createPrismaLookup(prisma), { ttlMs: HUMANIZE_TTL_MS });

  // The batched two-hop lookup, bound to this transaction's client (set inside the tx below).
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<RawDclRow[]>`
      SELECT * FROM "DataChangeLog"
      WHERE processed = false
      ORDER BY seq ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;

    if (rows.length === 0) {
      return { processed: 0, auditLogsWritten: 0 };
    }

    const twoHopQuery = async (
      hopTable: string,
      hopFkCol: string,
      fkValues: Array<number | string>,
    ): Promise<TwoHopRow[]> => {
      if (fkValues.length === 0) return [];
      // hopTable / hopFkCol come from the static ROLLUP_MAP (not row data) — safe to interpolate;
      // the fk VALUES are bound as a parameter ($1) via $queryRawUnsafe (no injection surface).
      const sql = `SELECT id, "${hopFkCol}" AS "ownerId" FROM "${hopTable}" WHERE id = ANY($1::int[])`;
      return tx.$queryRawUnsafe<TwoHopRow[]>(sql, fkValues.map((v) => Number(v)));
    };

    const groups = groupByOperationId(rows);
    const materialized: MaterializedRow[] = [];

    for (const group of groups) {
      try {
        const rolled = await applyRollupMap(group, twoHopQuery);
        for (const { row, entityType, entityId } of rolled) {
          const changes = row.changed_cols
            ? await humanize(cache, row.table, row.changed_cols)
            : {};
          materialized.push({
            sourceRowId: row.id,
            sourceTable: row.table,
            op: row.op,
            entityType,
            entityId,
            action: deriveAction(row),
            actor: row.actor,
            operationId: row.operation_id,
            tenant: row.tenant,
            changes,
          });
        }
      } catch (err) {
        // Per-group isolation (T-14-05-04): a malformed diff in one group must not wedge the batch.
        // The group's source rows stay processed=false (we never add them to `ids` below) and are
        // retried on the next poll once the underlying issue clears.
        console.error("[correlation] group materialization failed, skipping group:", err);
      }
    }

    const auditLogsWritten = await writeAuditLogRows(tx, materialized);

    if (markProcessed) {
      // Mark ONLY the rows whose group materialized successfully. A group that threw above never
      // reached `materialized`, so its source ids are excluded and it will be re-polled.
      const materializedSourceIds = new Set(materialized.map((m) => String(m.sourceRowId)));
      const ids = rows
        .filter((r) => materializedSourceIds.has(String(r.id)))
        .map((r) => BigInt(r.id));
      if (ids.length > 0) {
        await tx.$executeRaw`
          UPDATE "DataChangeLog" SET processed = true WHERE id = ANY(${ids}::bigint[])
        `;
      }
    }

    return { processed: rows.length, auditLogsWritten };
  });
}

/**
 * Loop B entry: poll DataChangeLog forever until `runningRef.running` flips false. Empty polls sleep
 * `pollIntervalMs`. Each pass is one `pollDataChangeLogsOnce`; the processed flag is the only cursor,
 * so the loop is fully restart-safe (a fresh process resumes from the first unprocessed seq). A poll
 * error is logged and the loop continues after a backoff sleep — the unprocessed rows are retried.
 */
export async function pollDataChangeLogs(
  prisma: RawPrismaClient,
  runningRef: { running: boolean },
  opts: { batchSize?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  while (runningRef.running) {
    try {
      const { processed } = await pollDataChangeLogsOnce(prisma, { batchSize });
      if (processed === 0) {
        await sleep(pollIntervalMs);
      }
      // A full batch (processed === batchSize) loops immediately to drain a backlog fast.
    } catch (err) {
      console.error("[correlation] poll pass failed, backing off:", err);
      await sleep(pollIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
