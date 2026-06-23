/**
 * enhanceWithAudit — a ZenStack `enhance()` wrapper that attributes the actor
 * for trigger-based CDC.
 *
 * ZenStack's `enhance(prisma, {user})` (the access-controlled mutation client
 * used by the RPC route, server actions, and custom API routes) bypasses the
 * `lib/prisma.ts` `$extends` `injectAuditGuc` hook, so the `app.audit_context`
 * GUC is never set on that path and the captured `DataChangeLog.actor` is empty
 * (→ recorded as `__system__`). This factory restores actor attribution by
 * running every WRITE inside a transaction that sets the GUC first, then
 * re-issuing the operation on a transaction-bound enhanced client so the policy
 * check and the write share that transaction. Reads pass straight through.
 *
 * IMPORTANT — enhance the RAW base client (`prismaBase`), not the hooked
 * `lib/prisma` client. When `enhance()` wraps a client that itself carries
 * `$extends` query hooks (repositoryCases / testRuns / sessions / issue / …),
 * ZenStack routes those models' writes through a path that ALSO skips the
 * post-enhance `audit-guc` `$extends` below — so the primary entities would
 * silently lose actor attribution (blank actor + null operationId → "System")
 * while hook-less models (CaseFieldValues, Steps, …) kept it. Enhancing the
 * un-hooked base client makes `$allOperations` fire for every model uniformly.
 * Nothing is lost by skipping the hooked client: `enhance()` bypassed its
 * ES-sync / webhook hooks already, which is why the RPC route carries explicit
 * ES-sync / webhook-emit shims.
 *
 * The actor is sourced from the authenticated `user` (already unified across
 * web session / API token / SCIM by the caller) with `buildGucPayload` filling
 * source / requestId / operationId / tenant from the ALS audit frame.
 *
 * Re-entrancy: a write issued while already inside an audit GUC transaction
 * (the re-issued op, or a nested write) does NOT open a second transaction —
 * it runs on the current one, preserving caller atomicity. `SET LOCAL` keeps
 * the GUC transaction-scoped (pgbouncer-safe).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { enhance } from "@zenstackhq/runtime";
import { prisma as prismaBase } from "~/lib/prismaBase";
import { buildGucPayload } from "~/lib/audit/gucContext";

const inAuditTx = new AsyncLocalStorage<boolean>();

const WRITE_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

type EnhanceUser = Parameters<typeof enhance>[1];

export function enhanceWithAudit(
  user: EnhanceUser extends { user?: infer U } ? U : unknown
) {
  // Snapshot the actor's id + name + email at write time so the readable AuditLog never looks the
  // user up later (a later lookup would show their current name, not the name they had then).
  const actor =
    (user as
      | { id?: string | null; name?: string | null; email?: string | null }
      | null
      | undefined) ?? null;

  return enhance(prismaBase, { user: user as never }).$extends({
    name: "audit-guc",
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          if (!WRITE_OPS.has(operation) || inAuditTx.getStore()) {
            return query(args);
          }
          const payload = JSON.stringify(
            buildGucPayload(
              actor
                ? { id: actor.id, name: actor.name, email: actor.email }
                : null
            )
          );
          return prismaBase.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.audit_context', ${payload}, true)`;
            const accessor = model.charAt(0).toLowerCase() + model.slice(1);
            return inAuditTx.run(true, () =>
              (
                enhance(tx as never, {
                  user: user as never,
                }) as unknown as Record<
                  string,
                  Record<string, (a: unknown) => Promise<unknown>>
                >
              )[accessor][operation](args)
            );
          });
        },
      },
    },
  });
}
