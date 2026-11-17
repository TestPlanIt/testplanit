import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { DEPENDENCY_GATE_GUARD_SQL } from "~/scripts/apply-triggers";

/**
 * Live-DB proof of the dependency-gate trigger (tpl_dependency_gate_guard):
 * the authoritative backstop behind lib/services/dependencyGate.ts. Every
 * write below goes straight through the ORM client, not submit-result, so
 * what is under test is the database refusing the row.
 *
 * Opt-in like the other live-DB suites: RUN_DB_INTEGRATION=1 plus a
 * DATABASE_URL pointing at a scratch database. Every case runs inside a
 * transaction that is always rolled back.
 */
const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB_URL = Boolean(DB_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("dependency gate trigger (live DB)", () => {
  const ROLLBACK_SENTINEL = "__DEPENDENCY_GATE_TEST_ROLLBACK__";

  beforeAll(async () => {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query(DEPENDENCY_GATE_GUARD_SQL);
    } finally {
      await client.end();
    }
  });

  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    return { baseDb };
  };

  afterAll(async () => {
    const { baseDb } = await importDeps();
    await baseDb.$disconnect?.();
  });

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
   * Seed a project (enforcing or not), a prerequisite case A, a dependant case
   * B that DEPENDS_ON A, and a run holding both. Returns the ids plus one
   * success-flagged and one non-success status.
   */
  async function seedFixture(tx: any, enforce: boolean) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state)
      throw new Error("No Workflows row available — seed the DB first");
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template)
      throw new Error("No Templates row available — seed the DB first");
    const passed = await tx.status.findFirst({
      where: { isSuccess: true, isDeleted: false },
      select: { id: true },
    });
    const notPassed = await tx.status.findFirst({
      where: { isSuccess: false, isDeleted: false },
      select: { id: true },
    });
    if (!passed || !notPassed)
      throw new Error("Need one success and one non-success Status row");

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = await tx.projects.create({
      data: {
        name: `dep-gate-${stamp}`,
        createdBy: creator.id,
        enforceCaseDependencies: enforce,
      },
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
    const mkCase = async (n: string) =>
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
    const caseA = await mkCase("A");
    const caseB = await mkCase("B");
    await tx.repositoryCaseLink.create({
      data: {
        caseAId: caseB,
        caseBId: caseA,
        type: "DEPENDS_ON",
        createdById: creator.id,
      },
    });

    const testRun = await tx.testRuns.create({
      data: {
        name: `run-${stamp}`,
        projectId: project.id,
        stateId: state.id,
        createdById: creator.id,
        testRunType: "REGULAR",
      },
      select: { id: true },
    });
    const runCaseA = await tx.testRunCases.create({
      data: { testRunId: testRun.id, repositoryCaseId: caseA, order: 0 },
      select: { id: true },
    });
    const runCaseB = await tx.testRunCases.create({
      data: { testRunId: testRun.id, repositoryCaseId: caseB, order: 1 },
      select: { id: true },
    });

    return {
      creatorId: creator.id,
      passedId: passed.id,
      notPassedId: notPassed.id,
      testRunId: testRun.id,
      runCaseAId: runCaseA.id,
      runCaseBId: runCaseB.id,
    };
  }

  const resultFor = (f: any, runCaseId: number, statusId: number) => ({
    testRunId: f.testRunId,
    testRunCaseId: runCaseId,
    statusId,
    executedById: f.creatorId,
    attempt: 1,
    testRunCaseVersion: 1,
    evidence: {},
  });

  it("refuses a result for the dependant while its prerequisite is untested", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await expect(
        tx.testRunResults.create({
          data: resultFor(f, f.runCaseBId, f.passedId),
        })
      ).rejects.toThrow(/blocked until its prerequisites pass/i);
    });
  });

  it("refuses the dependant while the prerequisite's status is not a pass", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await tx.testRunCases.update({
        where: { id: f.runCaseAId },
        data: { statusId: f.notPassedId },
      });
      await expect(
        tx.testRunResults.create({
          data: resultFor(f, f.runCaseBId, f.passedId),
        })
      ).rejects.toThrow(/blocked until its prerequisites pass/i);
    });
  });

  it("accepts the dependant once the prerequisite has passed", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await tx.testRunCases.update({
        where: { id: f.runCaseAId },
        data: { statusId: f.passedId },
      });
      const created = await tx.testRunResults.create({
        data: resultFor(f, f.runCaseBId, f.passedId),
        select: { id: true },
      });
      expect(created.id).toBeGreaterThan(0);
    });
  });

  it("never blocks the prerequisite itself", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      const created = await tx.testRunResults.create({
        data: resultFor(f, f.runCaseAId, f.passedId),
        select: { id: true },
      });
      expect(created.id).toBeGreaterThan(0);
    });
  });

  it("does nothing when the project does not enforce dependencies", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, false);
      const created = await tx.testRunResults.create({
        data: resultFor(f, f.runCaseBId, f.passedId),
        select: { id: true },
      });
      expect(created.id).toBeGreaterThan(0);
    });
  });

  it("ignores a prerequisite that was removed from the run", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await tx.testRunCases.update({
        where: { id: f.runCaseAId },
        data: { isDeleted: true },
      });
      const created = await tx.testRunResults.create({
        data: resultFor(f, f.runCaseBId, f.passedId),
        select: { id: true },
      });
      expect(created.id).toBeGreaterThan(0);
    });
  });

  it("catches a nested create through the run case", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const f = await seedFixture(tx, true);
      await expect(
        tx.testRunCases.update({
          where: { id: f.runCaseBId },
          data: {
            results: {
              create: {
                testRunId: f.testRunId,
                statusId: f.passedId,
                executedById: f.creatorId,
                attempt: 1,
                testRunCaseVersion: 1,
                evidence: {},
              },
            },
          },
        })
      ).rejects.toThrow(/blocked until its prerequisites pass/i);
    });
  });
});
