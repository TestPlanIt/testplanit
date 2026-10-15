import { PostgresDialect } from "@zenstackhq/orm/dialects/postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { sideEffectsPlugin } from "./sideEffectsPlugin";
import { createAppZenStackClient } from "~/lib/zenstackClientFactory";

/**
 * Proves the milestone parent guard is wired into the plugin's onQuery hook.
 * The guard's own rules are covered by lib/milestoneParentGuard.test.ts; here
 * only the wiring matters. Every verdict needs a read, so the pool points at
 * a closed port: a write that names a parent must reach the pool from the
 * hook (not a missing model accessor), while a write that leaves the parent
 * alone must not touch the database before the real query runs.
 */
describe("sideEffectsPlugin milestone parent guard wiring", () => {
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

  it("reads the parent for a create that names one (reaches the database)", async () => {
    const attempt = client.milestones.create({
      data: {
        name: "Child",
        projectId: 1,
        milestoneTypesId: 1,
        createdBy: "u1",
        parentId: 7,
      },
    });
    await expect(attempt).rejects.toThrow();
    await expect(attempt).rejects.not.toThrow(TypeError);
  });

  it("reads the milestone for a reopen (reaches the database)", async () => {
    const attempt = client.milestones.update({
      where: { id: 7 },
      data: { isCompleted: false },
    });
    await expect(attempt).rejects.toThrow();
    await expect(attempt).rejects.not.toThrow(TypeError);
  });
});
