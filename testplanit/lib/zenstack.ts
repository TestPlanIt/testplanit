// lib/zenstack.ts
// ZenStack v3 ORM client layer. Replaces the v2 lib/prisma.ts PrismaClient +
// enhance() setup. Three layered views over a single Kysely/pg pool:
//
//   rawClient    – no plugins. @omit fields are readable here (with an explicit
//                  select/omit override) and no access policy is applied. Used
//                  for system/raw reads, ES-sync feeders, and workers.
//   baseClient   – rawClient + side-effects (audit logging, Elasticsearch sync,
//                  outbound webhooks, write-time business logic). The
//                  general-purpose server client; was lib/prisma#prisma.
//   policyClient – baseClient + @@allow/@@deny access-policy enforcement. Bind a
//                  user per request with getAuthDb(user) / $setAuth(user). Was
//                  enhance(prisma, { user }).
//
// $use() returns a NEW client that shares the same underlying connection, so all
// three views run over one pool.
import { ZenStackClient, type AuthType } from "@zenstackhq/orm";
import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import { PolicyPlugin } from "@zenstackhq/plugin-policy";
import { Pool } from "pg";

import { schema } from "~/zenstack/schema";

import { sideEffectsPlugin } from "./zenstack-plugins/sideEffectsPlugin";

function createClients() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rawClient = new ZenStackClient(schema, {
    dialect: new PostgresDialect({ pool }),
  });
  const baseClient = rawClient.$use(sideEffectsPlugin);
  const policyClient = baseClient.$use(new PolicyPlugin());
  return { pool, rawClient, baseClient, policyClient };
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
