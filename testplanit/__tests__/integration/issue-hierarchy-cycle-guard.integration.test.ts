// Live-DB integration scaffold for the tpl_issue_hierarchy_cycle_guard
// Postgres trigger (HIER-03, DB-level authoritative layer).
//
// The trigger is the authoritative layer because the declarative ZenStack
// policy language has no recursion primitive and therefore cannot express
// "is the new parent a descendant of self" — only a real recursive query
// inside Postgres can walk the ancestor chain. The app-layer assertNoCycle
// guard gives friendly errors first for the one real caller that exists
// today, but the trigger is what actually holds for every write path,
// including ones that bypass the service layer entirely.
//
// Entries 1, 3, and 4 below exist because no production code path writes
// Issue.parentId yet (that lands in Phase 22) — the sync-style upsert and
// bulk-import write shapes have to be simulated with raw transaction writes
// rather than exercised through real callers.
//
// Entry 6 exists because a row-level BEFORE trigger on its own does not
// serialize two concurrent reparents — each transaction sees a
// pre-commit snapshot of the tree, so two concurrent reparents that would
// only form a cycle together can each individually pass the trigger's
// check unless the trigger also takes an advisory lock.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-hierarchy-cycle-guard.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { ISSUE_HIERARCHY_CYCLE_GUARD_SQL } from "~/scripts/apply-triggers";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("Issue hierarchy cycle guard trigger (live DB)", () => {
  const ROLLBACK_SENTINEL = "__ISSUE_HIERARCHY_CYCLE_GUARD_TEST_ROLLBACK__";

  beforeAll(async () => {
    // Standard database guard: refuse to run DDL/writes against anything
    // other than the tpi_req20 scratch database or tpi_test (CI's ephemeral
    // service database) — the worktree's default .env DATABASE_URL resolves
    // to `ew`, and this suite must never touch it.
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ current_database: string }>(
        "select current_database()"
      );
      const dbName = rows[0]?.current_database;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `Refusing to run against database "${dbName}" — the issue-hierarchy ` +
            `cycle-guard integration suite only runs against tpi_req20 (scratch) ` +
            `or tpi_test (CI's ephemeral service database).`
        );
      }
      // Idempotent apply so the file is self-sufficient in CI, where no
      // operator ran the trigger applier ahead of time.
      await client.query(ISSUE_HIERARCHY_CYCLE_GUARD_SQL);
    } finally {
      await client.end();
    }
  });

  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    return { baseDb };
  };

  async function withRollback<T>(
    baseDb: any,
    body: (tx: any) => Promise<T>,
    timeoutMs = 60_000
  ): Promise<T> {
    let captured: T | undefined;
    let captureErr: unknown;
    try {
      await baseDb.$transaction(
        async (tx: any) => {
          try {
            captured = await body(tx);
          } catch (err) {
            captureErr = err;
          }
          throw new Error(ROLLBACK_SENTINEL);
        },
        { timeout: timeoutMs }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes(ROLLBACK_SENTINEL)) throw err;
    }
    if (captureErr) throw captureErr;
    return captured as T;
  }

  /**
   * Seed a linear A -> B -> C chain (B's parent A, C's parent B) inside a
   * project, stamp-prefixed with `cyc-` + a run-unique tag so fixture rows
   * are greppable and never collide across tests. `aExtra` lets a test graft
   * extra columns (e.g. externalId/integrationId) onto the root node A —
   * used by the sync-upsert vector to make A the dedup-key target.
   */
  async function seedTree(tx: any, aExtra: Record<string, unknown> = {}) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = await tx.projects.create({
      data: { name: `cyc-${stamp}`, createdBy: creator.id },
      select: { id: true },
    });

    const mkIssue = async (
      label: string,
      parentId: number | null,
      extra: Record<string, unknown> = {}
    ) =>
      (
        await tx.issue.create({
          data: {
            name: `cyc-${stamp}-${label}`,
            title: `cyc-${stamp}-${label}`,
            createdById: creator.id,
            projectId: project.id,
            parentId,
            ...extra,
          },
          select: { id: true },
        })
      ).id as number;

    const a = await mkIssue("A", null, aExtra);
    const b = await mkIssue("B", a);
    const c = await mkIssue("C", b);

    return {
      creatorId: creator.id as string,
      projectId: project.id as number,
      stamp,
      mkIssue,
      a,
      b,
      c,
    };
  }

  it("blocks a raw UPDATE that reparents a node under its own descendant", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { a, c } = await seedTree(tx);
      // A trigger RAISE aborts the whole Postgres transaction, so the
      // rejected statement runs under its own SAVEPOINT — released back to
      // on rejection — leaving the outer transaction usable for the
      // post-rejection re-read below.
      await tx.$executeRawUnsafe("SAVEPOINT cyc_reparent_sp");
      // This write goes straight through the transaction client — it
      // exercises the trigger and never touches assertNoCycle.
      await expect(
        tx.issue.update({ where: { id: a }, data: { parentId: c } })
      ).rejects.toThrow(/cycle/i);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT cyc_reparent_sp");

      const row = await tx.issue.findUnique({
        where: { id: a },
        select: { parentId: true },
      });
      expect(row?.parentId).toBeNull();
    });
  });

  it("blocks a raw UPDATE that makes a node its own parent", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { b } = await seedTree(tx);
      await tx.$executeRawUnsafe("SAVEPOINT cyc_self_parent_sp");
      await expect(
        tx.issue.update({ where: { id: b }, data: { parentId: b } })
      ).rejects.toThrow(/own parent/i);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT cyc_self_parent_sp");

      const row = await tx.issue.findUnique({
        where: { id: b },
        select: { parentId: true },
      });
      expect(row?.parentId).not.toBe(b);
    });
  });

  it("blocks a cycle written inside a multi-row bulk-import transaction", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { a, c, mkIssue } = await seedTree(tx);
      // A multi-row batch inside one transaction, as a bulk import would
      // write: extend the chain a couple more hops before the closing edge.
      const d = await mkIssue("D", c);
      const e = await mkIssue("E", d);
      // The closing edge that would complete the cycle gets no exemption
      // just because it's the Nth write in this transaction.
      await expect(
        tx.issue.update({ where: { id: a }, data: { parentId: e } })
      ).rejects.toThrow(/cycle/i);
    });
  });

  it("blocks a cycle written through a sync-style upsert on the dedup key", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const integration = await tx.integration.create({
        data: {
          name: `cyc-sync-${Date.now()}`,
          provider: "JIRA",
          authType: "OAUTH2",
          status: "ACTIVE",
          credentials: {},
          settings: {},
        },
        select: { id: true },
      });
      const externalId = `cyc-ext-${Date.now()}`;
      const { creatorId, c } = await seedTree(tx, {
        externalId,
        integrationId: integration.id,
      });

      // Simulates the shape Phase 22's sync writer will use: an upsert
      // keyed on the (externalId, integrationId) dedup key whose update
      // branch reparents the already-existing synced row under its own
      // descendant. No exemption for the upsert write path.
      await expect(
        tx.issue.upsert({
          where: {
            externalId_integrationId: {
              externalId,
              integrationId: integration.id,
            },
          },
          create: {
            name: `cyc-sync-should-not-create-${externalId}`,
            title: `cyc-sync-should-not-create-${externalId}`,
            createdById: creatorId,
            externalId,
            integrationId: integration.id,
          },
          update: { parentId: c },
        })
      ).rejects.toThrow(/cycle/i);
    });
  });

  it("allows a legitimate reparent within the same tree", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { a, c } = await seedTree(tx);
      // C moves from B to A — still inside the same tree, not a cycle.
      // Without this vector the suite could pass with a trigger that
      // blocks everything.
      const updated = await tx.issue.update({
        where: { id: c },
        data: { parentId: a },
        select: { id: true, parentId: true },
      });
      expect(updated.parentId).toBe(a);

      const row = await tx.issue.findUnique({
        where: { id: c },
        select: { parentId: true },
      });
      expect(row?.parentId).toBe(a);
    });
  });

  /**
   * Polls pg_stat_activity (via a connection distinct from the target
   * session) until the target backend pid reports it is waiting on a lock,
   * or the timeout elapses. Used to prove the second concurrent reparent is
   * genuinely blocked on the advisory lock before the first session commits
   * — without this, a race between "issue the UPDATE" and "commit the
   * other session" could pass even if the lock were never acquired.
   */
  async function waitUntilBlocked(
    pollClient: Client,
    targetPid: number,
    timeoutMs = 5_000
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { rows } = await pollClient.query<{
        wait_event_type: string | null;
      }>("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [
        targetPid,
      ]);
      if (rows[0]?.wait_event_type === "Lock") return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  it("blocks the second of two concurrent reparents that would together form a cycle", async () => {
    const { baseDb } = await importDeps();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const creator = await baseDb.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const project = await baseDb.projects.create({
      data: { name: `cyc-conc-${stamp}`, createdBy: creator.id },
      select: { id: true },
    });
    const x = await baseDb.issue.create({
      data: {
        name: `cyc-conc-${stamp}-X`,
        title: `cyc-conc-${stamp}-X`,
        createdById: creator.id,
        projectId: project.id,
      },
      select: { id: true },
    });
    const y = await baseDb.issue.create({
      data: {
        name: `cyc-conc-${stamp}-Y`,
        title: `cyc-conc-${stamp}-Y`,
        createdById: creator.id,
        projectId: project.id,
      },
      select: { id: true },
    });

    const client1 = new Client({ connectionString: DB_URL });
    const client2 = new Client({ connectionString: DB_URL });
    await client1.connect();
    await client2.connect();

    try {
      const { rows: pidRows } = await client2.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid"
      );
      const client2Pid = pidRows[0].pid;

      // Session 1: reparent X under Y, do not commit yet. The trigger takes
      // the advisory lock and finds no cycle from this session's snapshot
      // (Y has no parent), so this UPDATE returns immediately, still
      // uncommitted.
      await client1.query("BEGIN");
      await client1.query('UPDATE "Issue" SET "parentId" = $1 WHERE id = $2', [
        y.id,
        x.id,
      ]);

      // Session 2: reparent Y under X — the other half of the cycle. This
      // must block on the advisory lock rather than return, because session
      // 1 still holds it inside an open transaction.
      await client2.query("BEGIN");
      const client2Promise = client2.query(
        'UPDATE "Issue" SET "parentId" = $1 WHERE id = $2',
        [x.id, y.id]
      );

      const blocked = await waitUntilBlocked(client1, client2Pid);
      expect(blocked).toBe(true);

      // Now let session 1 commit — its edge (X -> Y) becomes visible.
      await client1.query("COMMIT");

      // Session 2's walk now runs after session 1's commit and sees the new
      // edge: rejected as a cycle.
      await expect(client2Promise).rejects.toThrow(/cycle/i);
      await client2.query("ROLLBACK").catch(() => {});
    } finally {
      await client1.end().catch(() => {});
      await client2.end().catch(() => {});
      await baseDb.issue.deleteMany({ where: { id: { in: [x.id, y.id] } } });
      await baseDb.projects.delete({ where: { id: project.id } });
    }
  });

  afterAll(() => {
    // No teardown beyond what each test already handles: tests 1-5 roll
    // their transactions back, and test 6 deletes its committed rows in its
    // own finally block.
  });
});
