/**
 * app.audit_context GUC injection helpers for the Phase 13 CDC substrate.
 *
 * The generic audit_row_change() trigger (prisma/audit_row_change.sql) reads
 * actor/operation/tenant attribution from the `app.audit_context` Postgres GUC.
 * These two helpers set that GUC so every captured DataChangeLog row is
 * attributed to the originating request (hooked client) or job (worker).
 *
 * ── LOAD-BEARING INVARIANT (Pitfall A / SPIKE Decision 1) ──────────────────
 * `set_config('app.audit_context', ..., true)` (is_local = true, equivalent to
 * SET LOCAL) is ONLY ever issued as the FIRST statement inside an explicit
 * `$transaction` block — NEVER in autocommit. The Phase 12 spike proved that a
 * SET LOCAL issued outside a transaction silently promotes to SESSION scope
 * under pgbouncer transaction mode, leaking one request's actor onto the next
 * request that reuses the same pooled backend connection. `injectAuditGuc(tx)`
 * therefore takes an existing transaction client (it must be called inside a
 * `$transaction` callback), and `withAuditGuc(...)` opens the transaction itself
 * and sets the GUC before running any caller mutation.
 * ───────────────────────────────────────────────────────────────────────────
 */
import type { Prisma } from "@prisma/client";
import { getAuditContext } from "~/lib/auditContext";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";

/**
 * Shape of the JSON written into the `app.audit_context` GUC and read back by
 * the audit_row_change() trigger (`ctx->>'userId'` etc.). Consumed by 13-04
 * (lib/prisma.ts hook wrapping + worker entry points).
 *
 * Phase 14 CTX-03: `operationId` correlates all DataChangeLog rows written
 * within one logical save (e.g. the three writes of a single case save). The
 * trigger reads `ctx->>'operationId'` into DataChangeLog.operation_id.
 */
export interface GucPayload {
  userId: string | null;
  /** Actor display name + email, snapshotted at write time (immutable "who, as named then"). */
  userName: string | null;
  userEmail: string | null;
  requestId: string | null;
  source: string;
  tenantId: string | null;
  operationId: string | null;
  /**
   * Subject fallback for child-only operations (entityName/projectId). Normally null — the trigger
   * reads the name/project off the written root row. Set only when the owning row is not itself
   * written (see AuditContext.subjectEntityName).
   */
  entityName: string | null;
  projectId: string | null;
}

/**
 * Inject `app.audit_context` into an already-open transaction from the request's
 * AsyncLocalStorage audit context (the hooked-client path, CTX-01).
 *
 * MUST be called as the first `await` inside a `$transaction` callback — it does
 * NOT open its own transaction (see the file-level invariant). The payload's
 * `source` is derived from the unforgeable token attribution on the ALS frame:
 * `'api'` when the request carried ApiToken scopes, `'scim'` for a SCIM bearer
 * token, otherwise `'web'` (session/cookie auth).
 */
/**
 * Build the GUC payload from the request's ALS audit frame, preferring an
 * explicit actor id when the caller already resolved it (e.g. the RPC route's
 * unified `authenticatedUserId`, which covers web session / API token / SCIM).
 * A null `userId` is materialized by the correlation worker as the __system__
 * sentinel. Shared by injectAuditGuc (hooked-client $extends path), the
 * enhanceWithAudit factory (ZenStack enhanced path), and the fast-path create.
 */
export function buildGucPayload(
  explicitActor?:
    | string
    | { id?: string | null; name?: string | null; email?: string | null }
    | null
): GucPayload {
  const ctx = getAuditContext();
  // An explicit actor (the enhanced/worker paths that already resolved the user) wins over the ALS
  // frame; a bare string keeps every existing `buildGucPayload(userId)` caller working unchanged.
  const ex =
    typeof explicitActor === "string" ? { id: explicitActor } : explicitActor;
  return {
    userId: ex?.id ?? ctx?.userId ?? null,
    userName: ex?.name ?? ctx?.userName ?? null,
    userEmail: ex?.email ?? ctx?.userEmail ?? null,
    requestId: ctx?.requestId ?? null,
    source: ctx?.tokenScopes?.length
      ? "api"
      : ctx?.scimTokenId
        ? "scim"
        : "web",
    tenantId: getCurrentTenantId() ?? null,
    operationId: ctx?.operationId ?? null,
    entityName: ctx?.subjectEntityName ?? null,
    projectId:
      ctx?.subjectProjectId != null ? String(ctx.subjectProjectId) : null,
  };
}

export async function injectAuditGuc(
  tx: Prisma.TransactionClient
): Promise<void> {
  const payload = buildGucPayload();
  await tx.$executeRaw`SELECT set_config('app.audit_context', ${JSON.stringify(
    payload
  )}, true)`;
}

/**
 * Open a transaction, set `app.audit_context` from an explicit payload, then run
 * the caller's mutations inside it (the worker/raw-client path, CTX-02).
 *
 * Workers and other raw-client (prismaBase) entry points have no ALS request
 * context, so the payload is passed explicitly (e.g. userId from job.data.userId,
 * tenantId from job.data.tenantId ?? getCurrentTenantId()). The GUC is set as the
 * first statement inside the transaction this helper owns, satisfying the
 * file-level invariant.
 */
export async function withAuditGuc<T>(
  client: { $transaction: Function },
  payload: GucPayload,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
): Promise<T> {
  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.audit_context', ${JSON.stringify(
      payload
    )}, true)`;
    return fn(tx);
  }, options);
}
