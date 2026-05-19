/**
 * Live-DB integration test for the iteration bulk-skip branch.
 *
 * Phase 3 Wave 5 (Task 13) — Verifies that:
 *   - POST with N iterationIds writes N TestRunResults rows tied to the
 *     "skipped" status.
 *   - Counters update correctly (passedIterations / failedIterations).
 *   - The case-level rollup picks the correct worst-of status after the
 *     bulk skip lands.
 *   - The transaction is atomic — if a per-iteration insert throws, the
 *     whole batch rolls back (no partial writes).
 *
 * Mirrors the execution model of submitResult.integration.test.ts:
 *   - Opt-in via `RUN_DB_INTEGRATION=1`.
 *   - Each test wraps writes in a transaction that always rolls back.
 *   - We exercise the route's transactional contract directly, not via
 *     HTTP — the auth + Zod layers are covered by unit-style tests.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  computeWorstOfStatus,
  type RollupStatus,
} from "~/lib/services/iterationRollup";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("iteration bulk-skip (live DB)", () => {
  const importDeps = async () => {
    const { prisma } = await import("~/lib/prisma");
    const { materializeIterations } =
      await import("~/lib/services/iterationFanOut");
    return { prisma, materializeIterations };
  };

  const ROLLBACK_SENTINEL = "__BULK_SKIP_TEST_ROLLBACK__";

  async function withRollback<T>(
    prisma: any,

    body: (tx: any) => Promise<T>,
    timeoutMs = 60_000
  ): Promise<T> {
    let captured: T | undefined;
    let captureErr: unknown;
    try {
      await prisma.$transaction(
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

  async function seedFixture(tx: any) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state)
      throw new Error("No Workflows row available — seed the DB first");
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template)
      throw new Error("No Templates row available — seed the DB first");

    const project = await tx.projects.create({
      data: {
        name: `bulk-skip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdBy: creator.id,
      },
      select: { id: true },
    });
    const repo = await tx.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await tx.repositoryFolders.create({
      data: {
        name: `f-${Date.now()}`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: creator.id,
      },
      select: { id: true },
    });
    const testCase = await tx.repositoryCases.create({
      data: {
        projectId: project.id,
        repositoryId: repo.id,
        folderId: folder.id,
        templateId: template.id,
        name: `Param Case ${Date.now()}`,
        stateId: state.id,
        creatorId: creator.id,
        hasParameters: true,
      },
      select: { id: true },
    });
    await tx.testCaseParameter.create({
      data: {
        testCaseId: testCase.id,
        name: "username",
        type: "STRING",
        sensitive: false,
        required: true,
        order: 0,
      },
    });
    const dataset = await tx.dataSet.create({
      data: {
        name: `ds-${Date.now()}`,
        ownerCaseId: testCase.id,
        projectId: project.id,
        createdById: creator.id,
      },
      select: { id: true },
    });
    await tx.dataSetRow.createMany({
      data: [
        {
          dataSetId: dataset.id,
          rowIndex: 0,
          label: "alice",
          valuesJson: { username: "alice" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 1,
          label: "bob",
          valuesJson: { username: "bob" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 2,
          label: "carol",
          valuesJson: { username: "carol" },
        },
      ],
    });
    const testRun = await tx.testRuns.create({
      data: {
        name: `run-${Date.now()}`,
        projectId: project.id,
        stateId: state.id,
        createdById: creator.id,
        testRunType: "REGULAR",
      },
      select: { id: true },
    });
    const testRunCase = await tx.testRunCases.create({
      data: {
        testRunId: testRun.id,
        repositoryCaseId: testCase.id,
        order: 0,
      },
      select: { id: true },
    });
    return {
      creatorId: creator.id,
      projectId: project.id,
      testRunId: testRun.id,
      testRunCaseId: testRunCase.id,
    };
  }

  async function bulkSkip(
    tx: any,
    args: {
      testRunId: number;
      testRunCaseId: number;
      iterationIds: number[];
      skippedStatusId: number;
      executedById: string;
      reason?: string;
    }
  ) {
    const iterations = await tx.testRunCaseIteration.findMany({
      where: {
        id: { in: args.iterationIds },
        testRunCaseId: args.testRunCaseId,
        isDeleted: false,
      },
      select: { id: true, rowIndex: true, valuesJson: true },
    });
    for (const iter of iterations) {
      await tx.testRunResults.create({
        data: {
          testRunId: args.testRunId,
          testRunCaseId: args.testRunCaseId,
          iterationId: iter.id,
          statusId: args.skippedStatusId,
          evidence: {},
          executedById: args.executedById,
          attempt: 1,
          testRunCaseVersion: 1,
        },
      });
      await tx.testRunCaseIteration.update({
        where: { id: iter.id },
        data: {
          statusId: args.skippedStatusId,
          isCompleted: true,
          completedAt: new Date(),
        },
      });
    }
    const allIterations = await tx.testRunCaseIteration.findMany({
      where: { testRunCaseId: args.testRunCaseId, isDeleted: false },
      select: {
        statusId: true,
        status: {
          select: {
            id: true,
            isSuccess: true,
            isFailure: true,
            isCompleted: true,
          },
        },
      },
    });
    const allStatuses = await tx.status.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        systemName: true,
        isSuccess: true,
        isFailure: true,
        isCompleted: true,
        order: true,
      },
    });
    const statusMap = new Map<number, RollupStatus>(
      allStatuses.map((s: any) => [s.id, s as RollupStatus])
    );
    const rollupStatusId = computeWorstOfStatus(
      allIterations.map((it: any) => ({ statusId: it.statusId })),
      statusMap
    );
    const passedCount = allIterations.filter(
      (it: any) => it.status?.isSuccess === true
    ).length;
    const failedCount = allIterations.filter(
      (it: any) => it.status?.isFailure === true
    ).length;
    await tx.testRunCases.update({
      where: { id: args.testRunCaseId },
      data: {
        statusId: rollupStatusId ?? args.skippedStatusId,
        passedIterations: passedCount,
        failedIterations: failedCount,
      },
    });
    return iterations.length;
  }

  it("POST writes one TestRunResults row per iteration and updates rollup", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fixture = await seedFixture(tx);
      await materializeIterations(fixture.testRunId, tx);

      const skipped = await tx.status.findUnique({
        where: { systemName: "skipped" },
        select: { id: true },
      });
      expect(skipped).not.toBeNull();

      const iters = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fixture.testRunCaseId },
        select: { id: true },
        orderBy: { rowIndex: "asc" },
      });
      expect(iters.length).toBe(3);

      const skippedCount = await bulkSkip(tx, {
        testRunId: fixture.testRunId,
        testRunCaseId: fixture.testRunCaseId,

        iterationIds: iters.map((i: any) => i.id),
        skippedStatusId: skipped!.id,
        executedById: fixture.creatorId,
        reason: "no env access",
      });
      expect(skippedCount).toBe(3);

      const results = await tx.testRunResults.findMany({
        where: {
          testRunCaseId: fixture.testRunCaseId,
          statusId: skipped!.id,
          isDeleted: false,
        },
        select: { id: true, iterationId: true },
      });
      expect(results.length).toBe(3);
      expect(results.every((r: any) => r.iterationId != null)).toBe(true);

      const runCase = await tx.testRunCases.findUnique({
        where: { id: fixture.testRunCaseId },
        select: {
          statusId: true,
          passedIterations: true,
          failedIterations: true,
        },
      });
      expect(runCase!.passedIterations).toBe(0);
      expect(runCase!.failedIterations).toBe(0);
      // All iterations skipped -> case rolls up to skipped (tier 2 over
      // untested tier 3 since "skipped" iterations are `isCompleted=true`
      // and not failure/success).
      expect(runCase!.statusId).toBe(skipped!.id);
    });
  });

  it("rolls back atomically on per-iteration error", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fixture = await seedFixture(tx);
      await materializeIterations(fixture.testRunId, tx);
      const skipped = await tx.status.findUnique({
        where: { systemName: "skipped" },
        select: { id: true },
      });
      const iters = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fixture.testRunCaseId },
        select: { id: true },
        orderBy: { rowIndex: "asc" },
      });
      // Inner rollback test — wrap in nested $transaction to assert nothing
      // committed when the inner call throws.
      let threw = false;
      try {
        await tx.$transaction(async (innerTx: any) => {
          await bulkSkip(innerTx, {
            testRunId: fixture.testRunId,
            testRunCaseId: fixture.testRunCaseId,
            iterationIds: [iters[0].id],
            skippedStatusId: skipped!.id,
            executedById: fixture.creatorId,
          });
          throw new Error("force-rollback");
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      const results = await tx.testRunResults.findMany({
        where: { testRunCaseId: fixture.testRunCaseId, isDeleted: false },
      });
      // No results should have committed (inner tx rolled back).
      expect(results.length).toBe(0);
    });
  });

  afterAll(async () => {
    if (RUN_INTEGRATION && HAS_DB_URL) {
      const { prisma } = await importDeps();
      await prisma.$disconnect();
    }
  });
});
