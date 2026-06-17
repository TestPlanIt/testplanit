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
 * Note: there is intentionally no `operationId` field here — operation
 * correlation is Phase 14. The trigger reads `operationId` defensively (NULL
 * when absent), so omitting it now is forward-compatible.
 */
export interface GucPayload {
  userId: string | null;
  requestId: string | null;
  source: string;
  tenantId: string | null;
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
export async function injectAuditGuc(
  tx: Prisma.TransactionClient,
): Promise<void> {
  const ctx = getAuditContext();
  const payload: GucPayload = {
    userId: ctx?.userId ?? null,
    requestId: ctx?.requestId ?? null,
    source: ctx?.tokenScopes?.length
      ? "api"
      : ctx?.scimTokenId
        ? "scim"
        : "web",
    tenantId: getCurrentTenantId() ?? null,
  };
  await tx.$executeRaw`SELECT set_config('app.audit_context', ${JSON.stringify(
    payload,
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
): Promise<T> {
  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.audit_context', ${JSON.stringify(
      payload,
    )}, true)`;
    return fn(tx);
  });
}
