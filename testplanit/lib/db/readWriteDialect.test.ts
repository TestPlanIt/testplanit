import type {
  CompiledQuery,
  DatabaseConnection,
  Driver,
  QueryResult,
  TransactionSettings,
} from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __testing } from "./readWriteDialect";
import { runWithDbRouting, withPrimary, withReplica } from "./routingContext";
import { getReadRoutingStats, resetReadRoutingStats } from "./routingStats";

// Read requests offload inside an autoReplica frame; a bare call has no frame
// (safe default → primary).

const {
  isSelectNode,
  isRawNode,
  isWriteNode,
  isLockingSelect,
  isConnectionError,
  createRoutingDriver,
} = __testing;

// --- Compiled-query fakes (only `query.kind` matters for routing) -----------

function cq(query: object, sql = "sql"): CompiledQuery {
  return {
    query: query as CompiledQuery["query"],
    sql,
    parameters: [],
    queryId: { queryId: sql },
  } as unknown as CompiledQuery;
}
const selectCq = () => cq({ kind: "SelectQueryNode" }, "select 1");
const lockingSelectCq = () =>
  cq(
    { kind: "SelectQueryNode", endModifiers: [{ modifier: "ForUpdate" }] },
    "select 1 for update"
  );
const insertCq = () => cq({ kind: "InsertQueryNode" }, "insert");
const updateCq = () => cq({ kind: "UpdateQueryNode" }, "update");
const deleteCq = () => cq({ kind: "DeleteQueryNode" }, "delete");
const rawCq = () => cq({ kind: "RawNode" }, "raw");

// --- Driver / connection fakes ---------------------------------------------

function connError(): Error {
  const e = new Error("ECONNREFUSED replica down");
  (e as Error & { code?: string }).code = "ECONNREFUSED";
  return e;
}

class FakeConnection implements DatabaseConnection {
  executed: CompiledQuery[] = [];
  released = false;
  constructor(
    public readonly label: string,
    private readonly failExecute = false
  ) {}
  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.executed.push(compiledQuery);
    if (this.failExecute) throw connError();
    return { rows: [{ pool: this.label } as unknown as R] };
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [{ pool: this.label } as unknown as R] };
  }
}

class FakeDriver implements Driver {
  acquireCount = 0;
  connections: FakeConnection[] = [];
  transactions: FakeConnection[] = [];
  constructor(
    public readonly label: string,
    private readonly opts: { failAcquire?: boolean; failExecute?: boolean } = {}
  ) {}
  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    this.acquireCount++;
    if (this.opts.failAcquire) throw connError();
    const conn = new FakeConnection(this.label, this.opts.failExecute);
    this.connections.push(conn);
    return conn;
  }
  async beginTransaction(
    conn: DatabaseConnection,
    _settings: TransactionSettings
  ): Promise<void> {
    this.transactions.push(conn as FakeConnection);
  }
  async commitTransaction(): Promise<void> {}
  async rollbackTransaction(): Promise<void> {}
  async releaseConnection(conn: DatabaseConnection): Promise<void> {
    (conn as FakeConnection).released = true;
  }
  async destroy(): Promise<void> {}
}

/** Route one query through a fresh RoutingConnection and return the pool label. */
async function routeOne(
  driver: Driver,
  compiled: CompiledQuery
): Promise<string> {
  const conn = await driver.acquireConnection();
  try {
    const res = await conn.executeQuery<{ pool: string }>(compiled);
    return res.rows[0].pool;
  } finally {
    await driver.releaseConnection(conn);
  }
}

/** Route one query inside an autoReplica frame (an app read request). */
function routeAuto(driver: Driver, compiled: CompiledQuery): Promise<string> {
  return runWithDbRouting(() => routeOne(driver, compiled), {
    autoReplica: true,
  });
}

describe("readWriteDialect node classification", () => {
  it("classifies reads, writes, raw, and locking selects", () => {
    expect(isSelectNode(selectCq())).toBe(true);
    expect(isSelectNode(insertCq())).toBe(false);
    expect(isRawNode(rawCq())).toBe(true);
    expect(isWriteNode(insertCq())).toBe(true);
    expect(isWriteNode(updateCq())).toBe(true);
    expect(isWriteNode(deleteCq())).toBe(true);
    expect(isWriteNode(selectCq())).toBe(false);
    // RawNode is intentionally NOT a "write" (ambiguous) — defaults to primary
    // without flipping the write pin.
    expect(isWriteNode(rawCq())).toBe(false);
    expect(isLockingSelect(lockingSelectCq())).toBe(true);
    expect(isLockingSelect(selectCq())).toBe(false);
  });

  it("recognises connection errors by code and message", () => {
    expect(isConnectionError(connError())).toBe(true);
    expect(isConnectionError({ code: "08006" })).toBe(true);
    expect(
      isConnectionError(new Error("terminating connection due to ..."))
    ).toBe(true);
    expect(isConnectionError(new Error("duplicate key value"))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe("readWriteDialect routing (auto mode)", () => {
  it("routes plain SELECTs to a replica", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    expect(await routeAuto(driver, selectCq())).toBe("replica");
    expect(replica.acquireCount).toBe(1);
    expect(primary.acquireCount).toBe(0);
  });

  it("routes writes and locking selects to the primary even in an autoReplica frame", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    expect(await routeAuto(driver, insertCq())).toBe("primary");
    expect(await routeAuto(driver, updateCq())).toBe("primary");
    expect(await routeAuto(driver, deleteCq())).toBe("primary");
    expect(await routeAuto(driver, lockingSelectCq())).toBe("primary");
    expect(replica.acquireCount).toBe(0);
  });

  it("keeps bare raw reads on the primary in auto mode", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    expect(await routeAuto(driver, rawCq())).toBe("primary");
    expect(replica.acquireCount).toBe(0);
  });

  it("keeps frame-less reads on the primary (safe default)", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    // No routing frame → primary, so an un-wrapped write-then-read is safe.
    expect(await routeOne(driver, selectCq())).toBe("primary");
    expect(replica.acquireCount).toBe(0);
  });

  it("keeps framed-but-not-opted-in reads on the primary (worker default)", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    // A plain frame (e.g. a worker job) does not auto-offload.
    await runWithDbRouting(async () => {
      expect(await routeOne(driver, selectCq())).toBe("primary");
    });
    expect(replica.acquireCount).toBe(0);
  });

  it("falls back to the primary when no replicas are configured", async () => {
    const primary = new FakeDriver("primary");
    const driver = createRoutingDriver(primary, []);
    expect(await routeAuto(driver, selectCq())).toBe("primary");
  });

  it("round-robins SELECTs across replicas", async () => {
    const primary = new FakeDriver("primary");
    const r0 = new FakeDriver("replica-0");
    const r1 = new FakeDriver("replica-1");
    const driver = createRoutingDriver(primary, [r0, r1]);
    expect(await routeAuto(driver, selectCq())).toBe("replica-0");
    expect(await routeAuto(driver, selectCq())).toBe("replica-1");
    expect(await routeAuto(driver, selectCq())).toBe("replica-0");
  });

  it("releases the sub-connection back to its own pool", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    await runWithDbRouting(
      async () => {
        const conn = await driver.acquireConnection();
        await conn.executeQuery(selectCq());
        await driver.releaseConnection(conn);
      },
      { autoReplica: true }
    );
    expect(replica.connections[0].released).toBe(true);
  });
});

describe("readWriteDialect transactions", () => {
  it("pins every statement in a transaction to the primary", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);

    const conn = await driver.acquireConnection();
    await driver.beginTransaction(conn, {});
    // Even a SELECT inside the transaction goes to the primary.
    expect(
      (await conn.executeQuery<{ pool: string }>(selectCq())).rows[0].pool
    ).toBe("primary");
    await driver.commitTransaction(conn);
    await driver.releaseConnection(conn);

    expect(primary.transactions).toHaveLength(1);
    expect(replica.acquireCount).toBe(0);
  });

  it("pins later reads in the same context after a read/write transaction", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);

    await runWithDbRouting(
      async () => {
        const txConn = await driver.acquireConnection();
        await driver.beginTransaction(txConn, {});
        await txConn.executeQuery(insertCq());
        await driver.commitTransaction(txConn);
        await driver.releaseConnection(txConn);

        // A subsequent read in the same context reads its own write on primary
        // even though the frame would otherwise auto-offload it.
        expect(await routeOne(driver, selectCq())).toBe("primary");
      },
      { autoReplica: true }
    );
    expect(replica.acquireCount).toBe(0);
  });
});

describe("readWriteDialect routing context", () => {
  it("withPrimary forces reads to the primary", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    await withPrimary(async () => {
      expect(await routeOne(driver, selectCq())).toBe("primary");
    });
    expect(replica.acquireCount).toBe(0);
  });

  it("withReplica sends raw reads to a replica", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    await withReplica(async () => {
      expect(await routeOne(driver, rawCq())).toBe("replica");
    });
  });

  it("withReplica still routes writes to the primary", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    await withReplica(async () => {
      expect(await routeOne(driver, insertCq())).toBe("primary");
    });
    expect(replica.acquireCount).toBe(0);
  });

  it("auto-pins reads to primary after a write in the same context", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    await runWithDbRouting(
      async () => {
        expect(await routeOne(driver, insertCq())).toBe("primary");
        // Post-write read is pinned to the primary (read-your-own-writes),
        // overriding auto-offload.
        expect(await routeOne(driver, selectCq())).toBe("primary");
      },
      { autoReplica: true }
    );
    expect(replica.acquireCount).toBe(0);
  });

  it("does not pin across independent contexts", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica");
    const driver = createRoutingDriver(primary, [replica]);
    await runWithDbRouting(
      async () => {
        await routeOne(driver, insertCq());
      },
      { autoReplica: true }
    );
    // A fresh context has no write pin — SELECT goes to the replica.
    await runWithDbRouting(
      async () => {
        expect(await routeOne(driver, selectCq())).toBe("replica");
      },
      { autoReplica: true }
    );
  });
});

describe("readWriteDialect failover", () => {
  it("falls back to the primary when a replica cannot be acquired", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica", { failAcquire: true });
    const driver = createRoutingDriver(primary, [replica]);
    expect(await routeAuto(driver, selectCq())).toBe("primary");
  });

  it("cools a down replica so subsequent reads skip it", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica", { failAcquire: true });
    // Long cooldown so the replica stays down for the whole test.
    const driver = createRoutingDriver(primary, [replica], 60_000);
    expect(await routeAuto(driver, selectCq())).toBe("primary");
    const acquireAttemptsAfterFirst = replica.acquireCount;
    expect(await routeAuto(driver, selectCq())).toBe("primary");
    // The replica was not retried while in cooldown.
    expect(replica.acquireCount).toBe(acquireAttemptsAfterFirst);
  });

  it("retries a read on the primary when the replica drops mid-query", async () => {
    const primary = new FakeDriver("primary");
    const replica = new FakeDriver("replica", { failExecute: true });
    const driver = createRoutingDriver(primary, [replica]);
    expect(await routeAuto(driver, selectCq())).toBe("primary");
    expect(replica.acquireCount).toBe(1);
    expect(primary.acquireCount).toBe(1);
  });
});

describe("readWriteDialect visibility", () => {
  beforeEach(() => {
    resetReadRoutingStats();
    __testing.resetStaleWriteWarnings();
    vi.restoreAllMocks();
  });

  it("counts replica reads, and primary reads by the reason for them", async () => {
    const driver = createRoutingDriver(new FakeDriver("primary"), [
      new FakeDriver("replica"),
    ]);

    await runWithDbRouting(() => routeOne(driver, selectCq()), {
      autoReplica: true,
    });
    await routeOne(driver, selectCq());
    await runWithDbRouting(() => routeOne(driver, selectCq()));
    await withPrimary(() => routeOne(driver, selectCq()));
    await runWithDbRouting(() => routeOne(driver, lockingSelectCq()), {
      autoReplica: true,
    });
    await runWithDbRouting(
      async () => {
        await routeOne(driver, insertCq());
        await routeOne(driver, selectCq());
      },
      { autoReplica: true }
    );

    const stats = getReadRoutingStats();
    expect(stats.replicaReads).toBe(1);
    expect(stats.primaryReads).toEqual({
      unframed: 1,
      notOptedIn: 1,
      forcedPrimary: 1,
      afterWrite: 1,
      notEligible: 1,
      noHealthyReplica: 0,
    });
  });

  it("counts a failover and a read that found no healthy replica", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const driver = createRoutingDriver(new FakeDriver("primary"), [
      new FakeDriver("replica", { failExecute: true }),
    ]);

    const run = () =>
      runWithDbRouting(() => routeOne(driver, selectCq()), {
        autoReplica: true,
      });
    expect(await run()).toBe("primary");
    expect(await run()).toBe("primary");

    const stats = getReadRoutingStats();
    expect(stats.failovers).toBe(1);
    expect(stats.primaryReads.noHealthyReplica).toBe(1);
  });

  it("warns once per source when a write follows a replica read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const driver = createRoutingDriver(new FakeDriver("primary"), [
      new FakeDriver("replica"),
    ]);

    const readThenWrite = () =>
      runWithDbRouting(
        async () => {
          await routeOne(driver, selectCq());
          await routeOne(driver, updateCq());
          await routeOne(driver, updateCq());
        },
        { autoReplica: true, label: "GET /api/example" }
      );
    await readThenWrite();
    await readThenWrite();

    expect(getReadRoutingStats().writesAfterReplicaRead).toBe(2);
    const warnings = warn.mock.calls.filter(([message]) =>
      String(message).includes("GET /api/example")
    );
    expect(warnings).toHaveLength(1);
  });

  it("says nothing when the write comes first", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const driver = createRoutingDriver(new FakeDriver("primary"), [
      new FakeDriver("replica"),
    ]);

    await runWithDbRouting(
      async () => {
        await routeOne(driver, insertCq());
        await routeOne(driver, selectCq());
      },
      { autoReplica: true, label: "POST /api/example" }
    );

    expect(getReadRoutingStats().writesAfterReplicaRead).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs when a replica that was down is read from again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const replica = new FakeDriver("replica", { failAcquire: true });
    const driver = createRoutingDriver(new FakeDriver("primary"), [replica], 5);
    const run = () =>
      runWithDbRouting(() => routeOne(driver, selectCq()), {
        autoReplica: true,
      });

    expect(await run()).toBe("primary");
    (
      replica as unknown as { opts: { failAcquire: boolean } }
    ).opts.failAcquire = false;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await run()).toBe("replica");

    expect(
      warn.mock.calls.some(([message]) =>
        String(message).includes("back in rotation")
      )
    ).toBe(true);
  });
});

describe("readWriteDialect replication lag", () => {
  beforeEach(() => {
    resetReadRoutingStats();
    vi.restoreAllMocks();
  });

  function lagDriver(lags: Array<number | null>) {
    const current = [...lags];
    const driver = createRoutingDriver(
      new FakeDriver("primary"),
      lags.map((_, index) => new FakeDriver(`replica-${index}`)),
      10_000,
      {
        maxLagMs: 1000,
        probes: lags.map((_, index) => async () => current[index]!),
      }
    );
    const run = () =>
      runWithDbRouting(() => routeOne(driver, selectCq()), {
        autoReplica: true,
      });
    return { driver, current, run };
  }

  it("skips a replica that is too far behind and uses the others", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { driver, run } = lagDriver([5000, 10]);
    await driver.checkLag();

    expect([await run(), await run(), await run()]).toEqual([
      "replica-1",
      "replica-1",
      "replica-1",
    ]);
  });

  it("reads from the primary when every replica is behind, then returns", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { driver, current, run } = lagDriver([5000]);
    await driver.checkLag();
    expect(await run()).toBe("primary");
    expect(getReadRoutingStats().primaryReads.noHealthyReplica).toBe(1);

    current[0] = 20;
    await driver.checkLag();
    expect(await run()).toBe("replica-0");
  });

  it("keeps a replica whose lag cannot be read", async () => {
    const { driver, run } = lagDriver([null]);
    await driver.checkLag();
    expect(await run()).toBe("replica-0");
  });

  it("reports each replica's state", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { driver } = lagDriver([5000, 10]);
    await driver.init();
    await driver.checkLag();

    expect(getReadRoutingStats().replicas).toEqual([
      { index: 0, status: "lagging", lagMs: 5000 },
      { index: 1, status: "ok", lagMs: 10 },
    ]);
    await driver.destroy();
    expect(getReadRoutingStats().replicas).toEqual([]);
  });

  it("measures lag twice per threshold, between one and five seconds", () => {
    expect(__testing.lagCheckIntervalMs(500)).toBe(1000);
    expect(__testing.lagCheckIntervalMs(4000)).toBe(2000);
    expect(__testing.lagCheckIntervalMs(60_000)).toBe(5000);
  });
});

describe("routing stats across module copies", () => {
  it("counts into one place whichever copy of the module is used", async () => {
    resetReadRoutingStats();
    vi.resetModules();
    const copyA = await import("./routingStats");
    vi.resetModules();
    const copyB = await import("./routingStats");
    expect(copyA.countReplicaRead).not.toBe(copyB.countReplicaRead);

    copyA.countReplicaRead();
    copyB.countReplicaRead();
    expect(copyA.getReadRoutingStats().replicaReads).toBe(2);
    expect(getReadRoutingStats().replicaReads).toBe(2);
  });
});
