// Live-DB integration suite for the tpl_seeded_status_guard Postgres trigger —
// the authoritative guarantee that the `untested` Status row keeps its identity
// and keeps existing.
//
// WHY A TRIGGER AND NOT A POLICY. Seven queries identify the run-default status
// by `systemName = 'untested'` so a case merely ADDED to a run is not counted as
// executed. That name check is correct and is the only way to identify the row:
// the three semantic flags cannot separate "untested" from "blocked", both being
// (false, false, false). Before this guard the guarantee lived entirely in the
// admin Statuses screen, which disables edit/delete on that row — nothing stopped
// the raw client, the generated `/api/model` surface (Status is ADMIN-writable),
// a migration, or manual SQL. A ZenStack policy would cover only the enhanced
// client; the trigger holds for every write path.
//
// The negative cases below matter as much as the positive ones: an over-broad
// guard that froze the whole row would break legitimate admin work — renaming its
// DISPLAY name, recolouring, reordering, changing scope or project assignment are
// all fine, and only identity and existence are locked.
//
// Run via (never against the default .env DATABASE_URL — that resolves to `ew`;
// always pass a scratch URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/seeded-status-guard.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { SEEDED_STATUS_GUARD_SQL } from "~/scripts/apply-triggers";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const ALLOWED_DATABASES = ["tpi_status_guard", "tpi_req20", "tpi_test"];

describeIntegration("Seeded status guard trigger (live DB)", () => {
  let client: Client;
  let colorId: number;
  let createdColor = false;
  let untestedId: number;
  let otherId: number;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();

    // Standard database guard: this suite writes and hard-deletes fixture rows,
    // and the worktree's default .env DATABASE_URL resolves to `ew`.
    const { rows } = await client.query<{ current_database: string }>(
      "select current_database()"
    );
    const dbName = rows[0]?.current_database;
    if (!ALLOWED_DATABASES.includes(dbName)) {
      await client.end();
      throw new Error(
        `Refusing to run against database "${dbName}" — the seeded-status guard ` +
          `suite only runs against ${ALLOWED_DATABASES.join(", ")}.`
      );
    }

    // Idempotent apply so the file is self-sufficient in CI, where no operator
    // ran the trigger applier ahead of time.
    await client.query(SEEDED_STATUS_GUARD_SQL);

    // A Status row needs a Color. Reuse a seeded one rather than minting a
    // family+colour pair — ColorFamily."order" is unique, so inserting one
    // collides with whatever the seed (or a previous run) already placed.
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM "Color" ORDER BY id LIMIT 1`
    );
    if (existing.rows.length > 0) {
      colorId = existing.rows[0].id;
      createdColor = false;
    } else {
      const family = await client.query<{ id: number }>(
        `INSERT INTO "ColorFamily" (name, "order")
         VALUES ($1, (SELECT COALESCE(MAX("order"::int), 0) + 1 FROM "ColorFamily")::text)
         RETURNING id`,
        [`seeded-status-guard-${Date.now()}`]
      );
      const color = await client.query<{ id: number }>(
        `INSERT INTO "Color" ("colorFamilyId", value, "order") VALUES ($1, '#888888', 1) RETURNING id`,
        [family.rows[0].id]
      );
      colorId = color.rows[0].id;
      createdColor = true;
    }
  });

  afterAll(async () => {
    if (!client) return;
    // The guard itself blocks deleting the untested fixture, so drop the
    // trigger first — this is a scratch database by the assertion above.
    await client.query(
      `DROP TRIGGER IF EXISTS tpl_seeded_status_guard_upd ON "Status";
       DROP TRIGGER IF EXISTS tpl_seeded_status_guard_del ON "Status";`
    );
    await client.query(
      `DELETE FROM "Status" WHERE "systemName" = 'untested' OR "systemName" LIKE 'blocked-%'`
    );
    if (createdColor) {
      await client.query(`DELETE FROM "Color" WHERE id = $1`, [colorId]);
    }
    await client.end();
  });

  /** A fresh pair of rows per test, so one test's writes cannot mask another's. */
  async function seedPair() {
    // `order` is an Int column, so it is derived from the table rather than a
    // timestamp — Date.now() overflows int4.
    const tag = Math.random().toString(36).slice(2, 10);
    const untested = await client.query<{ id: number }>(
      `INSERT INTO "Status" (name, "systemName", "colorId", "isEnabled", "isSuccess", "isFailure", "isCompleted", "order")
       VALUES ('Untested', 'untested', $1, true, false, false, false,
               (SELECT COALESCE(MAX("order"), 0) + 1 FROM "Status")) RETURNING id`,
      [colorId]
    );
    const other = await client.query<{ id: number }>(
      `INSERT INTO "Status" (name, "systemName", "colorId", "isEnabled", "isSuccess", "isFailure", "isCompleted", "order")
       VALUES ('Blocked', $1, $2, true, false, false, false,
               (SELECT COALESCE(MAX("order"), 0) + 1 FROM "Status")) RETURNING id`,
      [`blocked-${tag}`, colorId]
    );
    untestedId = untested.rows[0].id;
    otherId = other.rows[0].id;
  }

  async function dropPair() {
    await client.query(
      `DROP TRIGGER IF EXISTS tpl_seeded_status_guard_del ON "Status"`
    );
    await client.query(`DELETE FROM "Status" WHERE id = ANY($1::int[])`, [
      [untestedId, otherId],
    ]);
    await client.query(SEEDED_STATUS_GUARD_SQL);
  }

  async function expectBlocked(sql: string, params: unknown[]) {
    await expect(client.query(sql, params)).rejects.toThrow(
      /seeded "untested" status cannot be/
    );
  }

  describe("identity and existence are locked", () => {
    beforeAll(seedPair);
    afterAll(dropPair);

    it("refuses to rename the untested row's systemName", async () => {
      await expectBlocked(
        `UPDATE "Status" SET "systemName" = 'not_untested' WHERE id = $1`,
        [untestedId]
      );
      const { rows } = await client.query(
        `SELECT "systemName" FROM "Status" WHERE id = $1`,
        [untestedId]
      );
      expect(rows[0].systemName).toBe("untested");
    });

    it("refuses to soft-delete the untested row", async () => {
      await expectBlocked(
        `UPDATE "Status" SET "isDeleted" = true WHERE id = $1`,
        [untestedId]
      );
    });

    it("refuses to hard-delete the untested row", async () => {
      await expectBlocked(`DELETE FROM "Status" WHERE id = $1`, [untestedId]);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM "Status" WHERE id = $1`,
        [untestedId]
      );
      expect(rows[0].n).toBe(1);
    });

    it("raises check_violation, so a caller can distinguish it", async () => {
      await expect(
        client.query(`DELETE FROM "Status" WHERE id = $1`, [untestedId])
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("every other admin operation still works", () => {
    beforeAll(seedPair);
    afterAll(dropPair);

    it("allows renaming the untested row's DISPLAY name", async () => {
      await client.query(`UPDATE "Status" SET name = $1 WHERE id = $2`, [
        "Not Yet Run",
        untestedId,
      ]);
      const { rows } = await client.query(
        `SELECT name FROM "Status" WHERE id = $1`,
        [untestedId]
      );
      expect(rows[0].name).toBe("Not Yet Run");
    });

    it("allows reordering and recolouring the untested row", async () => {
      await client.query(
        `UPDATE "Status" SET "order" = "order" + 1 WHERE id = $1`,
        [untestedId]
      );
    });

    it("allows toggling the untested row's semantic flags", async () => {
      // Locked in the admin UI, deliberately NOT locked here: no query depends
      // on this row's flags, only on its name.
      await client.query(
        `UPDATE "Status" SET "isCompleted" = true WHERE id = $1`,
        [untestedId]
      );
    });

    it("allows renaming, soft-deleting and deleting any other status", async () => {
      await client.query(
        `UPDATE "Status" SET "systemName" = $1 WHERE id = $2`,
        [`blocked-renamed-${Date.now()}`, otherId]
      );
      await client.query(
        `UPDATE "Status" SET "isDeleted" = true WHERE id = $1`,
        [otherId]
      );
      await client.query(`DELETE FROM "Status" WHERE id = $1`, [otherId]);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM "Status" WHERE id = $1`,
        [otherId]
      );
      expect(rows[0].n).toBe(0);
    });
  });
});
