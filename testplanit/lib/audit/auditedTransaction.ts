/**
 * auditedTransaction — open a transaction, set `app.audit_context` (SET LOCAL)
 * as its first statement, and run the caller's writes inside it so EVERY row
 * the transaction touches — parent entities AND child/value tables — is
 * attributed to the originating request.
 *
 * Use this in place of `prisma.$transaction(...)` in any request-scoped path
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
import type { TxClient } from "~/lib/zenstack";
import { TransactionIsolationLevel } from "@zenstackhq/orm";
import type { Session } from "next-auth";
import { enhance } from "@zenstackhq/runtime";
import { prisma } from "~/lib/prisma";
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
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_context', ${payload}, true)`;
    return auditTxStore.run(tx, () => fn(tx));
  }, options);
}

/**
 * Policy-preserving variant for routes that mutate through the ZenStack
 * `enhance()`d client (`getEnhancedDb`). It opens the transaction on the hooked
 * client (so the per-entity `$extends` hooks fire and — because the tx is
 * published on auditTxStore — run on THIS transaction rather than opening their
 * own), sets the GUC from the explicit session user (no separate audit frame
 * required), and hands the callback an access-controlled client bound to that
 * same transaction. Drop-in for `getEnhancedDb(session)` + `db.$transaction(fn)`.
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
  const payload = JSON.stringify(
    buildGucPayload({
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    })
  );
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_context', ${payload}, true)`;
    const etx = enhance(tx as never, {
      user,
    }) as unknown as TxClient;
    return auditTxStore.run(tx, () => fn(etx));
  }, options);
}
