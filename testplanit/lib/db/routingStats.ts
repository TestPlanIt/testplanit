// lib/db/routingStats.ts
//
// Per-process counters for read/write routing (lib/db/readWriteDialect.ts), so
// an operator can see whether reads reach the replicas and, when they do not,
// why. A pure leaf module: no database imports, safe to read from a route.
//
// The counts cover this process only. Each app pod and each worker process
// keeps its own, and they reset on restart.

/** Why a read that could have used a replica ran on the primary instead. */
export type PrimaryReadReason =
  /** The code path opened no routing frame (the safe default). */
  | "unframed"
  /**
   * Framed, but the frame did not ask for replica reads: a worker job, a
   * mutating request, or a request sent with an API token.
   */
  | "notOptedIn"
  /** Pinned by withPrimary or the stickiness cookie. */
  | "forcedPrimary"
  /** A write ran earlier in the same request or job. */
  | "afterWrite"
  /** A locking SELECT, or a raw query outside withReplica. */
  | "notEligible"
  /** Every replica was down or lagging. */
  | "noHealthyReplica";

export type ReplicaStatus = "ok" | "down" | "lagging";

export interface ReplicaState {
  index: number;
  status: ReplicaStatus;
  /** Replication lag at the last probe; null when not measured. */
  lagMs: number | null;
}

export interface ReadRoutingStats {
  replicaReads: number;
  primaryReads: Record<PrimaryReadReason, number>;
  /** Reads retried on the primary after their replica connection failed. */
  failovers: number;
  /** Writes made by a request or job that had already read from a replica. */
  writesAfterReplicaRead: number;
  replicas: ReplicaState[];
}

const PRIMARY_REASONS: PrimaryReadReason[] = [
  "unframed",
  "notOptedIn",
  "forcedPrimary",
  "afterWrite",
  "notEligible",
  "noHealthyReplica",
];

function emptyPrimaryReads(): Record<PrimaryReadReason, number> {
  return Object.fromEntries(
    PRIMARY_REASONS.map((reason) => [reason, 0])
  ) as Record<PrimaryReadReason, number>;
}

interface RoutingStatsState {
  counters: {
    replicaReads: number;
    primaryReads: Record<PrimaryReadReason, number>;
    failovers: number;
    writesAfterReplicaRead: number;
  };
  sources: Set<ReplicaStateSource>;
}

/** Something that can report the state of its replicas (a dialect's router). */
export interface ReplicaStateSource {
  replicaStates(): ReplicaState[];
}

// Kept on globalThis like the database clients: Next.js can load this module
// once per server layer, and the health route must read the counters the
// dialect wrote, whichever copy each of them imported.
const globalForStats = globalThis as unknown as {
  __tpiDbRoutingStats?: RoutingStatsState;
};
const state = (globalForStats.__tpiDbRoutingStats ??= {
  counters: {
    replicaReads: 0,
    primaryReads: emptyPrimaryReads(),
    failovers: 0,
    writesAfterReplicaRead: 0,
  },
  sources: new Set<ReplicaStateSource>(),
});
const counters = state.counters;
const sources = state.sources;

export function registerReplicaStateSource(source: ReplicaStateSource): void {
  sources.add(source);
}

export function unregisterReplicaStateSource(source: ReplicaStateSource): void {
  sources.delete(source);
}

export function countReplicaRead(): void {
  counters.replicaReads++;
}

export function countPrimaryRead(reason: PrimaryReadReason): void {
  counters.primaryReads[reason]++;
}

export function countFailover(): void {
  counters.failovers++;
}

export function countWriteAfterReplicaRead(): void {
  counters.writesAfterReplicaRead++;
}

export function getReadRoutingStats(): ReadRoutingStats {
  return {
    replicaReads: counters.replicaReads,
    primaryReads: { ...counters.primaryReads },
    failovers: counters.failovers,
    writesAfterReplicaRead: counters.writesAfterReplicaRead,
    replicas: mergeReplicaStates(
      Array.from(sources).flatMap((source) => source.replicaStates())
    ),
  };
}

const STATUS_SEVERITY: Record<ReplicaStatus, number> = {
  ok: 0,
  lagging: 1,
  down: 2,
};

/**
 * One entry per replica. A process can hold several clients onto the same
 * replicas (Next builds one per server layer), each with its own view of
 * them: report the worst status any of them sees and the greatest lag.
 */
function mergeReplicaStates(states: ReplicaState[]): ReplicaState[] {
  const byIndex = new Map<number, ReplicaState>();
  for (const state of states) {
    const seen = byIndex.get(state.index);
    if (!seen) {
      byIndex.set(state.index, { ...state });
      continue;
    }
    if (STATUS_SEVERITY[state.status] > STATUS_SEVERITY[seen.status]) {
      seen.status = state.status;
    }
    if (
      state.lagMs !== null &&
      (seen.lagMs === null || state.lagMs > seen.lagMs)
    ) {
      seen.lagMs = state.lagMs;
    }
  }
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

/** Test seam. */
export function resetReadRoutingStats(): void {
  counters.replicaReads = 0;
  counters.primaryReads = emptyPrimaryReads();
  counters.failovers = 0;
  counters.writesAfterReplicaRead = 0;
  sources.clear();
}
