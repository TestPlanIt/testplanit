/**
 * Batch-wedge regression (auditLogWorker Loop B / lib/audit/correlation).
 *
 * BUG SHAPE: pollDataChangeLogsOnce runs the whole batch — group materialization, project backfill,
 * AuditLog insert, processed=true marks — in ONE transaction. A SQL error in any statement aborts
 * the Postgres transaction, and a bare try/catch cannot un-abort it: every later statement fails
 * with 25P02, nothing is marked, and the worker re-polls the same head-of-line batch forever (the
 * audit pipeline freezes while the worker looks alive). Worse, `processed` reported FETCHED rows,
 * so a poison-only batch counted as progress and the supervisor skipped its idle sleep — a hot loop.
 *
 * FIX: every per-group step runs under a SAVEPOINT (materialization per group; the shared write
 * path as a whole, falling back to per-group writes on failure), so one poison group costs only its
 * own rows — they stay processed=false and retry next poll — while the rest of the batch drains.
 * `processed` now counts COMPLETED rows, so a poison-only batch reports 0 and the supervisor sleeps.
 *
 * Pure unit tests: the in-memory fake models the two Postgres behaviours the fix depends on —
 * (1) a failed statement ABORTS the transaction (every later statement errors), and
 * (2) SAVEPOINT / ROLLBACK TO SAVEPOINT recovers from that abort.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { pollDataChangeLogsOnce, type RawDbClient } from "../correlation";

interface InsertedRow {
  action: string;
  entityId: string;
  operationId: string | null;
  sourceTable: string;
  projectId: number | null;
}

interface RawDclSeed {
  id: number;
  seq: number;
  table: string;
  op: string;
  pk: string;
  changed_cols: Record<string, { old: unknown; new: unknown }> | null;
  actor: string | null;
  actor_name: string | null;
  actor_email: string | null;
  entity_name: string | null;
  project_id: string | null;
  operation_id: string | null;
  tenant: string | null;
  txid: string;
  ts: Date;
  processed: boolean;
}

interface FakeDbOptions {
  /** Project ids the resolve SELECT ("SELECT id FROM Projects WHERE id = ANY") reports as existing. */
  existingProjectIds?: Set<number>;
  /** DataChangeLog rows the poll SELECT returns. */
  seededRows?: RawDclSeed[];
  /**
   * SQL substrings that make the statement FAIL and abort the transaction — models a Postgres
   * statement error (undefined table, bad cast, …) anywhere in the pipeline.
   */
  failSqlIncludes?: string[];
}

/**
 * A minimal but faithful Postgres-transaction fake (same contract as the one in
 * correlationProjectFkPoison.test.ts): a failing statement sets the aborted flag, every statement
 * while aborted throws 25P02-style, and SAVEPOINT / ROLLBACK TO / RELEASE manage recovery marks.
 */
function makeFakeDb(opts: FakeDbOptions = {}) {
  const existingProjectIds = opts.existingProjectIds ?? new Set<number>();
  const seededRows = opts.seededRows ?? [];
  const failSqlIncludes = opts.failSqlIncludes ?? [];

  const inserted: InsertedRow[] = [];
  const processedIds: number[] = [];
  const savepoints: Array<{ name: string; mark: number }> = [];
  let aborted = false;

  const abortGuard = () => {
    if (aborted) {
      throw new Error(
        "current transaction is aborted, commands ignored until end of transaction block"
      );
    }
  };

  const failGuard = (sql: string) => {
    if (failSqlIncludes.some((frag) => sql.includes(frag))) {
      aborted = true;
      throw new Error(`simulated statement error for: ${sql.slice(0, 60)}`);
    }
  };

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      abortGuard();
      const sql = strings.join(" ");
      failGuard(sql);
      if (
        sql.includes('FROM "DataChangeLog"') &&
        sql.includes("processed = false")
      ) {
        return seededRows;
      }
      return [];
    },
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      abortGuard();
      const sql = strings.join(" ");
      failGuard(sql);
      if (sql.includes('INSERT INTO "AuditLog"')) {
        inserted.push({
          action: values[3] as string,
          entityId: values[5] as string,
          operationId: (values[9] as string | null) ?? null,
          sourceTable: values[10] as string,
          projectId: (values[11] as number | null) ?? null,
        });
        return 1;
      }
      if (sql.includes('UPDATE "DataChangeLog"')) {
        const ids = (values[0] as Array<bigint | number>) ?? [];
        for (const id of ids) processedIds.push(Number(id));
        return ids.length;
      }
      return 0;
    },
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      abortGuard();
      failGuard(sql);
      if (sql.includes('FROM "Projects" WHERE id = ANY')) {
        const ids = (params[0] as Array<number | string>) ?? [];
        return ids
          .filter((id) => existingProjectIds.has(Number(id)))
          .map((id) => ({ id: Number(id) }));
      }
      return []; // two-hop lookups, humanize name lookups, backfills
    },
    $executeRawUnsafe: async (sql: string) => {
      const parts = sql.trim().split(/\s+/);
      if (parts[0] === "SAVEPOINT") {
        abortGuard(); // Postgres rejects SAVEPOINT while aborted
        savepoints.push({ name: parts[1], mark: inserted.length });
        return 0;
      }
      if (parts[0] === "ROLLBACK" && parts[2] === "SAVEPOINT") {
        const name = parts[3];
        for (let i = savepoints.length - 1; i >= 0; i--) {
          if (savepoints[i].name === name) {
            inserted.length = savepoints[i].mark; // undo inserts since the savepoint
            break;
          }
        }
        aborted = false; // ROLLBACK TO clears the aborted state
        return 0;
      }
      if (parts[0] === "RELEASE" && parts[1] === "SAVEPOINT") {
        abortGuard(); // our code never RELEASEs while aborted
        const name = parts[2];
        for (let i = savepoints.length - 1; i >= 0; i--) {
          if (savepoints[i].name === name) {
            savepoints.splice(i); // pop it and any nested above
            break;
          }
        }
        return 0;
      }
      abortGuard();
      failGuard(sql);
      return 0;
    },
  };

  const client = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };

  return {
    client: client as unknown as RawDbClient,
    inserted,
    processedIds,
    isAborted: () => aborted,
  };
}

function dclRow(
  over: Partial<RawDclSeed> & Pick<RawDclSeed, "id" | "table" | "pk" | "txid">
): RawDclSeed {
  return {
    seq: over.id,
    op: "D",
    changed_cols: { name: { old: "was", new: null } },
    actor: "actor-1",
    actor_name: "Actor One",
    actor_email: "actor@example.com",
    entity_name: `${over.table}-${over.pk}`,
    project_id: null,
    operation_id: null,
    tenant: null,
    ts: new Date("2026-08-17T00:00:00Z"),
    processed: false,
    ...over,
  };
}

/** A healthy standalone root-row group (Sessions delete carrying its own project scope). */
function healthySessionsRow(id: number, txid: string): RawDclSeed {
  return dclRow({
    id,
    table: "Sessions",
    pk: String(id),
    txid,
    project_id: "100",
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollDataChangeLogsOnce — per-group isolation (batch-wedge regression)", () => {
  it("a SQL error during one group's MATERIALIZATION leaves the transaction usable: the other group drains, the poison group's rows stay queued", async () => {
    // Poison group: a value-only Steps child UPDATE with no in-group owner row and a real
    // operationId — materialization runs the pass-3 cross-batch snapshot query, which fails.
    const poison = dclRow({
      id: 1,
      table: "Steps",
      pk: "51",
      txid: "1111",
      op: "U",
      operation_id: "op-poison",
      entity_name: null,
      changed_cols: { testCaseId: { old: 5, new: 5 } },
    });
    const db = makeFakeDb({
      existingProjectIds: new Set([100]),
      seededRows: [poison, healthySessionsRow(2, "2222")],
      failSqlIncludes: ["entity_name IS NOT NULL"], // the pass-3 snapshot query
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await pollDataChangeLogsOnce(db.client, { batchSize: 500 });

    // The healthy group materialized, wrote, and advanced its cursor.
    expect(result.auditLogsWritten).toBe(1);
    expect(db.inserted.map((r) => `${r.sourceTable}:${r.entityId}`)).toEqual([
      "Sessions:2",
    ]);
    expect(db.processedIds).toEqual([2]);
    // The poison group's row stays queued for the next poll; it is NOT counted as progress.
    expect(result.processed).toBe(1);
    expect(db.processedIds).not.toContain(1);
    expect(db.isAborted()).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it("a SQL error in the shared WRITE path (project backfill) falls back to per-group writes: the healthy group commits, the poison group's rows stay queued", async () => {
    // Poison group: a Milestones root row with NO captured project scope — the backfill's
    // `SELECT ... FROM "Milestones"` lookup fails (materialization itself is SQL-free).
    const poison = dclRow({
      id: 10,
      table: "Milestones",
      pk: "33",
      txid: "3333",
    });
    const db = makeFakeDb({
      existingProjectIds: new Set([100]),
      seededRows: [poison, healthySessionsRow(20, "4444")],
      failSqlIncludes: ['FROM "Milestones"'],
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await pollDataChangeLogsOnce(db.client, { batchSize: 500 });

    expect(result.processed).toBe(1);
    expect(result.auditLogsWritten).toBe(1);
    expect(db.inserted.map((r) => `${r.sourceTable}:${r.entityId}`)).toEqual([
      "Sessions:20",
    ]);
    expect(db.processedIds).toEqual([20]);
    expect(db.processedIds).not.toContain(10);
    expect(db.isAborted()).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it("a poison-only batch reports processed=0 so the supervisor sleeps instead of hot-looping", async () => {
    const db = makeFakeDb({
      seededRows: [
        dclRow({ id: 10, table: "Milestones", pk: "33", txid: "3333" }),
      ],
      failSqlIncludes: ['FROM "Milestones"'],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await pollDataChangeLogsOnce(db.client, { batchSize: 500 });

    expect(result.processed).toBe(0);
    expect(result.auditLogsWritten).toBe(0);
    expect(db.inserted).toHaveLength(0);
    expect(db.processedIds).toHaveLength(0);
    expect(db.isAborted()).toBe(false);
  });

  it("a fully healthy multi-group batch is unchanged: every row completes, counts as progress, and is marked", async () => {
    const db = makeFakeDb({
      existingProjectIds: new Set([100]),
      seededRows: [
        healthySessionsRow(1, "1111"),
        healthySessionsRow(2, "2222"),
      ],
    });

    const result = await pollDataChangeLogsOnce(db.client, { batchSize: 500 });

    expect(result.processed).toBe(2);
    expect(result.auditLogsWritten).toBe(2);
    expect([...db.processedIds].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(db.isAborted()).toBe(false);
  });
});
