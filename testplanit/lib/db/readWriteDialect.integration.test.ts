/**
 * Live-DB integration test for the read/write-routing Kysely dialect.
 *
 * Per feedback_prisma_helper_live_db_test: the unit tests
 * (readWriteDialect.test.ts) drive routing against fake drivers, which can't
 * catch real connection acquisition, SQL execution, or pool-selection bugs.
 * This file wires the dialect over TWO real pg pools — both pointed at
 * DATABASE_URL, tagged with distinct application_name values so we can observe
 * which pool actually served each query — and asserts the routing decisions
 * against a live Postgres.
 *
 * Execution model:
 *   - Skipped by default. Opt in with RUN_DB_INTEGRATION=1.
 *   - Requires DATABASE_URL pointing at a development/test database.
 *   - The one write (an AppConfig row) is created and hard-deleted in the same
 *     test, leaving the DB as it was found.
 */

import { ZenStackClient } from "@zenstackhq/orm";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "~/zenstack/schema";

import { ReadWriteRoutingDialect } from "./readWriteDialect";
import { runWithDbRouting, withPrimary, withReplica } from "./routingContext";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

// Tag each pool's connections with a distinct application_name so
// current_setting('application_name') tells us which pool served a query.
function tagUrl(base: string, appName: string): string {
  const url = new URL(base);
  url.searchParams.set("application_name", appName);
  return url.toString();
}

describeIntegration("ReadWriteRoutingDialect (live DB)", () => {
  const PRIMARY_APP = "tpi_rw_primary_test";
  const REPLICA_APP = "tpi_rw_replica_test";

  let client: any;

  beforeAll(() => {
    const base = process.env.DATABASE_URL as string;
    client = new ZenStackClient(schema, {
      dialect: new ReadWriteRoutingDialect({
        primaryUrl: tagUrl(base, PRIMARY_APP),
        // Same database standing in as a "replica" — we only assert which pool
        // served the query, not replication itself.
        replicaUrls: [tagUrl(base, REPLICA_APP)],
      }),
    });
  });

  afterAll(async () => {
    if (client) await client.$disconnect();
  });

  // A real SelectQueryNode probe (auto-offload eligible).
  const poolViaSelect = (): Promise<string> =>
    client.$qb
      .selectNoFrom(() =>
        sql<string>`current_setting('application_name')`.as("app")
      )
      .executeTakeFirstOrThrow()
      .then((r: { app: string }) => r.app);

  // A RawNode probe (only offloaded under withReplica).
  const poolViaRaw = (): Promise<string> =>
    client.$queryRaw`select current_setting('application_name') as app`.then(
      (rows: Array<{ app: string }>) => rows[0].app
    );

  it("auto-routes SELECTs to the replica inside an autoReplica frame", async () => {
    const app = await runWithDbRouting(() => poolViaSelect(), {
      autoReplica: true,
    });
    expect(app).toBe(REPLICA_APP);
  });

  it("keeps frame-less SELECTs on the primary (safe default)", async () => {
    expect(await poolViaSelect()).toBe(PRIMARY_APP);
  });

  it("keeps bare raw reads on the primary even in an autoReplica frame", async () => {
    const app = await runWithDbRouting(() => poolViaRaw(), {
      autoReplica: true,
    });
    expect(app).toBe(PRIMARY_APP);
  });

  it("routes withReplica reads to the replica and withPrimary reads to the primary", async () => {
    expect(await withReplica(() => poolViaSelect())).toBe(REPLICA_APP);
    expect(await withReplica(() => poolViaRaw())).toBe(REPLICA_APP);
    expect(await withPrimary(() => poolViaSelect())).toBe(PRIMARY_APP);
  });

  it("pins reads to the primary after a write in the same context (read-your-own-writes)", async () => {
    const key = `__rw_routing_test__${Date.now()}`;
    await runWithDbRouting(
      async () => {
        // A committed write → primary + flips the write pin.
        await client.appConfig.create({ data: { key, value: "routing-test" } });
        try {
          // The post-write read is pinned to the primary, overriding auto-offload.
          expect(await poolViaSelect()).toBe(PRIMARY_APP);
          const found = await client.appConfig.findUnique({ where: { key } });
          expect(found?.value).toBe("routing-test");
        } finally {
          await client.appConfig.delete({ where: { key } });
        }
      },
      { autoReplica: true }
    );
  });
});
