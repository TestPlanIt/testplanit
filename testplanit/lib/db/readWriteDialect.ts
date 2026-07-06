// lib/db/readWriteDialect.ts
//
// A custom Kysely Dialect that splits read and write traffic across a primary
// PostgreSQL instance and one or more read replicas. This is the injection
// point recommended by issue #198's design note: it sits BELOW ZenStack's
// access-control / side-effect plugins, so policy SELECTs ride to replicas and
// nothing else in the ORM stack changes.
//
// Routing decision (per query, in RoutingConnection.#resolve):
//   1. Inside a transaction (connection pinned by beginTransaction) → primary.
//   2. routingContext.forcePrimary (withPrimary / cookie-honored request) → primary.
//   3. routingContext.wroteInContext (auto pin after a write) → primary.
//   4. Write node (Insert/Update/Delete/Merge/DDL) → primary; also flips
//      wroteInContext so later reads in the same context read their own writes.
//   5. routingContext.forceReplica (withReplica) + read/raw → replica.
//   6. Plain SELECT (no FOR UPDATE/SHARE) → replica (round-robin).
//   7. Everything else, incl. bare RawNode reads → primary (safe default).
//
// Failover: replicas that fail to connect (or drop mid-read) are put in a
// cooldown window and skipped; the query falls back to the primary. Reads are
// safe to retry on the primary; writes never touch a replica.
//
// Implementation note: each pool is driven by Kysely's own PostgresDriver, so
// we reuse its battle-tested pooling / transaction / savepoint machinery and
// only add the routing layer on top.

import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import type {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
  TransactionSettings,
} from "kysely";
import { Pool, type PoolConfig } from "pg";

import { getRoutingContext, markWroteInContext } from "./routingContext";

export interface ReadWriteRoutingDialectConfig {
  /** Primary (read/write) connection string — receives all writes + transactions. */
  primaryUrl: string;
  /** Read-replica connection strings; SELECTs are spread across them. */
  replicaUrls: string[];
  /** Extra pg.Pool options applied to every pool (e.g. max, ssl). */
  poolConfig?: Omit<PoolConfig, "connectionString">;
  /** How long (ms) to skip a replica after a connection failure. Default 10000. */
  replicaCooldownMs?: number;
}

const DEFAULT_REPLICA_COOLDOWN_MS = 10_000;

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

function nodeKind(cq: CompiledQuery): string {
  return (cq.query as { kind?: string }).kind ?? "";
}

/** A plain data read that is safe to serve from a replica. */
function isSelectNode(cq: CompiledQuery): boolean {
  return nodeKind(cq) === "SelectQueryNode";
}

function isRawNode(cq: CompiledQuery): boolean {
  return nodeKind(cq) === "RawNode";
}

/**
 * Any statement that mutates data or schema. RawNode is deliberately excluded
 * (its intent is ambiguous) — it defaults to the primary and does NOT flip the
 * write pin, so raw reads (reporting/aggregation) stay offloadable via
 * withReplica while raw writes still land on the primary.
 */
function isWriteNode(cq: CompiledQuery): boolean {
  const kind = nodeKind(cq);
  return kind !== "SelectQueryNode" && kind !== "RawNode";
}

const LOCKING_MODIFIERS = new Set([
  "ForUpdate",
  "ForNoKeyUpdate",
  "ForShare",
  "ForKeyShare",
]);

/** SELECT ... FOR UPDATE/SHARE — needs the primary (row locks). */
function isLockingSelect(cq: CompiledQuery): boolean {
  const q = cq.query as {
    kind?: string;
    endModifiers?: ReadonlyArray<{ modifier?: string }>;
  };
  if (q.kind !== "SelectQueryNode" || !q.endModifiers) return false;
  return q.endModifiers.some(
    (m) => m.modifier !== undefined && LOCKING_MODIFIERS.has(m.modifier)
  );
}

// pg surfaces connectivity failures as libpq errnos or SQLSTATE class 08 /
// admin-shutdown / too-many-connections. We only treat these as "replica is
// down" — genuine query errors must propagate unchanged.
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (e.g. still starting up)
  "53300", // too_many_connections
]);

function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code && CONNECTION_ERROR_CODES.has(code)) return true;
  const msg = (err as { message?: string }).message ?? "";
  return /connection terminated|terminating connection|connection refused|ECONNREFUSED|Client has encountered a connection error|server closed the connection|Connection ended unexpectedly|the database system is (starting up|in recovery)/i.test(
    msg
  );
}

// ---------------------------------------------------------------------------
// Shared router state (one instance per dialect, shared by all connections)
// ---------------------------------------------------------------------------

interface ReplicaSlot {
  driver: Driver;
  /** Epoch ms until which this replica is considered down (0 = healthy). */
  downUntil: number;
}

class Router {
  readonly primaryDriver: Driver;
  private readonly replicas: ReplicaSlot[];
  private readonly cooldownMs: number;
  private rr = 0;

  constructor(
    primaryDriver: Driver,
    replicaDrivers: Driver[],
    cooldownMs: number
  ) {
    this.primaryDriver = primaryDriver;
    this.replicas = replicaDrivers.map((driver) => ({ driver, downUntil: 0 }));
    this.cooldownMs = cooldownMs;
  }

  get hasReplicas(): boolean {
    return this.replicas.length > 0;
  }

  /** Next healthy replica index in round-robin order, or null if none. */
  pickReplicaIndex(): number | null {
    const n = this.replicas.length;
    if (n === 0) return null;
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const idx = (this.rr + i) % n;
      if (this.replicas[idx].downUntil <= now) {
        this.rr = (idx + 1) % n;
        return idx;
      }
    }
    return null;
  }

  replicaDriver(index: number): Driver {
    return this.replicas[index].driver;
  }

  markReplicaDown(index: number): void {
    const slot = this.replicas[index];
    if (slot) {
      slot.downUntil = Date.now() + this.cooldownMs;
      console.warn(
        `[readWriteDialect] replica #${index} marked down for ${this.cooldownMs}ms; routing its reads to the primary`
      );
    }
  }

  async initAll(): Promise<void> {
    await this.primaryDriver.init();
    await Promise.all(this.replicas.map((r) => r.driver.init()));
  }

  async destroyAll(): Promise<void> {
    await Promise.all([
      this.primaryDriver.destroy(),
      ...this.replicas.map((r) => r.driver.destroy()),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Routing connection
// ---------------------------------------------------------------------------

class RoutingConnection implements DatabaseConnection {
  #router: Router;
  #owningDriver?: Driver;
  #subConn?: DatabaseConnection;
  #usedReplicaIndex?: number;
  #pinnedToPrimary = false;
  #sessionInfoRequested = false;

  constructor(router: Router) {
    this.#router = router;
  }

  /**
   * Bind this connection to the primary for the whole of a transaction. Called
   * by RoutingDriver.beginTransaction before any query runs. A read/write
   * transaction also flips the write pin so post-commit reads in the same
   * context read their own writes.
   */
  async bindPrimary(
    settings?: TransactionSettings
  ): Promise<DatabaseConnection> {
    this.#pinnedToPrimary = true;
    if (settings?.accessMode !== "read only") {
      markWroteInContext();
    }
    if (!this.#subConn) {
      this.#owningDriver = this.#router.primaryDriver;
      this.#subConn = await this.#owningDriver.acquireConnection();
    }
    return this.#subConn;
  }

  /** The bound sub-connection (transaction control operations require it). */
  requireSub(): DatabaseConnection {
    if (!this.#subConn) {
      throw new Error("[readWriteDialect] no active sub-connection");
    }
    return this.#subConn;
  }

  async collectSessionInfo(): Promise<void> {
    this.#sessionInfoRequested = true;
    if (this.#subConn?.collectSessionInfo) {
      await this.#subConn.collectSessionInfo();
    }
  }

  async cancelQuery(
    ...args: Parameters<NonNullable<DatabaseConnection["cancelQuery"]>>
  ): Promise<void> {
    if (this.#subConn?.cancelQuery) await this.#subConn.cancelQuery(...args);
  }

  async killSession(
    ...args: Parameters<NonNullable<DatabaseConnection["killSession"]>>
  ): Promise<void> {
    if (this.#subConn?.killSession) await this.#subConn.killSession(...args);
  }

  async executeQuery<R>(
    compiledQuery: CompiledQuery,
    options?: Parameters<DatabaseConnection["executeQuery"]>[1]
  ): Promise<QueryResult<R>> {
    const sub = await this.#resolve(compiledQuery, options);
    await this.#maybeCollectSessionInfo(sub);
    try {
      return await sub.executeQuery<R>(compiledQuery, options);
    } catch (err) {
      const retried = await this.#maybeRetryReadOnPrimary<R>(
        compiledQuery,
        options,
        err
      );
      if (retried) return retried.result;
      throw err;
    }
  }

  async *streamQuery<R>(
    compiledQuery: CompiledQuery,
    chunkSize: number,
    options?: Parameters<DatabaseConnection["streamQuery"]>[2]
  ): AsyncIterableIterator<QueryResult<R>> {
    // Streaming can't be transparently retried mid-stream, so failover for
    // streams is limited to connection-acquire time (inside #resolve).
    const sub = await this.#resolve(compiledQuery, options);
    await this.#maybeCollectSessionInfo(sub);
    yield* sub.streamQuery<R>(compiledQuery, chunkSize, options);
  }

  /** Release whichever sub-connection was acquired back to its own pool. */
  async release(): Promise<void> {
    if (this.#subConn && this.#owningDriver) {
      await this.#owningDriver.releaseConnection(this.#subConn);
    }
    this.#subConn = undefined;
    this.#owningDriver = undefined;
    this.#usedReplicaIndex = undefined;
  }

  async #maybeCollectSessionInfo(sub: DatabaseConnection): Promise<void> {
    if (this.#sessionInfoRequested && sub.collectSessionInfo) {
      try {
        await sub.collectSessionInfo();
      } catch {
        // Best-effort — only affects query cancellation, never correctness.
      }
    }
  }

  async #resolve(
    compiledQuery: CompiledQuery,
    options?: Parameters<DatabaseConnection["executeQuery"]>[1]
  ): Promise<DatabaseConnection> {
    if (this.#subConn) return this.#subConn;

    const write = isWriteNode(compiledQuery);
    if (write) markWroteInContext();

    if (this.#wantsReplica(compiledQuery, write)) {
      const replicaConn = await this.#tryAcquireReplica(options);
      if (replicaConn) return replicaConn;
      // No healthy replica (or all failed to connect) → fall through to primary.
    }

    return this.#acquirePrimary(options);
  }

  #wantsReplica(compiledQuery: CompiledQuery, write: boolean): boolean {
    if (write || this.#pinnedToPrimary || !this.#router.hasReplicas) {
      return false;
    }
    // Safe-by-default: a read with no routing frame stays on the primary, so an
    // un-wrapped write-then-read path can't serve a stale replica read.
    const ctx = getRoutingContext();
    if (!ctx || ctx.forcePrimary || ctx.wroteInContext) return false;

    if (ctx.forceReplica) {
      // Explicit opt-in (withReplica): SELECTs (non-locking) and raw reads.
      return (
        (isSelectNode(compiledQuery) && !isLockingSelect(compiledQuery)) ||
        isRawNode(compiledQuery)
      );
    }
    if (ctx.autoReplica) {
      // Automatic offload for read requests: plain, non-locking SELECTs only.
      return isSelectNode(compiledQuery) && !isLockingSelect(compiledQuery);
    }
    // Framed (e.g. a worker job) but not opted in → primary.
    return false;
  }

  async #tryAcquireReplica(
    options?: Parameters<DatabaseConnection["executeQuery"]>[1]
  ): Promise<DatabaseConnection | null> {
    // Try each healthy replica once; give up (→ primary) if all are down.
    for (;;) {
      const index = this.#router.pickReplicaIndex();
      if (index === null) return null;
      try {
        const driver = this.#router.replicaDriver(index);
        const conn = await driver.acquireConnection(options);
        this.#owningDriver = driver;
        this.#subConn = conn;
        this.#usedReplicaIndex = index;
        return conn;
      } catch (err) {
        if (isConnectionError(err)) {
          this.#router.markReplicaDown(index);
          continue;
        }
        throw err;
      }
    }
  }

  async #acquirePrimary(
    options?: Parameters<DatabaseConnection["executeQuery"]>[1]
  ): Promise<DatabaseConnection> {
    this.#owningDriver = this.#router.primaryDriver;
    this.#subConn = await this.#owningDriver.acquireConnection(options);
    this.#usedReplicaIndex = undefined;
    return this.#subConn;
  }

  /**
   * If a read fails because its replica dropped, cool the replica down and
   * retry the same read on the primary (reads are idempotent). Returns the
   * primary result, or null if the failure isn't a retryable replica error.
   */
  async #maybeRetryReadOnPrimary<R>(
    compiledQuery: CompiledQuery,
    options: Parameters<DatabaseConnection["executeQuery"]>[1] | undefined,
    err: unknown
  ): Promise<{ result: QueryResult<R> } | null> {
    if (
      this.#usedReplicaIndex === undefined ||
      isWriteNode(compiledQuery) ||
      !isConnectionError(err)
    ) {
      return null;
    }
    this.#router.markReplicaDown(this.#usedReplicaIndex);
    // Discard the broken replica connection, then re-run on the primary.
    try {
      if (this.#subConn && this.#owningDriver) {
        await this.#owningDriver.releaseConnection(this.#subConn);
      }
    } catch {
      // The connection is already broken; ignore release failures.
    }
    this.#subConn = undefined;
    this.#owningDriver = undefined;
    this.#usedReplicaIndex = undefined;
    const primary = await this.#acquirePrimary(options);
    await this.#maybeCollectSessionInfo(primary);
    return { result: await primary.executeQuery<R>(compiledQuery, options) };
  }
}

// ---------------------------------------------------------------------------
// Routing driver
// ---------------------------------------------------------------------------

class RoutingDriver implements Driver {
  #router: Router;

  constructor(router: Router) {
    this.#router = router;
  }

  async init(): Promise<void> {
    await this.#router.initAll();
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    // Lazy: the real pool connection is chosen on the first executeQuery, once
    // the query (read vs write) is known.
    return new RoutingConnection(this.#router);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings
  ): Promise<void> {
    const rc = connection as RoutingConnection;
    const sub = await rc.bindPrimary(settings);
    await this.#router.primaryDriver.beginTransaction(sub, settings);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const rc = connection as RoutingConnection;
    await this.#router.primaryDriver.commitTransaction(rc.requireSub());
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const rc = connection as RoutingConnection;
    await this.#router.primaryDriver.rollbackTransaction(rc.requireSub());
  }

  async savepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: Parameters<NonNullable<Driver["savepoint"]>>[2]
  ): Promise<void> {
    const rc = connection as RoutingConnection;
    await this.#router.primaryDriver.savepoint?.(
      rc.requireSub(),
      savepointName,
      compileQuery
    );
  }

  async rollbackToSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: Parameters<NonNullable<Driver["rollbackToSavepoint"]>>[2]
  ): Promise<void> {
    const rc = connection as RoutingConnection;
    await this.#router.primaryDriver.rollbackToSavepoint?.(
      rc.requireSub(),
      savepointName,
      compileQuery
    );
  }

  async releaseSavepoint(
    connection: DatabaseConnection,
    savepointName: string,
    compileQuery: Parameters<NonNullable<Driver["releaseSavepoint"]>>[2]
  ): Promise<void> {
    const rc = connection as RoutingConnection;
    await this.#router.primaryDriver.releaseSavepoint?.(
      rc.requireSub(),
      savepointName,
      compileQuery
    );
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    await (connection as RoutingConnection).release();
  }

  async destroy(): Promise<void> {
    await this.#router.destroyAll();
  }
}

// ---------------------------------------------------------------------------
// Dialect
// ---------------------------------------------------------------------------

/**
 * Kysely dialect that routes reads to replicas and writes/transactions to the
 * primary. SQL generation, adapter behaviour, and introspection all delegate to
 * a standard Postgres dialect over the primary — only connection acquisition is
 * overridden.
 */
export class ReadWriteRoutingDialect implements Dialect {
  #router: Router;
  // Delegate SQL compilation / adapter / introspection to the primary dialect.
  #primaryDialect: PostgresDialect;

  constructor(config: ReadWriteRoutingDialectConfig) {
    const { poolConfig, replicaCooldownMs } = config;
    const makePool = (connectionString: string) =>
      new Pool({ ...poolConfig, connectionString });

    const primaryPool = makePool(config.primaryUrl);
    this.#primaryDialect = new PostgresDialect({ pool: primaryPool });
    const primaryDriver = this.#primaryDialect.createDriver();

    const replicaDrivers = config.replicaUrls.map((url) =>
      new PostgresDialect({ pool: makePool(url) }).createDriver()
    );

    this.#router = new Router(
      primaryDriver,
      replicaDrivers,
      replicaCooldownMs ?? DEFAULT_REPLICA_COOLDOWN_MS
    );
  }

  createDriver(): Driver {
    return new RoutingDriver(this.#router);
  }

  createQueryCompiler(): QueryCompiler {
    return this.#primaryDialect.createQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return this.#primaryDialect.createAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return this.#primaryDialect.createIntrospector(db);
  }
}

/**
 * Build the Kysely dialect for a ZenStack client. When `replicaUrls` is empty
 * this returns a plain single-pool PostgresDialect — byte-for-byte the previous
 * behaviour — so the routing layer is entirely opt-in. Callers pass the replica
 * list explicitly: the app client uses the process-wide `DATABASE_REPLICA_URLS`,
 * while the multi-tenant worker client passes each tenant's own replicas (a
 * process-wide list must never be applied to a per-tenant database).
 */
export function createDialect(
  primaryUrl: string,
  replicaUrls: string[],
  poolConfig?: Omit<PoolConfig, "connectionString">
): Dialect {
  if (replicaUrls.length === 0) {
    return new PostgresDialect({
      pool: new Pool({ ...poolConfig, connectionString: primaryUrl }),
    });
  }
  return new ReadWriteRoutingDialect({ primaryUrl, replicaUrls, poolConfig });
}

// Exported for unit tests: the node classifiers plus a factory that builds a
// RoutingDriver from injected Kysely drivers, so routing behaviour (target
// selection, transaction pinning, round-robin, failover) can be exercised
// against fakes with no real database.
export const __testing = {
  isSelectNode,
  isRawNode,
  isWriteNode,
  isLockingSelect,
  isConnectionError,
  createRoutingDriver(
    primaryDriver: Driver,
    replicaDrivers: Driver[] = [],
    cooldownMs = DEFAULT_REPLICA_COOLDOWN_MS
  ): Driver {
    return new RoutingDriver(
      new Router(primaryDriver, replicaDrivers, cooldownMs)
    );
  },
};
