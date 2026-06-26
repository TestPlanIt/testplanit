/**
 * auditedTransaction — open a transaction, set `app.audit_context` (SET LOCAL)
 * as its first statement, and run the caller's writes inside it so EVERY row
 * the transaction touches — parent entities AND child/value tables — is
 * attributed to the originating request.
 *
 * Use this in place of `baseDb.$transaction(...)` in any request-scoped path
 * that mutates audited tables. The actor is sourced from the request's ALS audit
 * frame (so the caller must run inside `withAuditContext` / `runWithAuditContext`
 * — the route wrappers already do). Workers and other raw-client entry points
 * that have no ALS frame use `withAuditGuc(client, payload, fn)` instead, passing
 * the actor explicitly (e.g. from `job.data.userId`).
 *
 * The transaction is opened on the hooked client so the per-entity `$extends`
 * hooks (Elasticsearch sync, webhook/live emit, before-image diff) still fire;
 * because the GUC is already set and the transaction is published on
 * `auditTxStore`, those hooks run on THIS transaction rather than opening their
 * own (see lib/audit/auditTxStore.ts).
 */
import { getAuthDb, type TxClient } from "~/lib/zenstack";
import { TransactionIsolationLevel } from "@zenstackhq/orm";
import type { Session } from "next-auth";
import { baseDb } from "~/lib/db";
import { getUserWithRole } from "~/lib/auth/utils";
import { buildGucPayload } from "~/lib/audit/gucContext";
import { auditTxStore } from "~/lib/audit/auditTxStore";

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: TransactionIsolationLevel;
};

export async function auditedTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  const payload = JSON.stringify(buildGucPayload());
  // v3 $transaction options only accept isolationLevel (no maxWait/timeout).
  return baseDb.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${payload}, true)`;
      return auditTxStore.run(tx, () => fn(tx));
    },
    { isolationLevel: options?.isolationLevel }
  );
}

/**
 * Policy-preserving variant for routes that mutate through the access-controlled
 * client (`getEnhancedDb`). v3 cannot `enhance()` a transaction client ($use is
 * unsupported on a tx), so it inverts the v2 order: open the transaction on the
 * already-`$setAuth`'d client (so the callback's writes are policy-enforced and
 * tx-bound) and publish it on auditTxStore. Actor-context GUC injection is
 * handled per-write by the ORM side-effects plugin. Drop-in for
 * `getEnhancedDb(session)` + `db.$transaction(fn)`.
 */
export async function auditedEnhancedTransaction<T>(
  session: Session | null,
  fn: (tx: TxClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  const user = await getUserWithRole(session.user.id);
  if (!user) {
    throw new Error("User not found");
  }
  return getAuthDb(user).$transaction(
    (tx) => auditTxStore.run(tx as TxClient, () => fn(tx as TxClient)),
    { isolationLevel: options?.isolationLevel }
  );
}
