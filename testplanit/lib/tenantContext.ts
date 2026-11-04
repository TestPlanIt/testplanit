import { AsyncLocalStorage } from "async_hooks";
import { DelayedError } from "bullmq";
import { runWithDbRouting } from "./db/routingContext";
import { TenantNotConfiguredError } from "./tenantErrors";
import { getTenantEncryptionKey } from "./tenantSecrets";

// Duplicated from lib/multiTenantDb.ts (source of truth) so this module
// stays free of the Prisma transitive dep. The check is a one-line env read
// and only used for a warning log here.
function isMultiTenantMode(): boolean {
  return process.env.MULTI_TENANT_MODE === "true";
}

// Per-job tenant context for the shared multi-tenant worker. The app pods
// always run with ENCRYPTION_KEY in their own env, but a shared worker
// serves many tenants from a single process and must resolve secrets keyed
// by the job's tenantId. The context is populated once per job and read
// synchronously by getMasterKey() so existing call sites keep working.

export interface TenantContext {
  tenantId: string;
  encryptionKey: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Best-effort tenant identifier for scoping PROCESS-LOCAL caches (e.g. the
 * IntegrationManager adapter cache) and the cross-process invalidation
 * messages that keep them coherent.
 *
 * Resolution deliberately mirrors getMasterKey's tenant domain so a cached
 * entry is always scoped to the same tenant whose encryption key built it:
 *   1. per-job tenant context — the shared multi-tenant worker serves many
 *      tenants from ONE process (set by withTenantContext).
 *   2. INSTANCE_TENANT_ID — an app pod is pinned to a single tenant.
 *   3. "default" — single-tenant deployments and dev.
 *
 * Kept Prisma-free (plain env read) so this module keeps its light dep set.
 */
export function currentTenantScope(): string {
  return (
    getTenantContext()?.tenantId ?? process.env.INSTANCE_TENANT_ID ?? "default"
  );
}

export async function runWithTenantContext<T>(
  tenantId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!tenantId) return fn();
  const encryptionKey = await getTenantEncryptionKey(tenantId);
  return storage.run({ tenantId, encryptionKey }, fn);
}

// How long after a job was created a "tenant not configured" failure is
// treated as transient (the pod's tenants.json has not caught up with the
// ConfigMap yet) rather than final (the tenant was deprovisioned). kubelet's
// ConfigMap projection lag is about a minute; this is generous on purpose.
export const TENANT_CONFIG_GRACE_MS = 10 * 60_000;
// How long to park the job before re-running it.
export const TENANT_CONFIG_RETRY_DELAY_MS = 15_000;

// Wraps a BullMQ processor so each job runs inside its tenant's context.
// Jobs with no tenantId (single-tenant mode) pass through unchanged. In
// multi-tenant mode we log a warning — validateMultiTenantJobData inside
// each processor is the authoritative check, but failing loudly here helps
// surface misconfigured enqueuers earlier in the stack trace.
//
// A TenantNotConfiguredError raised inside the processor while the job is
// younger than TENANT_CONFIG_GRACE_MS is NOT a failure: the job is moved to
// delayed and re-run later without consuming one of its attempts, so a new
// tenant's first jobs survive the window between the ConfigMap changing and
// the mounted file reflecting it. Past the grace window the error propagates
// and the job fails as before, so jobs for a genuinely removed tenant do not
// loop forever.
export function withTenantContext<
  J extends {
    data?: { tenantId?: string };
    timestamp?: number;
    moveToDelayed?: (timestamp: number, token?: string) => Promise<void>;
  },
  R,
>(
  processor: (job: J, token?: string) => Promise<R>
): (job: J, token?: string) => Promise<R> {
  // The worker's lock token passes through for processors that reschedule
  // their own job (moveToDelayed needs it).
  return async (job: J, token?: string) => {
    const tenantId = job.data?.tenantId;
    if (!tenantId && isMultiTenantMode()) {
      console.warn(
        "[tenantContext] job arrived without tenantId in multi-tenant mode " +
          "— encryption will fall back to process.env.ENCRYPTION_KEY or throw"
      );
    }
    try {
      // Establish a per-job DB routing frame so read-replica routing (when
      // configured) auto-pins reads to the primary after the job's first
      // write (read-your-own-writes). No-op when replicas aren't configured.
      return await runWithDbRouting(() =>
        runWithTenantContext(tenantId, () => processor(job, token))
      );
    } catch (err) {
      if (
        err instanceof TenantNotConfiguredError &&
        token &&
        typeof job.moveToDelayed === "function" &&
        typeof job.timestamp === "number" &&
        Date.now() - job.timestamp < TENANT_CONFIG_GRACE_MS
      ) {
        console.warn(
          `[tenantContext] tenant "${err.tenantId}" not in this worker's config yet; ` +
            `re-running job in ${TENANT_CONFIG_RETRY_DELAY_MS / 1000}s without consuming an attempt`
        );
        await job.moveToDelayed(
          Date.now() + TENANT_CONFIG_RETRY_DELAY_MS,
          token
        );
        throw new DelayedError();
      }
      throw err;
    }
  };
}
