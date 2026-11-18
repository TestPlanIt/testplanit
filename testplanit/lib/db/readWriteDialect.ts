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

import { getReplicaMaxLagMs } from "./replicaConfig";
import { getRoutingContext, markWroteInContext } from "./routingContext";
import {
  countFailover,
  countPrimaryRead,
  countReplicaRead,
  countWriteAfterReplicaRead,
  type PrimaryReadReason,
  registerReplicaStateSource,
  type ReplicaState,
  type ReplicaStateSource,
  unregisterReplicaStateSource,
} from "./routingStats";

export interface ReadWriteRoutingDialectConfig {
  /** Primary (read/write) connection string — receives all writes + transactions. */
  primaryUrl: string;
  /** Read-replica connection strings; SELECTs are spread across them. */
  replicaUrls: string[];
  /** Extra pg.Pool options applied to every pool (e.g. max, ssl). */
  poolConfig?: Omit<PoolConfig, "connectionString">;
  /** How long (ms) to skip a replica after a connection failure. Default 10000. */
  replicaCooldownMs?: number;
  /**
   * Skip a replica whose replication lag exceeds this many milliseconds.
   * Unset: lag is not measured.
   */
  maxLagMs?: number | null;
}

const DEFAULT_REPLICA_COOLDOWN_MS = 10_000;

/** Reads a replica's replication lag in milliseconds; null when unknown. */
export type ReplicaLagProbe = () => Promise<number | null>;

// A replica that has replayed everything it received is not behind, however
// long ago the last transaction was: on a quiet primary the replay timestamp
// stops advancing, and reading it alone would report an ever-growing lag.
const REPLICA_LAG_SQL = `SELECT CASE
  WHEN NOT pg_is_in_recovery() THEN 0
  WHEN pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn() THEN 0
  ELSE EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000
END AS lag_ms`;

/** How often lag is measured: twice per threshold, between 1s and 5s. */
function lagCheckIntervalMs(maxLagMs: number): number {
  return Math.min(5000, Math.max(1000, Math.floor(maxLagMs / 2)));
}

// A write that follows a replica read in the same request may have been
// decided on data the replica had not caught up with. Say so once per source.
const warnedStaleWriteLabels = new Set<string>();

function noteWriteAfterReplicaRead(label: string | undefined): void {
  countWriteAfterReplicaRead();
  const key = label ?? "(unlabelled)";
  if (warnedStaleWriteLabels.has(key) || warnedStaleWriteLabels.size >= 500) {
    return;
  }
  warnedStaleWriteLabels.add(key);
  console.warn(
    `[readWriteDialect] ${key} wrote after reading from a replica; pin it to the primary if the write depends on what it read`
  );
}

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
  /** Marked down and not yet seen back in rotation. */
  wasDown: boolean;
  /** Lag at the last probe; null when not measured or unknown. */
  lagMs: number | null;
  /** Over the lag threshold at the last probe. */
  lagging: boolean;
}

interface RouterOptions {
  cooldownMs: number;
  maxLagMs?: number | null;
  /** One per replica, in replica order. Lag is only checked when given. */
  lagProbes?: ReplicaLagProbe[];
}

class Router implements ReplicaStateSource {
  readonly primaryDriver: Driver;
  private readonly replicas: ReplicaSlot[];
  private readonly cooldownMs: number;
  private readonly maxLagMs: number | null;
  private readonly lagProbes: ReplicaLagProbe[];
  private lagTimer: ReturnType<typeof setInterval> | undefined;
  private rr = 0;

  constructor(
    primaryDriver: Driver,
    replicaDrivers: Driver[],
    options: RouterOptions
  ) {
    this.primaryDriver = primaryDriver;
    this.replicas = replicaDrivers.map((driver) => ({
      driver,
      downUntil: 0,
      wasDown: false,
      lagMs: null,
      lagging: false,
    }));
    this.cooldownMs = options.cooldownMs;
    this.maxLagMs = options.maxLagMs ?? null;
    this.lagProbes = options.lagProbes ?? [];
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
      const slot = this.replicas[idx];
      if (slot.downUntil <= now && !slot.lagging) {
        if (slot.wasDown) {
          slot.wasDown = false;
          console.warn(
            `[readWriteDialect] replica #${idx} is back in rotation`
          );
        }
        this.rr = (idx + 1) % n;
        return idx;
      }
    }
    return null;
  }

  replicaStates(): ReplicaState[] {
    const now = Date.now();
    return this.replicas.map((slot, index) => ({
      index,
      status: slot.downUntil > now ? "down" : slot.lagging ? "lagging" : "ok",
      lagMs: slot.lagMs,
    }));
  }

  /** Measure every replica's lag once and set aside the ones over the limit. */
  async checkLag(): Promise<void> {
    const maxLagMs = this.maxLagMs;
    if (maxLagMs === null) return;
    await Promise.all(
      this.replicas.map(async (slot, index) => {
        const probe = this.lagProbes[index];
        if (!probe) return;
        try {
          const lagMs = await probe();
          slot.lagMs = lagMs;
          const lagging = lagMs !== null && lagMs > maxLagMs;
          if (lagging && !slot.lagging) {
            console.warn(
              `[readWriteDialect] replica #${index} is ${Math.round(lagMs)}ms behind (limit ${maxLagMs}ms); routing its reads elsewhere`
            );
          } else if (!lagging && slot.lagging) {
            console.warn(
              `[readWriteDialect] replica #${index} has caught up and is back in rotation`
            );
          }
          slot.lagging = lagging;
        } catch (err) {
          slot.lagMs = null;
          if (isConnectionError(err)) this.markReplicaDown(index);
        }
      })
    );
  }

  replicaDriver(index: number): Driver {
    return this.replicas[index].driver;
  }

  markReplicaDown(index: number): void {
    const slot = this.replicas[index];
    if (slot) {
      const now = Date.now();
      const alreadyDown = slot.downUntil > now;
      slot.downUntil = now + this.cooldownMs;
      slot.wasDown = true;
      if (!alreadyDown) {
        console.warn(
          `[readWriteDialect] replica #${index} marked down for ${this.cooldownMs}ms; routing its reads elsewhere`
        );
      }
    }
  }

  async initAll(): Promise<void> {
    await this.primaryDriver.init();
    await Promise.all(this.replicas.map((r) => r.driver.init()));
    registerReplicaStateSource(this);
    if (this.maxLagMs !== null && this.lagProbes.length > 0 && !this.lagTimer) {
      void this.checkLag();
      this.lagTimer = setInterval(
        () => void this.checkLag(),
        lagCheckIntervalMs(this.maxLagMs)
      );
      // Never keep a process alive just to measure lag.
      this.lagTimer.unref?.();
    }
  }

  async destroyAll(): Promise<void> {
    if (this.lagTimer) {
      clearInterval(this.lagTimer);
      this.lagTimer = undefined;
    }
    unregisterReplicaStateSource(this);
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
    if (write) {
      const ctx = getRoutingContext();
      if (ctx && ctx.replicaReads > 0 && !ctx.wroteInContext) {
        noteWriteAfterReplicaRead(ctx.label);
      }
      markWroteInContext();
      return this.#acquirePrimary(options);
    }
    if (this.#pinnedToPrimary || !this.#router.hasReplicas) {
      return this.#acquirePrimary(options);
    }

    let reason = this.#primaryReadReason(compiledQuery);
    if (reason === null) {
      const replicaConn = await this.#tryAcquireReplica(options);
      if (replicaConn) {
        countReplicaRead();
        const ctx = getRoutingContext();
        if (ctx) ctx.replicaReads++;
        return replicaConn;
      }
      // No healthy replica (or all failed to connect) → fall through to primary.
      reason = "noHealthyReplica";
    }
    // Raw queries are not known to be reads, so only SELECTs are counted.
    if (isSelectNode(compiledQuery)) countPrimaryRead(reason);
    return this.#acquirePrimary(options);
  }

  /** Why this read must run on the primary, or null when a replica may serve it. */
  #primaryReadReason(compiledQuery: CompiledQuery): PrimaryReadReason | null {
    // Safe-by-default: a read with no routing frame stays on the primary, so an
    // un-wrapped write-then-read path can't serve a stale replica read.
    const ctx = getRoutingContext();
    if (!ctx) return "unframed";
    if (ctx.forcePrimary) return "forcedPrimary";
    if (ctx.wroteInContext) return "afterWrite";

    const plainSelect =
      isSelectNode(compiledQuery) && !isLockingSelect(compiledQuery);
    if (ctx.forceReplica) {
      // Explicit opt-in (withReplica): SELECTs (non-locking) and raw reads.
      return plainSelect || isRawNode(compiledQuery) ? null : "notEligible";
    }
    if (ctx.autoReplica) {
      // Automatic offload for read requests: plain, non-locking SELECTs only.
      return plainSelect ? null : "notEligible";
    }
    // Framed (e.g. a worker job) but not opted in → primary.
    return "notOptedIn";
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
    countFailover();
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

    const replicaPools = config.replicaUrls.map(makePool);
    const replicaDrivers = replicaPools.map((pool) =>
      new PostgresDialect({ pool }).createDriver()
    );
    const lagProbes = replicaPools.map((pool): ReplicaLagProbe => async () => {
      const result = await pool.query(REPLICA_LAG_SQL);
      const raw = result.rows[0]?.lag_ms;
      if (raw === null || raw === undefined) return null;
      const lagMs = Number(raw);
      return Number.isFinite(lagMs) ? lagMs : null;
    });

    this.#router = new Router(primaryDriver, replicaDrivers, {
      cooldownMs: replicaCooldownMs ?? DEFAULT_REPLICA_COOLDOWN_MS,
      maxLagMs: config.maxLagMs,
      lagProbes,
    });
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
  return new ReadWriteRoutingDialect({
    primaryUrl,
    replicaUrls,
    poolConfig,
    maxLagMs: getReplicaMaxLagMs(),
  });
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
    cooldownMs = DEFAULT_REPLICA_COOLDOWN_MS,
    lag?: { maxLagMs: number; probes: ReplicaLagProbe[] }
  ): Driver & { checkLag(): Promise<void> } {
    const router = new Router(primaryDriver, replicaDrivers, {
      cooldownMs,
      maxLagMs: lag?.maxLagMs,
      lagProbes: lag?.probes,
    });
    return Object.assign(new RoutingDriver(router), {
      checkLag: () => router.checkLag(),
    });
  },
  lagCheckIntervalMs,
  resetStaleWriteWarnings(): void {
    warnedStaleWriteLabels.clear();
  },
};
