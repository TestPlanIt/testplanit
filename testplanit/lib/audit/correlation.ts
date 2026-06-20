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
import { SYSTEM_ACTOR_ID } from "~/lib/auditContextConstants";
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
  actor_name: string | null;
  actor_email: string | null;
  entity_name: string | null;
  project_id: string | null;
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
  /** Write-time human-context snapshot, copied verbatim from DataChangeLog — NEVER looked up. */
  userName: string | null;
  userEmail: string | null;
  entityName: string | null;
  projectId: string | null;
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
 * Group raw rows into one logical operation. A non-null operationId is the group key (the browser
 * minted one per logical save). When it is null — e.g. a quick-add create, a session create, a
 * parameter add — fall back to the database transaction id (`txid`): rows written in the SAME
 * transaction ARE one atomic write, so grouping by txid lets a parent and the children written with
 * it share a group (so the children inherit the parent's name/project, and the UI collapses them
 * into one entry). The synthetic `tx:<txid>` operationId is stamped on the materialized rows
 * downstream. Non-null operationIds group regardless of contiguity (research Pitfall G).
 */
export function groupByOperationId(rows: RawDclRow[]): RawDclRow[][] {
  const groups: RawDclRow[][] = [];
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const key =
      row.operation_id != null
        ? `op:${row.operation_id}`
        : `tx:${String(row.txid)}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, groups.length);
      groups.push([row]);
    } else {
      groups[existing].push(row);
    }
  }
  return groups;
}

/** The synthetic operationId for a null-operationId row: its transaction id (see groupByOperationId). */
function effectiveOperationId(row: RawDclRow): string {
  return row.operation_id ?? `tx:${String(row.txid)}`;
}

/**
 * COMMENT attribution. A Comment row carries the parent it is attached to via exactly one of these
 * FKs; the comment rolls up to that entity (the audit reads as an event on that case/run/session/…)
 * and takes its display name from it. The actor is the comment's own creatorId (the GUC actor is not
 * set on the comment path). Order matters only in that the first populated FK wins — only one is set.
 */
const COMMENT_PARENT_FKS: Array<{ fk: string; entityType: string }> = [
  { fk: "repositoryCaseId", entityType: "RepositoryCases" },
  { fk: "sessionId", entityType: "Sessions" },
  { fk: "testRunId", entityType: "TestRuns" },
  { fk: "milestoneId", entityType: "Milestones" },
  { fk: "reviewRequestId", entityType: "ReviewRequest" },
];

/** Pull a column's value (new ?? old) from a changed_cols diff. */
function colValue(row: RawDclRow, col: string): number | string | null {
  const entry = row.changed_cols?.[col];
  if (!entry) return null;
  const v = entry.new ?? entry.old;
  return v == null ? null : (v as number | string);
}

/** Resolve a Comment row to its parent entity (entityType + entityId), or null if no parent FK is present. */
function resolveCommentParent(
  row: RawDclRow,
): { entityType: string; entityId: string } | null {
  for (const { fk, entityType } of COMMENT_PARENT_FKS) {
    const v = colValue(row, fk);
    if (v != null) return { entityType, entityId: String(v) };
  }
  return null;
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

  // ResultFieldValues is a shared value table: besides the test-run hop handled by ROLLUP_MAP above,
  // a row may instead belong to a session result (sessionResultsId → SessionResults.sessionId →
  // Sessions). Pre-resolve that hop in one batched query for the whole group.
  const rfvSessionOwners = new Map<number | string, number | string>();
  const rfvSessionFks = group
    .filter((r) => r.table === "ResultFieldValues")
    .map((r) => extractFk(r, "sessionResultsId"))
    .filter((v): v is number | string => v !== null);
  if (rfvSessionFks.length > 0) {
    for (const r of await twoHopQuery("SessionResults", "sessionId", rfvSessionFks)) {
      rfvSessionOwners.set(r.id, r.ownerId);
    }
  }

  for (const row of group) {
    if (row.table === "Comment") {
      // Roll a comment up to the entity it is attached to (resolved name comes later).
      const parent = resolveCommentParent(row);
      out.push(parent ? { row, ...parent } : { row, entityType: row.table, entityId: row.pk });
      continue;
    }
    if (row.table === "ResultFieldValues") {
      // Shared 3-way value table — attribute to whichever owner FK is set (the trigger captures all
      // three). Session and case rows would otherwise fall through to the test-run two-hop below and
      // mis-attribute to TestRuns.
      const sessionResultId = extractFk(row, "sessionResultsId");
      if (sessionResultId != null) {
        const owner = rfvSessionOwners.get(sessionResultId);
        out.push({
          row,
          entityType: "Sessions",
          entityId: owner != null ? String(owner) : String(sessionResultId),
        });
        continue;
      }
      const caseId = extractFk(row, "testCaseId");
      if (caseId != null) {
        out.push({ row, entityType: "RepositoryCases", entityId: String(caseId) });
        continue;
      }
      // else: testRunResultsId (or none) — fall through to the ROLLUP_MAP two-hop below.
    }
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
        ("id", "userId", "userName", "userEmail", "action", "entityType", "entityId", "entityName", "changes", "metadata", "operationId", "sourceTable", "projectId", "timestamp")
      VALUES (
        gen_random_uuid()::text,
        ${m.actor},
        ${m.userName},
        ${m.userEmail},
        ${m.action}::"AuditAction",
        ${m.entityType},
        ${m.entityId},
        ${m.entityName},
        ${changesJson}::jsonb,
        ${metadataJson}::jsonb,
        ${m.operationId},
        ${m.sourceTable},
        ${m.projectId ? Number(m.projectId) : null},
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
    // Source ids of every row in a successfully-materialized group — including
    // no-op rows that were cancelled (they produce no AuditLog row but ARE done,
    // so they must still be marked processed or they would re-poll forever).
    const processedSourceIds = new Set<string>();

    for (const group of groups) {
      try {
        const rolled = await applyRollupMap(group, twoHopQuery);

        // No-op association churn cancel: when a save re-applies an UNCHANGED
        // many-to-many association it writes a join-table DELETE and a CREATE of
        // the SAME link in the one operation, netting to zero — so a rename reads
        // as "removed tag / added tag". Drop matched DELETE+CREATE pairs per link.
        // A genuine one-sided add or remove keeps its row (only pairs cancel).
        const cancelled = new Set<RawDclRow>();
        {
          const creates = new Map<string, RawDclRow[]>();
          const deletes = new Map<string, RawDclRow[]>();
          for (const { row } of rolled) {
            if (!row.table.startsWith("_")) continue;
            const a = colValue(row, "A");
            const b = colValue(row, "B");
            if (a == null || b == null) continue;
            const key = `${row.table}|${a}|${b}`;
            const action = deriveAction(row);
            const bucket =
              action === "CREATE" ? creates : action === "DELETE" ? deletes : null;
            if (!bucket) continue;
            const list = bucket.get(key);
            if (list) list.push(row);
            else bucket.set(key, [row]);
          }
          for (const [key, cs] of creates) {
            const ds = deletes.get(key) ?? [];
            const n = Math.min(cs.length, ds.length);
            for (let i = 0; i < n; i++) {
              cancelled.add(cs[i]);
              cancelled.add(ds[i]);
            }
          }
        }
        const kept = rolled.filter((r) => !cancelled.has(r.row));

        // Owning-entity name/project snapshot, harvested from the root row IN THIS GROUP that
        // attributes to itself (its table === entityType and its pk === entityId). A child/value/
        // join row that rolls up to that owner inherits the owner's write-time snapshot — so e.g.
        // editing a case's steps shows the case's name as it was at that instant, without any
        // lookup. (For child-only operations the owner row is absent; those rows carry the GUC
        // subject the originating route set, captured on the row itself — see below.)
        const ownerSnapshot = new Map<
          string,
          { entityName: string | null; projectId: string | null }
        >();
        // Pass 1 (authoritative): the owning root row's own snapshot — the row
        // that attributes to itself (table === entityType, pk === entityId).
        for (const { row, entityType, entityId } of kept) {
          if (
            row.table === entityType &&
            String(row.pk) === String(entityId) &&
            (row.entity_name != null || row.project_id != null)
          ) {
            ownerSnapshot.set(`${entityType}:${entityId}`, {
              entityName: row.entity_name,
              projectId: row.project_id,
            });
          }
        }
        // Pass 2 (fallback): when the owning root row was NOT written in this
        // operation, harvest the subject from any other row in the group that
        // captured it for the same owner — e.g. recording a result writes the
        // TestRunResults row (carrying the run's name/project from the GUC
        // subject) but not the TestRuns row, and the step-result rows that share
        // the operationId then inherit it. Never overwrites a pass-1 snapshot.
        for (const { row, entityType, entityId } of kept) {
          const key = `${entityType}:${entityId}`;
          if (
            !ownerSnapshot.has(key) &&
            (row.entity_name != null || row.project_id != null)
          ) {
            ownerSnapshot.set(key, {
              entityName: row.entity_name,
              projectId: row.project_id,
            });
          }
        }

        // Pass 3 (cross-batch back-fill): a save spanning several transactions (one operationId,
        // many txids) can have its owner root row and its child/value rows land in DIFFERENT poll
        // batches — each txn commits separately, so a poll can cut between them. A child polled
        // after its owner then finds no in-group snapshot above and would show a blank name. The
        // owner's DataChangeLog row still exists (append-only) and carries the write-time name for
        // THIS operationId, so read it from the immutable log — NOT the live entity, so the name is
        // still as-of the change. Only runs when a real operationId is present and an owner is
        // actually missing (txid-grouped rows share one transaction → never split across batches).
        const opId = group.find((r) => r.operation_id)?.operation_id ?? null;
        if (
          opId &&
          kept.some(
            ({ entityType, entityId }) =>
              !ownerSnapshot.has(`${entityType}:${entityId}`),
          )
        ) {
          const backfillRows = await tx.$queryRaw<RawDclRow[]>`
            SELECT * FROM "DataChangeLog"
            WHERE operation_id = ${opId} AND entity_name IS NOT NULL
          `;
          // Roll the name-carrying rows up to their OWNING entity before keying the snapshot. A row
          // that holds the name is often a child carrying the GUC subject (e.g. a TestRunResults row
          // holds the run name), whose owner is TestRuns:<runId> — NOT TestRunResults:<pk>. Keying by
          // the raw (table,pk) would never match a sibling step-result that looks up TestRuns:<runId>.
          const backfillRolled = await applyRollupMap(backfillRows, twoHopQuery);
          for (const { row, entityType, entityId } of backfillRolled) {
            const key = `${entityType}:${entityId}`;
            if (
              !ownerSnapshot.has(key) &&
              (row.entity_name != null || row.project_id != null)
            ) {
              ownerSnapshot.set(key, {
                entityName: row.entity_name,
                projectId: row.project_id,
              });
            }
          }
        }

        for (const { row, entityType, entityId } of kept) {
          const changes = row.changed_cols
            ? await humanize(cache, row.table, row.changed_cols)
            : {};
          // The trigger injects the rollup FK (unchanged, old === new) on value-only child UPDATEs
          // so the row can attribute to its owner; it's noise in the displayed diff, so drop it.
          // (applyRollupMap above read the FK from the RAW changed_cols, not this humanized copy.)
          for (const key of Object.keys(changes)) {
            const e = changes[key] as { old?: unknown; new?: unknown };
            if (e && e.old === e.new) delete changes[key];
          }
          const owner = ownerSnapshot.get(`${entityType}:${entityId}`);

          // A captured row with no GUC actor (raw prismaBase writes, seeds,
          // migrations, or any path without a session) is attributed to the
          // system sentinel so every materialized AuditLog row answers "who".
          let actor = row.actor || SYSTEM_ACTOR_ID;
          // Write-time snapshot, copied straight through (no lookup): the row's own captured
          // value (root rows, or children carrying the GUC subject) first, else the owner's.
          let userName = row.actor_name;
          let entityName = row.entity_name ?? owner?.entityName ?? null;
          const projectId = row.project_id ?? owner?.projectId ?? null;

          // Comment is the one exception that needs a lookup: its row carries the
          // creatorId (the actor) and the parent FK (the attached entity) but not
          // their names, and the comment write path sets no GUC actor. Resolve the
          // creator's name and the parent entity's name here.
          if (row.table === "Comment") {
            const creatorId = colValue(row, "creatorId");
            if (creatorId != null) {
              actor = String(creatorId);
              userName =
                (await cache.resolve("User", "name", creatorId)) ?? userName;
            }
            const parentName = await cache.resolve(entityType, "name", entityId);
            if (parentName) entityName = parentName;
          }

          materialized.push({
            sourceRowId: row.id,
            sourceTable: row.table,
            op: row.op,
            entityType,
            entityId,
            action: deriveAction(row),
            actor,
            userName,
            userEmail: row.actor_email,
            entityName,
            projectId,
            // Synthetic tx-based operationId when the browser minted none, so the
            // UI groups same-transaction rows and the idempotency index covers them.
            operationId: effectiveOperationId(row),
            tenant: row.tenant,
            changes,
          });
        }
        // The whole group materialized successfully — mark every source row done
        // (materialized OR cancelled) so none re-polls.
        for (const { row } of rolled) processedSourceIds.add(String(row.id));
      } catch (err) {
        // Per-group isolation (T-14-05-04): a malformed diff in one group must not wedge the batch.
        // The group's source rows stay processed=false (we never add them to `ids` below) and are
        // retried on the next poll once the underlying issue clears.
        console.error("[correlation] group materialization failed, skipping group:", err);
      }
    }

    const auditLogsWritten = await writeAuditLogRows(tx, materialized);

    if (markProcessed) {
      // Mark ONLY the rows whose group materialized successfully (processedSourceIds includes both
      // the written rows and the no-op-cancelled rows). A group that threw above added nothing, so
      // its source ids are excluded and it will be re-polled.
      const ids = rows
        .filter((r) => processedSourceIds.has(String(r.id)))
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
