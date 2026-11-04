// Dependency-free so lib/tenantContext.ts (which must stay off the Prisma
// transitive dep) and lib/multiTenantDb.ts can both import it.

/**
 * Thrown when a job names a tenant that is not in this process's tenant
 * config. In a shared worker this is usually transient: kubelet can take up
 * to a minute or so to project a changed ConfigMap into a running pod, so a
 * freshly provisioned tenant's first jobs arrive before tenants.json does.
 * withTenantContext (lib/tenantContext.ts) retries these for a grace window
 * without consuming BullMQ attempts.
 */
export class TenantNotConfiguredError extends Error {
  readonly tenantId: string;

  constructor(tenantId: string) {
    super(`No configuration found for tenant: ${tenantId}`);
    this.name = "TenantNotConfiguredError";
    this.tenantId = tenantId;
  }
}
