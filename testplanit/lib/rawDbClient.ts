// lib/rawDbClient.ts
// Standalone raw ZenStack client factory for seed scripts, one-off scripts, and
// e2e tests that previously created their own raw PrismaClient. Each call
// returns an INDEPENDENT client with its own connection pool, so callers keep
// managing their own lifecycle (e.g. `await db.$disconnect()` in afterAll).
//
// This is the raw client: no access policy and no audit/Elasticsearch/webhook
// side-effects — matching the bare client these call sites used. App runtime
// code should use lib/zenstack.ts (baseClient / getAuthDb) instead.
import { ZenStackClient } from "@zenstackhq/orm";
import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import { Pool } from "pg";

import { schema } from "~/zenstack/schema";

export function createRawDbClient() {
  return new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: process.env.DATABASE_URL }),
    }),
  });
}
