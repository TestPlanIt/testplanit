/**
 * Live-DB integration test for the keep-default guard (tpl_keep_default).
 *
 * The single-default registry tables must never lose their live default while
 * live rows remain: clearing, soft-deleting or deleting the default is
 * rejected at commit, while swapping the default inside one transaction and
 * removing the last live row both pass. The trigger is DEFERRABLE INITIALLY
 * DEFERRED, so each scenario forces the check with SET CONSTRAINTS ALL
 * IMMEDIATE and then rolls back — nothing here leaves data behind.
 *
 * Fixture rows are inserted with explicit ids (max + 1) because the seed
 * inserts fixed ids without advancing the sequences.
 *
 * Run: cd testplanit && RUN_DB_INTEGRATION=1 pnpm test single-default-keep --run
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { applyKeepDefaultTriggers } from "~/scripts/apply-triggers";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIntegration =
  RUN_INTEGRATION && DB_URL ? describe : describe.skip;

const STAMP = `keepdefault-${Date.now()}`;

type Query = (sql: string, values?: unknown[]) => Promise<any>;
type Outcome = { code?: string; message: string } | null;

describeIntegration("tpl_keep_default (live DB)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    // Idempotent DDL, the same call production boots with.
    await applyKeepDefaultTriggers(client);
  });

  afterAll(async () => {
    await client?.end();
  });

  /**
   * Runs `body` inside a transaction, forces the deferred check, and always
   * rolls back. Resolves with the error the check raised, or null.
   */
  async function attempt(body: (q: Query) => Promise<void>): Promise<Outcome> {
    await client.query("BEGIN");
    try {
      await body((sql, values) => client.query(sql, values));
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      return null;
    } catch (err) {
      const e = err as { code?: string; message: string };
      return { code: e.code, message: e.message };
    } finally {
      await client.query("ROLLBACK");
    }
  }

  const expectRejected = (result: Outcome, table: string) => {
    expect(result).not.toBeNull();
    expect(result!.code).toBe("23514"); // check_violation
    expect(result!.message).toContain("tpl_keep_default");
    expect(result!.message).toContain(table);
  };

  describe("global scope (MilestoneTypes)", () => {
    const insertType = async (q: Query, name: string, isDefault: boolean) => {
      const inserted = await q(
        `INSERT INTO "MilestoneTypes" ("id", "name", "isDefault", "isDeleted")
         VALUES ((SELECT max("id") + 1 FROM "MilestoneTypes"), $1, $2, false)
         RETURNING "id"`,
        [`${STAMP}-${name}`, isDefault]
      );
      return inserted.rows[0].id as number;
    };
    // A fresh default the scenario owns (no milestones reference it, so a
    // DELETE is not blocked by the FK), plus one live sibling.
    const freshDefaultWithSibling = async (q: Query) => {
      await q(
        `UPDATE "MilestoneTypes" SET "isDefault" = false WHERE "isDefault" IS TRUE`
      );
      const id = await insertType(q, "default", true);
      await insertType(q, "sibling", false);
      return id;
    };

    it("rejects clearing the default while live siblings remain", async () => {
      const result = await attempt(async (q) => {
        const id = await freshDefaultWithSibling(q);
        await q(
          `UPDATE "MilestoneTypes" SET "isDefault" = false WHERE "id" = $1`,
          [id]
        );
      });
      expectRejected(result, "MilestoneTypes");
    });

    it("rejects soft-deleting the default while live siblings remain", async () => {
      const result = await attempt(async (q) => {
        const id = await freshDefaultWithSibling(q);
        await q(
          `UPDATE "MilestoneTypes" SET "isDeleted" = true WHERE "id" = $1`,
          [id]
        );
      });
      expectRejected(result, "MilestoneTypes");
    });

    it("rejects deleting the default while live siblings remain", async () => {
      const result = await attempt(async (q) => {
        const id = await freshDefaultWithSibling(q);
        await q(`DELETE FROM "MilestoneTypes" WHERE "id" = $1`, [id]);
      });
      expectRejected(result, "MilestoneTypes");
    });

    it("allows swapping the default inside one transaction", async () => {
      const result = await attempt(async (q) => {
        const oldId = await freshDefaultWithSibling(q);
        const successorId = await insertType(q, "successor", false);
        // Clear first, then promote: the order inside the transaction does
        // not matter because the check runs at commit.
        await q(
          `UPDATE "MilestoneTypes" SET "isDefault" = false WHERE "id" = $1`,
          [oldId]
        );
        await q(
          `UPDATE "MilestoneTypes" SET "isDefault" = true WHERE "id" = $1`,
          [successorId]
        );
      });
      expect(result).toBeNull();
    });

    it("allows removing the default once it is the last live row", async () => {
      const result = await attempt(async (q) => {
        const id = await freshDefaultWithSibling(q);
        await q(
          `UPDATE "MilestoneTypes" SET "isDeleted" = true WHERE "id" <> $1`,
          [id]
        );
        await q(
          `UPDATE "MilestoneTypes" SET "isDeleted" = true WHERE "id" = $1`,
          [id]
        );
      });
      expect(result).toBeNull();
    });

    it("keeps the last live row default (clearing its flag is rejected)", async () => {
      const result = await attempt(async (q) => {
        const id = await freshDefaultWithSibling(q);
        await q(
          `UPDATE "MilestoneTypes" SET "isDeleted" = true WHERE "id" <> $1`,
          [id]
        );
        await q(
          `UPDATE "MilestoneTypes" SET "isDefault" = false WHERE "id" = $1`,
          [id]
        );
      });
      expectRejected(result, "MilestoneTypes");
    });

    it("ignores edits to the default that keep it live and default", async () => {
      const result = await attempt(async (q) => {
        const id = await freshDefaultWithSibling(q);
        await q(`UPDATE "MilestoneTypes" SET "name" = $2 WHERE "id" = $1`, [
          id,
          `${STAMP}-renamed`,
        ]);
      });
      expect(result).toBeNull();
    });
  });

  describe("scoped (Workflows.scope)", () => {
    const insertWorkflow = async (
      q: Query,
      scope: string,
      isDefault: boolean
    ) => {
      const icon = await q(`SELECT "id" FROM "FieldIcon" LIMIT 1`);
      const color = await q(`SELECT "id" FROM "Color" LIMIT 1`);
      const inserted = await q(
        `INSERT INTO "Workflows" ("id", "name", "iconId", "colorId", "isDefault", "isEnabled", "isDeleted", "scope", "workflowType", "requiresReview")
         VALUES ((SELECT max("id") + 1 FROM "Workflows"), $1, $2, $3, $4, true, false, $5::"WorkflowScope", 'NOT_STARTED'::"WorkflowType", false)
         RETURNING "id"`,
        [
          `${STAMP}-${scope}-${isDefault ? "default" : "sibling"}`,
          icon.rows[0].id,
          color.rows[0].id,
          isDefault,
          scope,
        ]
      );
      return inserted.rows[0].id as number;
    };
    const freshScopeDefault = async (q: Query, scope: string) => {
      await q(
        `UPDATE "Workflows" SET "isDefault" = false WHERE "scope" = $1::"WorkflowScope" AND "isDefault" IS TRUE`,
        [scope]
      );
      return insertWorkflow(q, scope, true);
    };

    it("rejects clearing a scope's default while that scope has live siblings", async () => {
      const result = await attempt(async (q) => {
        const id = await freshScopeDefault(q, "SESSIONS");
        await insertWorkflow(q, "SESSIONS", false);
        await q(`UPDATE "Workflows" SET "isDefault" = false WHERE "id" = $1`, [
          id,
        ]);
      });
      expectRejected(result, "Workflows");
      expect(result!.message).toContain("scope = SESSIONS");
    });

    it("judges each scope on its own rows", async () => {
      const result = await attempt(async (q) => {
        // SESSIONS keeps a default and siblings; RUNS is emptied of live rows
        // (its default soft-deleted last) — allowed, because the SESSIONS
        // rows do not count for RUNS.
        await freshScopeDefault(q, "SESSIONS");
        await insertWorkflow(q, "SESSIONS", false);
        const runsId = await freshScopeDefault(q, "RUNS");
        await q(
          `UPDATE "Workflows" SET "isDeleted" = true WHERE "scope" = 'RUNS' AND "id" <> $1`,
          [runsId]
        );
        await q(`UPDATE "Workflows" SET "isDeleted" = true WHERE "id" = $1`, [
          runsId,
        ]);
      });
      expect(result).toBeNull();
    });
  });
});
