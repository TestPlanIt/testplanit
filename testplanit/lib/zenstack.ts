// lib/zenstack.ts
// ZenStack v3 ORM client layer. Replaces the v2 lib/db.ts DbClient +
// enhance() setup. Three layered views over one Kysely dialect (a single pg
// pool by default, or the read/write-splitting dialect when replicas are
// configured — see lib/db/readWriteDialect.ts):
//
//   rawClient    – no plugins. @omit fields are readable here (with an explicit
//                  select/omit override) and no access policy is applied. Used
//                  for system/raw reads, ES-sync feeders, and workers.
//   baseClient   – rawClient + side-effects (audit logging, Elasticsearch sync,
//                  outbound webhooks, write-time business logic). The
//                  general-purpose server client; was lib/db#db.
//   policyClient – baseClient + @@allow/@@deny access-policy enforcement. Bind a
//                  user per request with getAuthDb(user) / $setAuth(user). Was
//                  enhance(db, { user }).
//
// $use() returns a NEW client that shares the same underlying connection, so all
// three views run over one pool.
import { ZenStackClient, type AuthType } from "@zenstackhq/orm";
import { PolicyPlugin } from "@zenstackhq/plugin-policy";

import { schema } from "~/zenstack/schema";

import { getPoolConfig } from "./db/poolConfig";
import { createDialect } from "./db/readWriteDialect";
import { getReplicaUrls } from "./db/replicaConfig";
import { sideEffectsPlugin } from "./zenstack-plugins/sideEffectsPlugin";

function createClients() {
  // Opt-in read/write splitting: when DATABASE_REPLICA_URLS is set, SELECTs are
  // spread across replicas and writes/transactions stay on the primary; when it
  // is unset this is a plain single-pool Postgres dialect (unchanged behaviour).
  const rawClient = new ZenStackClient(schema, {
    // getPoolConfig(): explicit pool sizing + a bounded wait for a free slot.
    // Without it pg defaults to max:10 and an UNBOUNDED connect wait, so a
    // burst of slow queries queues every other request forever (2026-07-23).
    dialect: createDialect(
      process.env.DATABASE_URL ?? "",
      getReplicaUrls(),
      getPoolConfig()
    ),
  });
  const baseClient = rawClient.$use(sideEffectsPlugin);
  // dangerouslyAllowRawSql: the sideEffectsPlugin's beforeEntityMutation hook
  // injects the audit-context GUC via a raw `SELECT set_config(...)` inside the
  // mutation's transaction. When a mutation originates from this policy client
  // (every /api/model RPC call), that raw statement flows through the policy
  // layer, which otherwise rejects all non-CRUD nodes ("non-CRUD queries are not
  // allowed"). The only raw SQL reaching this layer is that internal,
  // parameterized GUC write — the RPC endpoint and all getAuthDb callers issue
  // pure CRUD — so allowing raw SQL here does not open a user-facing policy bypass.
  const policyClient = baseClient.$use(
    new PolicyPlugin({ dangerouslyAllowRawSql: true })
  );
  return { rawClient, baseClient, policyClient };
}

// Reuse a single set of clients across dev hot-reloads to avoid exhausting the
// connection pool (mirrors the v2 global-singleton pattern).
const globalForZenstack = globalThis as unknown as {
  __zenstackClients?: ReturnType<typeof createClients>;
};

const clients =
  process.env.NODE_ENV === "production"
    ? createClients()
    : (globalForZenstack.__zenstackClients ??= createClients());

export const rawClient = clients.rawClient;
export const baseClient = clients.baseClient;
export const policyClient = clients.policyClient;
export { schema };

export type AppAuthUser = AuthType<typeof schema>;

/**
 * Per-request access-policy-enforced client bound to the given user.
 * Pass `undefined` for an anonymous (unauthenticated) client.
 */
export function getAuthDb(user: AppAuthUser | undefined) {
  return policyClient.$setAuth(user);
}

/** Raw ORM client type — the v3 equivalent of Prisma's `DbClient` type. */
export type DbClient = typeof rawClient;

/**
 * Transaction-scoped client passed to `$transaction(async (tx) => …)` callbacks.
 * The v3 equivalent of `Prisma.TransactionClient`. Derived from the concrete
 * client type (minus the transaction-unsupported methods) so model accessors
 * stay precisely typed — `TransactionClientContract<typeof schema>` with default
 * generics widens query results to `any`.
 */
export type TxClient = Omit<
  typeof rawClient,
  "$transaction" | "$connect" | "$disconnect" | "$use"
>;
