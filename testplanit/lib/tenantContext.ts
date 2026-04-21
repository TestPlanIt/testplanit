import { AsyncLocalStorage } from "async_hooks";
import { getTenantEncryptionKey } from "./tenantSecrets";

// Duplicated from lib/multiTenantPrisma.ts (source of truth) so this module
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

export async function runWithTenantContext<T>(
  tenantId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!tenantId) return fn();
  const encryptionKey = await getTenantEncryptionKey(tenantId);
  return storage.run({ tenantId, encryptionKey }, fn);
}

// Wraps a BullMQ processor so each job runs inside its tenant's context.
// Jobs with no tenantId (single-tenant mode) pass through unchanged. In
// multi-tenant mode we log a warning — validateMultiTenantJobData inside
// each processor is the authoritative check, but failing loudly here helps
// surface misconfigured enqueuers earlier in the stack trace.
export function withTenantContext<
  J extends { data?: { tenantId?: string } },
  R,
>(processor: (job: J) => Promise<R>): (job: J) => Promise<R> {
  return (job: J) => {
    const tenantId = job.data?.tenantId;
    if (!tenantId && isMultiTenantMode()) {
      console.warn(
        "[tenantContext] job arrived without tenantId in multi-tenant mode " +
          "— encryption will fall back to process.env.ENCRYPTION_KEY or throw"
      );
    }
    return runWithTenantContext(tenantId, () => processor(job));
  };
}
