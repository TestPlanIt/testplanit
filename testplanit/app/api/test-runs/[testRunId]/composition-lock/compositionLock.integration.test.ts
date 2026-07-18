/**
 * Live-DB integration test for the execution-start composition lock (BOR-1).
 *
 * Proves the authoritative DB-level guard (tpl_composition_lock_guard) on
 * TestRunCases: when the parent run is composition-locked, adding, removing
 * (soft-delete), or reordering a case is rejected even below the ORM policy
 * layer (raw baseDb transaction), while execution and assignment writes are
 * untouched. The ORM/policy layer (@@deny/@deny) is covered by schema
 * generation + the route unit tests; this proves the guarantee holds for any
 * path that reaches Postgres.
 *
 * Execution model mirrors bulk-skip.integration.test.ts:
 *   - Opt-in via `RUN_DB_INTEGRATION=1` (skipped in the default unit run).
 *   - The composition-lock trigger is (idempotently) applied in beforeAll.
 *   - Each test wraps writes in a transaction that always rolls back. A trigger
 *     RAISE aborts its transaction, so each blocking assertion uses its own
 *     rollback tx.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { COMPOSITION_LOCK_GUARD_SQL } from "~/scripts/apply-triggers";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB_URL = Boolean(DB_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("execution-start composition lock (live DB)", () => {
  const ROLLBACK_SENTINEL = "__COMPOSITION_LOCK_TEST_ROLLBACK__";

  beforeAll(async () => {
    // Ensure the guard trigger exists on the target DB (idempotent CREATE OR
    // REPLACE). Applied outside any test transaction as it is DDL.
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query(COMPOSITION_LOCK_GUARD_SQL);
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
   * Seed a project + repository + two cases + a run with the FIRST case added.
   * `locked` controls whether the run starts composition-locked.
   */
  async function seedFixture(tx: any, locked: boolean) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state)
      throw new Error("No Workflows row available — seed the DB first");
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template)
      throw new Error("No Templates row available — seed the DB first");
    const status = await tx.status.findFirst({ select: { id: true } });
    if (!status) throw new Error("No Status row available — seed the DB first");

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = await tx.projects.create({
      data: { name: `comp-lock-${stamp}`, createdBy: creator.id },
      select: { id: true },
    });
    const repo = await tx.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await tx.repositoryFolders.create({
      data: {
        name: `f-${stamp}`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: creator.id,
      },
      select: { id: true },
    });
    const mkCase = async (n: number) =>
      (
        await tx.repositoryCases.create({
          data: {
            projectId: project.id,
            repositoryId: repo.id,
            folderId: folder.id,
            templateId: template.id,
            name: `Case ${n} ${stamp}`,
            stateId: state.id,
            creatorId: creator.id,
          },
          select: { id: true },
        })
      ).id;
    const caseInRunId = await mkCase(1);
    const caseNotInRunId = await mkCase(2);

    const testRun = await tx.testRuns.create({
      data: {
        name: `run-${stamp}`,
        projectId: project.id,
        stateId: state.id,
        createdById: creator.id,
        testRunType: "REGULAR",
        compositionLockedAt: locked ? new Date() : null,
      },
      select: { id: true },
    });
    const runCase = await tx.testRunCases.create({
      data: { testRunId: testRun.id, repositoryCaseId: caseInRunId, order: 0 },
      select: { id: true },
    });

    return {
      creatorId: creator.id,
      statusId: status.id,
      testRunId: testRun.id,
      runCaseId: runCase.id,
      caseNotInRunId,
    };
  }

  it("blocks ADDING a case to a locked run", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await expect(
        tx.testRunCases.create({
          data: {
            testRunId: f.testRunId,
            repositoryCaseId: f.caseNotInRunId,
            order: 1,
          },
        })
      ).rejects.toThrow(/composition is locked/i);
    });
  });

  it("blocks REORDERING a case in a locked run", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await expect(
        tx.testRunCases.update({
          where: { id: f.runCaseId },
          data: { order: 99 },
        })
      ).rejects.toThrow(/composition is locked/i);
    });
  });

  it("blocks REMOVING (soft-delete) a case from a locked run", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await expect(
        tx.testRunCases.update({
          where: { id: f.runCaseId },
          data: { isDeleted: true },
        })
      ).rejects.toThrow(/composition is locked/i);
    });
  });

  it("ALLOWS execution + assignment writes on a locked run", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      const updated = await tx.testRunCases.update({
        where: { id: f.runCaseId },
        data: {
          statusId: f.statusId,
          isCompleted: true,
          passedIterations: 3,
          totalIterations: 3,
          assignedToId: f.creatorId,
        },
        select: { id: true, statusId: true, assignedToId: true },
      });
      expect(updated.statusId).toBe(f.statusId);
      expect(updated.assignedToId).toBe(f.creatorId);
    });
  });

  it("ALLOWS add / reorder / remove when the run is NOT locked", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, false);
      // Reorder
      await tx.testRunCases.update({
        where: { id: f.runCaseId },
        data: { order: 5 },
      });
      // Add
      const added = await tx.testRunCases.create({
        data: {
          testRunId: f.testRunId,
          repositoryCaseId: f.caseNotInRunId,
          order: 1,
        },
        select: { id: true },
      });
      // Remove (soft-delete)
      const removed = await tx.testRunCases.update({
        where: { id: added.id },
        data: { isDeleted: true },
        select: { id: true, isDeleted: true },
      });
      expect(removed.isDeleted).toBe(true);
    });
  });

  afterAll(() => {
    // No teardown: every test rolled its transaction back.
  });
});
