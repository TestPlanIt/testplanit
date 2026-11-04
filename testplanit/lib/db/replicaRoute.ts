// lib/db/replicaRoute.ts
//
// Wraps a Next.js route handler so everything it runs executes inside a
// withReplica() routing frame: non-locking SELECTs and raw reads go to a read
// replica when DATABASE_REPLICA_URLS is configured, while writes stay on the
// primary and pin the rest of the request there. No-op without replicas.
//
// Only for read-only, replication-lag-tolerant routes (the report builder).

import { withReplica } from "./routingContext";

export function withReplicaRoute<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>
): (...args: A) => Promise<R> {
  return (...args: A) => withReplica(() => handler(...args));
}
