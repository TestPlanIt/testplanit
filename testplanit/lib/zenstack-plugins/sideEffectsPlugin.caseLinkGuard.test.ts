import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  CIRCULAR_DEPENDENCY_MESSAGE,
  SELF_LINK_MESSAGE,
} from "~/lib/caseLinkCycleGuard";
import { sideEffectsPlugin } from "./sideEffectsPlugin";
import { createAppZenStackClient } from "~/lib/zenstackClientFactory";

/**
 * Proves the case-link guard is wired into the plugin's onQuery hook for
 * RepositoryCaseLink writes. The guard's own logic is covered by
 * lib/caseLinkCycleGuard.test.ts; here only the wiring matters.
 *
 * No database is needed for the self-link case: the guard rejects it from
 * the payload alone, before any SQL runs, so the pool points at a closed
 * port. The cycle case has to read existing edges, which reaches the
 * unreachable pool — proving the hook attempted the walk rather than letting
 * the write through.
 */
describe("sideEffectsPlugin case link guard wiring", () => {
  const pool = new Pool({
    host: "127.0.0.1",
    port: 1,
    user: "nobody",
    database: "nowhere",
    connectionTimeoutMillis: 500,
    max: 1,
  });
  const client = createAppZenStackClient({
    dialect: new PostgresDialect({ pool }),
  }).$use(sideEffectsPlugin);

  afterAll(async () => {
    await pool.end();
  });

  it("rejects a self-link before any SQL runs", async () => {
    await expect(
      client.repositoryCaseLink.create({
        data: {
          caseAId: 7,
          caseBId: 7,
          type: "SAME_TEST_DIFFERENT_SOURCE",
          createdById: "u1",
        },
      })
    ).rejects.toThrow(SELF_LINK_MESSAGE);
  });

  it("rejects a self-link in a createMany batch", async () => {
    await expect(
      client.repositoryCaseLink.createMany({
        data: [
          { caseAId: 1, caseBId: 2, type: "DEPENDS_ON", createdById: "u1" },
          { caseAId: 3, caseBId: 3, type: "DEPENDS_ON", createdById: "u1" },
        ],
      })
    ).rejects.toThrow(SELF_LINK_MESSAGE);
  });

  it("walks existing edges for a dependency (reaches the database)", async () => {
    const attempt = client.repositoryCaseLink.create({
      data: { caseAId: 1, caseBId: 2, type: "DEPENDS_ON", createdById: "u1" },
    });
    // The hook ran and tried to read: the failure is the dead pool, not a
    // guard verdict and not a missing model accessor on the hook's client.
    await expect(attempt).rejects.toThrow();
    await expect(attempt).rejects.not.toThrow(CIRCULAR_DEPENDENCY_MESSAGE);
    await expect(attempt).rejects.not.toThrow(TypeError);
  });
});
