/**
 * FK-poison regression (auditLogWorker Loop B / lib/audit/correlation).
 *
 * BUG: `AuditLog.projectId` has an FK to Projects with ON DELETE SET NULL. When a project is deleted
 * the DB cascade emits many child-delete DataChangeLog rows whose captured projectId still points at
 * the now-gone project. writeAuditLogRows wrote them in ONE transaction, so a single dangling id made
 * the whole batch INSERT abort with a 23503 FK violation — nothing got marked processed and the
 * worker re-polled the same head-of-line batch forever, freezing that tenant's audit pipeline.
 * ON DELETE SET NULL does NOT help: it only rewrites existing rows, never a fresh INSERT.
 *
 * FIX: writeAuditLogRows resolves the batch's live project ids once and nulls any dangling reference
 * before inserting (primary), and runs the batch under a SAVEPOINT so a residual constraint error is
 * isolated row-by-row instead of wedging everything (backstop).
 *
 * These are pure unit tests: a faithful in-memory fake models the two Postgres behaviours the bug and
 * fix depend on — (1) a projectId that isn't a live Projects row raises 23503 and ABORTS the
 * transaction, and (2) SAVEPOINT / ROLLBACK TO SAVEPOINT recovers from that abort. (The abort +
 * savepoint recovery was additionally verified against the real ew schema during development.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  pollDataChangeLogsOnce,
  writeAuditLogRows,
  type MaterializedRow,
  type RawDbClient,
  type RawTxClient,
} from "../correlation";

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
  /**
   * Project ids the simulated FK actually accepts at INSERT time. Defaults to existingProjectIds;
   * set it SMALLER than existingProjectIds to simulate a TOCTOU race (resolve says a project exists,
   * but it was deleted by a concurrent tx before the insert, so the FK still rejects it).
   */
  fkValidProjectIds?: Set<number>;
  /** DataChangeLog rows the poll SELECT returns. */
  seededRows?: RawDclSeed[];
  /** entityIds that are un-insertable regardless of projectId — models a non-FK residual constraint. */
  poisonEntityIds?: Set<string>;
}

/**
 * A minimal but faithful Postgres-transaction fake. It routes the module's raw SQL by content and
 * simulates: FK 23503 on a projectId that isn't accepted, the resulting transaction-abort state
 * (every statement errors until a ROLLBACK TO SAVEPOINT), the ON CONFLICT DO NOTHING idempotency
 * index, and SAVEPOINT/RELEASE/ROLLBACK-TO with rollback of the rows inserted since the savepoint.
 */
function makeFakeDb(opts: FakeDbOptions = {}) {
  const existingProjectIds = opts.existingProjectIds ?? new Set<number>();
  const fkValidProjectIds = opts.fkValidProjectIds ?? existingProjectIds;
  const poisonEntityIds = opts.poisonEntityIds ?? new Set<string>();
  const seededRows = opts.seededRows ?? [];

  const inserted: InsertedRow[] = [];
  const insertSqls: string[] = [];
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

  const identityKey = (r: InsertedRow) =>
    `${r.operationId ?? ""}|${r.sourceTable}|${r.entityId}|${r.action}`;

  const doInsert = (sql: string, values: unknown[]): number => {
    abortGuard();
    insertSqls.push(sql);
    const row: InsertedRow = {
      action: values[3] as string,
      entityId: values[5] as string,
      operationId: (values[9] as string | null) ?? null,
      sourceTable: values[10] as string,
      projectId: (values[11] as number | null) ?? null,
    };
    // Non-FK residual constraint (fails even with projectId = null).
    if (poisonEntityIds.has(row.entityId)) {
      aborted = true;
      const e = new Error("residual check constraint violation") as Error & {
        code?: string;
      };
      e.code = "23514";
      throw e;
    }
    // The projectId FK: a value that isn't a live Projects row raises 23503 and aborts the tx.
    if (
      row.projectId != null &&
      !fkValidProjectIds.has(Number(row.projectId))
    ) {
      aborted = true;
      const e = new Error(
        'insert or update on table "AuditLog" violates foreign key constraint "AuditLog_projectId_fkey"'
      ) as Error & { code?: string };
      e.code = "23503";
      throw e;
    }
    // ON CONFLICT (operationId, sourceTable, entityId, action) WHERE operationId IS NOT NULL DO NOTHING.
    if (
      row.operationId != null &&
      inserted.some((x) => identityKey(x) === identityKey(row))
    ) {
      return 0;
    }
    inserted.push(row);
    return 1;
  };

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      abortGuard();
      const sql = strings.join(" ");
      if (
        sql.includes('FROM "DataChangeLog"') &&
        sql.includes("processed = false")
      ) {
        return seededRows;
      }
      return []; // pass-3 backfill and anything else
    },
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join(" ");
      if (sql.includes('INSERT INTO "AuditLog"')) return doInsert(sql, values);
      if (sql.includes('UPDATE "DataChangeLog"')) {
        abortGuard();
        const ids = (values[0] as Array<bigint | number>) ?? [];
        for (const id of ids) processedIds.push(Number(id));
        return ids.length;
      }
      abortGuard();
      return 0;
    },
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      abortGuard();
      if (sql.includes('FROM "Projects" WHERE id = ANY')) {
        const ids = (params[0] as Array<number | string>) ?? [];
        return ids
          .filter((id) => existingProjectIds.has(Number(id)))
          .map((id) => ({ id: Number(id) }));
      }
      return []; // two-hop lookups etc.
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
      return 0;
    },
  };

  const client = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };

  return {
    tx: tx as unknown as RawTxClient,
    client: client as unknown as RawDbClient,
    inserted,
    insertSqls,
    processedIds,
    isAborted: () => aborted,
  };
}

/** Build a DataChangeLog seed row (root project-scoped table, hard delete) for the poll-level test. */
function dclRow(
  over: Partial<RawDclSeed> & Pick<RawDclSeed, "id" | "table" | "pk">
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
    txid: "5555",
    ts: new Date("2026-07-08T00:00:00Z"),
    processed: false,
    ...over,
  };
}

/** Build a MaterializedRow for the writeAuditLogRows-level backstop tests. */
function mkMat(
  over: Partial<MaterializedRow> & Pick<MaterializedRow, "entityId">
): MaterializedRow {
  return {
    sourceRowId: 1,
    sourceTable: "Sessions",
    op: "D",
    entityType: "Sessions",
    action: "DELETE",
    actor: "actor-1",
    userName: "Actor One",
    userEmail: "actor@example.com",
    entityName: "Sess",
    projectId: null,
    operationId: "op-1",
    tenant: null,
    changes: { name: { old: "was", new: null } },
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeAuditLogRows — projectId FK poison", () => {
  it("HEADLINE: a poison batch (mixed valid/dangling projectId across multiple tables incl. a Projects delete) commits, dangling ids nulled, and every source row is processed=true", async () => {
    const VALID = 100; // a project that still exists
    const DELETED = 999; // the cascade-deleted project (its own + children's captured projectId)

    // Models the cascade of deleting project 999: the Projects row itself plus child root entities
    // (Sessions/TestRuns/Milestones) whose captured project_id still points at 999. Plus one row on a
    // surviving project (VALID) and one with no project scope, to pin "kept" and "stays null".
    const seededRows: RawDclSeed[] = [
      dclRow({
        id: 1,
        table: "Projects",
        pk: "999",
        project_id: String(DELETED),
      }),
      dclRow({
        id: 2,
        table: "Sessions",
        pk: "11",
        project_id: String(DELETED),
      }),
      dclRow({
        id: 3,
        table: "TestRuns",
        pk: "22",
        project_id: String(DELETED),
      }),
      dclRow({
        id: 4,
        table: "Milestones",
        pk: "33",
        project_id: String(DELETED),
      }),
      dclRow({ id: 5, table: "Sessions", pk: "12", project_id: String(VALID) }),
      dclRow({ id: 6, table: "Sessions", pk: "13", project_id: null }),
    ];

    const db = makeFakeDb({
      existingProjectIds: new Set([VALID]), // 999 is gone; only 100 resolves as existing
      seededRows,
    });

    const result = await pollDataChangeLogsOnce(db.client, { batchSize: 500 });

    // The batch committed rather than aborting on the dangling id.
    expect(result.processed).toBe(6);
    expect(result.auditLogsWritten).toBe(6);
    expect(db.isAborted()).toBe(false);

    const byEntity = new Map(
      db.inserted.map((r) => [`${r.sourceTable}:${r.entityId}`, r.projectId])
    );
    // Dangling references (the deleted project 999) are nulled — matching ON DELETE SET NULL intent.
    expect(byEntity.get("Projects:999")).toBeNull();
    expect(byEntity.get("Sessions:11")).toBeNull();
    expect(byEntity.get("TestRuns:22")).toBeNull();
    expect(byEntity.get("Milestones:33")).toBeNull();
    // A live project id is preserved; a row with no project scope stays null.
    expect(byEntity.get("Sessions:12")).toBe(VALID);
    expect(byEntity.get("Sessions:13")).toBeNull();

    // Every source row was marked processed=true (cursor advanced — no infinite re-poll).
    expect([...db.processedIds].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);

    // Idempotency is preserved: every INSERT still carries the ON CONFLICT DO NOTHING arbiter.
    expect(db.insertSqls).toHaveLength(6);
    for (const sql of db.insertSqls) {
      expect(sql).toContain(
        'ON CONFLICT ("operationId", "sourceTable", "entityId", "action")'
      );
    }
  });

  it("resolves valid ids in a single batch query and nulls only the danglers (no per-row check)", async () => {
    const db = makeFakeDb({ existingProjectIds: new Set([7]) });
    const written = await writeAuditLogRows(db.tx, [
      mkMat({ entityId: "a", projectId: "7" }), // exists → kept
      mkMat({ entityId: "b", projectId: "8" }), // dangling → nulled
      mkMat({ entityId: "c", projectId: null }), // none → null
    ]);
    expect(written).toBe(3);
    expect(db.inserted.map((r) => [r.entityId, r.projectId])).toEqual([
      ["a", 7],
      ["b", null],
      ["c", null],
    ]);
  });
});

describe("writeAuditLogRows — residual-error isolation backstop", () => {
  it("absorbs a TOCTOU race: an FK error the resolve missed is isolated and retried with projectId=NULL, and the batch still commits", async () => {
    // resolve REPORTS 999 as existing, but the FK REJECTS it — a project deleted by a concurrent tx
    // between the resolve and the insert. The fast batch INSERT aborts; the row-by-row backstop
    // isolates the offender and re-inserts it with a null projectId.
    const db = makeFakeDb({
      existingProjectIds: new Set([100, 999]), // resolve lies about 999
      fkValidProjectIds: new Set([100]), // the DB FK only accepts 100
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const written = await writeAuditLogRows(db.tx, [
      mkMat({ entityId: "a", projectId: "100" }),
      mkMat({ entityId: "b", projectId: "999" }), // FK-rejected → retried as null
      mkMat({ entityId: "c", projectId: null }),
    ]);

    expect(written).toBe(3);
    expect(db.isAborted()).toBe(false);
    const byEntity = new Map(db.inserted.map((r) => [r.entityId, r.projectId]));
    expect(byEntity.get("a")).toBe(100);
    expect(byEntity.get("b")).toBeNull(); // dangling id nulled, row preserved (not dropped)
    expect(byEntity.get("c")).toBeNull();
    expect(warn).toHaveBeenCalled(); // logged the nulling
    expect(err).toHaveBeenCalled(); // logged the batch-level fallback
  });

  it("skips a genuinely un-insertable row (fails even with projectId=NULL) instead of wedging the batch", async () => {
    const db = makeFakeDb({
      existingProjectIds: new Set([100]),
      poisonEntityIds: new Set(["POISON"]), // un-insertable regardless of projectId
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const written = await writeAuditLogRows(db.tx, [
      mkMat({ entityId: "a", projectId: "100" }),
      mkMat({ entityId: "POISON", projectId: null }),
      mkMat({ entityId: "c", projectId: null }),
    ]);

    // The poison row is dropped (logged); the good rows still commit — no throw, no infinite retry.
    expect(written).toBe(2);
    expect(db.isAborted()).toBe(false);
    expect(db.inserted.map((r) => r.entityId).sort()).toEqual(["a", "c"]);
    expect(err).toHaveBeenCalled();
  });

  it("through pollDataChangeLogsOnce: a mid-batch FK abort recovers AND the cursor still advances (processed=true)", async () => {
    // End-to-end of the transaction: even when the backstop fires (an FK error the resolve missed),
    // the isolation recovery leaves the transaction usable so the processed=true UPDATE still runs —
    // the whole point of the fix (no stuck head-of-line batch).
    const seededRows: RawDclSeed[] = [
      dclRow({ id: 10, table: "Sessions", pk: "11", project_id: "777" }), // resolve lies; FK rejects
      dclRow({ id: 20, table: "Sessions", pk: "12", project_id: "100" }), // genuinely valid
    ];
    const db = makeFakeDb({
      existingProjectIds: new Set([777, 100]), // resolve reports 777 as live
      fkValidProjectIds: new Set([100]), // ...but the FK rejects it (deleted under us)
      seededRows,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await pollDataChangeLogsOnce(db.client, { batchSize: 500 });

    expect(result.processed).toBe(2);
    expect(result.auditLogsWritten).toBe(2);
    expect(db.isAborted()).toBe(false);
    const byEntity = new Map(db.inserted.map((r) => [r.entityId, r.projectId]));
    expect(byEntity.get("11")).toBeNull(); // FK-rejected id nulled by the backstop
    expect(byEntity.get("12")).toBe(100);
    // Cursor advanced for BOTH source rows despite the mid-batch abort.
    expect([...db.processedIds].sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it("returns 0 without touching the DB for an empty batch", async () => {
    const db = makeFakeDb();
    expect(await writeAuditLogRows(db.tx, [])).toBe(0);
    expect(db.inserted).toHaveLength(0);
    expect(db.insertSqls).toHaveLength(0);
  });
});
