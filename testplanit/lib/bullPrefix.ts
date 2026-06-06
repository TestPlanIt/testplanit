/**
 * Single source of truth for the BullMQ Redis key prefix.
 *
 * Unset => "bull" (BullMQ's built-in default) => byte-identical Redis keys
 * to a build without this module — existing deployments need no migration.
 *
 * Worker-group deployments set BULLMQ_PREFIX=bull-<group> so that a tenant's
 * app pod (enqueue side) and its group's worker deployment (consume side)
 * operate on a disjoint keyspace from other groups. The invariant: a tenant's
 * app pod, its worker-group deployment, and any tooling acting on that tenant
 * must all resolve to the same prefix (enforced by provisioning, which writes
 * BULLMQ_PREFIX into the tenant env Secret and the group Deployment together).
 *
 * NOTE: BullMQ pub/sub channels used for SSE (lib/notifications/channels.ts)
 * are deliberately NOT prefixed — they are tenant-scoped and must work
 * across groups.
 */

// Empty string is treated like unset (a k8s env var set to "" should mean
// "default group", not a crash).
const rawPrefix = process.env.BULLMQ_PREFIX || undefined;

if (rawPrefix !== undefined && !/^[a-zA-Z0-9_-]+$/.test(rawPrefix)) {
  // A colon (or any other separator BullMQ uses internally) in the prefix
  // would corrupt every key in the keyspace. Fail the process fast rather
  // than silently splitting queues.
  throw new Error(
    `Invalid BULLMQ_PREFIX "${rawPrefix}": must match [a-zA-Z0-9_-]+ (no colons).`
  );
}

export const BULLMQ_PREFIX = rawPrefix || "bull";
