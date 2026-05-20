/**
 * Live-DB integration test for the submit-result iteration branch.
 *
 * Phase 3 Wave 2 (Task 6) — exercises the full submit-result transaction
 * path against a real database to catch:
 *   - Schema/Prisma mismatches (e.g., a missed `pnpm generate` would surface
 *     as an unknown-column error here, not in the mocked unit tests).
 *   - Counter recompute correctness (passedIterations / failedIterations).
 *   - Worst-of rollup writing the correct Status.id to TestRunCases.
 *   - The TestRunResults.iterationId FK actually persists.
 *
 * Execution model mirrors `lib/services/iterationFanOut.integration.test.ts`:
 *   - Skipped by default; opt-in via `RUN_DB_INTEGRATION=1`.
 *   - Each test runs inside a `prisma.$transaction` that rolls back at the
 *     end. The DB is never mutated.
 *   - Lazy import of Prisma so the module stays cheap when skipped.
 *
 * NOTE: this test calls the rollup helper + materializer directly inside
 * the rollback transaction rather than POSTing to the route handler. The
 * route's HTTP wrapper, auth check, and Zod parsing have unit coverage in
 * `route.test.ts`; what THIS test covers is the transactional contract
 * (atomicity, counter math, FK writes) that mocked `tx` cannot detect.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  computeWorstOfStatus,
  type RollupStatus,
} from "~/lib/services/iterationRollup";
import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";
import { emitIterationResultRecorded } from "~/lib/webhooks/event-emitters/iterationEvents";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("submit-result iteration branch (live DB)", () => {
  const importDeps = async () => {
    const { prisma } = await import("~/lib/prisma");
    const { materializeIterations } =
      await import("~/lib/services/iterationFanOut");
    return { prisma, materializeIterations };
  };

  const ROLLBACK_SENTINEL = "__SUBMIT_RESULT_TEST_ROLLBACK__";

  /**
   * Run `body` inside a transaction and ALWAYS roll back. Same shape as
   * the iterationFanOut integration test's helper.
   */
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

  /**
   * Seeds a parameterized run-case with a 3-row dataset and materializes
   * the iterations. Returns the IDs the test needs to drive submissions.
   */
  async function seedFixture(tx: any) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) {
      throw new Error("No User row available — seed the DB first");
    }
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state) {
      throw new Error("No Workflows row available — seed the DB first");
    }
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template) {
      throw new Error("No Templates row available — seed the DB first");
    }

    const project = await tx.projects.create({
      data: {
        name: `submit-result-iter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    await tx.testCaseParameter.createMany({
      data: [
        {
          testCaseId: testCase.id,
          name: "username",
          type: "STRING",
          sensitive: false,
          required: true,
          order: 0,
        },
        {
          testCaseId: testCase.id,
          name: "password",
          type: "STRING",
          sensitive: true,
          required: true,
          order: 1,
        },
      ],
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
          valuesJson: { username: "alice", password: "p1" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 1,
          label: "bob",
          valuesJson: { username: "bob", password: "p2" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 2,
          label: "carol",
          valuesJson: { username: "carol", password: "p3" },
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
      repositoryCaseId: testCase.id,
      datasetId: dataset.id,
      testRunId: testRun.id,
      testRunCaseId: testRunCase.id,
    };
  }

  /**
   * Replicates the route's iteration-branch transaction body for ONE
   * submission. The route itself owns auth/permissions/Zod parsing; this
   * helper is what runs inside the route's `prisma.$transaction` once we
   * know the input is valid. Keeping it factored out lets the test exercise
   * the exact same writes the route makes without mounting Next.js.
   */
  async function submitOneIterationResult(
    tx: any,
    args: {
      testRunId: number;
      testRunCaseId: number;
      iterationId: number;
      statusId: number;
      executedById: string;
      projectId: number;
      // When true, the submitter has RESULTS.READ_SENSITIVE — drives the
      // audit redaction's `viewerCanReadSensitive` flag. The webhook
      // redaction is ALWAYS false regardless (D-13).
      viewerCanReadSensitive?: boolean;
      // When true, the helper calls emitIterationResultRecorded inside
      // the same tx (mirrors the route's wiring). Default true so the
      // pre-existing tests' outbox-row presence is preserved.
      emitWebhook?: boolean;
    }
  ): Promise<{
    createdResult: any;
    auditRedactedValues: Record<string, unknown> | null;
    webhookRedactedValues: Record<string, unknown> | null;
  }> {
    const viewerCanReadSensitive = args.viewerCanReadSensitive === true;
    const emitWebhook = args.emitWebhook !== false;

    const createdResult = await tx.testRunResults.create({
      data: {
        testRunId: args.testRunId,
        testRunCaseId: args.testRunCaseId,
        iterationId: args.iterationId,
        statusId: args.statusId,
        evidence: {},
        executedById: args.executedById,
        attempt: 1,
        testRunCaseVersion: 1,
      },
    });

    // Capture iteration row pre-update so we have valuesJson + rowIndex
    // available for both redactions (matches the route's behavior).
    const iterBefore = await tx.testRunCaseIteration.findUnique({
      where: { id: args.iterationId },
      select: { rowIndex: true, valuesJson: true },
    });

    await tx.testRunCaseIteration.update({
      where: { id: args.iterationId },
      data: {
        statusId: args.statusId,
        isCompleted: true,
        completedAt: new Date(),
      },
    });

    const iterations = await tx.testRunCaseIteration.findMany({
      where: {
        testRunCaseId: args.testRunCaseId,
        isDeleted: false,
      },
      select: {
        statusId: true,
        status: {
          select: {
            id: true,
            systemName: true,
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
      allStatuses.map((s: RollupStatus) => [s.id, s])
    );
    const rollupStatusId = computeWorstOfStatus(
      iterations.map((it: any) => ({ statusId: it.statusId })),
      statusMap
    );
    const passedCount = iterations.filter(
      (it: any) => it.status?.isSuccess === true
    ).length;
    const failedCount = iterations.filter(
      (it: any) => it.status?.isFailure === true
    ).length;
    const skippedCount = iterations.filter(
      (it: any) =>
        it.status != null &&
        it.status.isSuccess === false &&
        it.status.isFailure === false &&
        it.status.isCompleted === true
    ).length;

    await tx.testRunCases.update({
      where: { id: args.testRunCaseId },
      data: {
        statusId: rollupStatusId ?? args.statusId,
        passedIterations: passedCount,
        failedIterations: failedCount,
        skippedIterations: skippedCount,
      },
    });

    // Build the two redactions exactly the way the route does — fresh
    // computations each time so the integration test exercises the
    // separation D-13 demands.
    let auditRedactedValues: Record<string, unknown> | null = null;
    let webhookRedactedValues: Record<string, unknown> | null = null;
    const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
      where: { testRunCaseId: args.testRunCaseId },
      select: { parametersJson: true },
    });
    const paramSchemaRaw = snapshot?.parametersJson;
    const paramSchema: ParameterSchemaEntry[] = Array.isArray(paramSchemaRaw)
      ? paramSchemaRaw
          .filter(
            (e: any) => e && typeof e === "object" && typeof e.name === "string"
          )
          .map((e: any) => ({
            name: String(e.name),
            sensitive: e.sensitive === true,
          }))
      : [];
    const iterValues = (iterBefore?.valuesJson ?? {}) as Record<
      string,
      unknown
    >;
    auditRedactedValues = redactValues(
      iterValues,
      paramSchema,
      viewerCanReadSensitive
    );
    webhookRedactedValues = redactValues(iterValues, paramSchema, false);

    if (emitWebhook) {
      await emitIterationResultRecorded(
        {
          iterationId: args.iterationId,
          testRunCaseId: args.testRunCaseId,
          testRunId: args.testRunId,
          statusId: args.statusId,
          projectId: args.projectId,
          rowIndex: iterBefore?.rowIndex ?? 0,
          redactedValues: webhookRedactedValues,
        },
        tx,
        { actorUserId: args.executedById }
      );
    }

    return { createdResult, auditRedactedValues, webhookRedactedValues };
  }

  afterAll(async () => {
    if (RUN_INTEGRATION && HAS_DB_URL) {
      const { prisma } = await import("~/lib/prisma");
      await prisma.$disconnect();
    }
  });

  it("3-iteration pass/fail/pass: counters reach 2/1/3, rollup is failed, all results carry iterationId", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const passed = await tx.status.findUnique({
        where: { systemName: "passed" },
      });
      const failed = await tx.status.findUnique({
        where: { systemName: "failed" },
      });
      expect(passed).not.toBeNull();
      expect(failed).not.toBeNull();

      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });
      expect(iterations).toHaveLength(3);

      // Submit pass / fail / pass across the three iterations.
      const desired = [passed.id, failed.id, passed.id];
      for (let i = 0; i < iterations.length; i++) {
        await submitOneIterationResult(tx, {
          testRunId: fx.testRunId,
          testRunCaseId: fx.testRunCaseId,
          iterationId: iterations[i].id,
          statusId: desired[i],
          executedById: fx.creatorId,
          projectId: fx.projectId,
        });
      }

      // Counter assertions.
      const runCase = await tx.testRunCases.findUnique({
        where: { id: fx.testRunCaseId },
        select: {
          statusId: true,
          passedIterations: true,
          failedIterations: true,
          totalIterations: true,
        },
      });
      expect(runCase.passedIterations).toBe(2);
      expect(runCase.failedIterations).toBe(1);
      expect(runCase.totalIterations).toBe(3);
      // Worst-of: failed wins over passed.
      expect(runCase.statusId).toBe(failed.id);

      // TestRunResults rows: 3 rows, each with the correct iterationId.
      const results = await tx.testRunResults.findMany({
        where: {
          testRunCaseId: fx.testRunCaseId,
          isDeleted: false,
        },
        orderBy: { id: "asc" },
        select: {
          iterationId: true,
          statusId: true,
        },
      });
      expect(results).toHaveLength(3);
      const iterIdsOnResults = results
        .map((r: any) => r.iterationId)
        .sort((a: number, b: number) => a - b);
      const expectedIterIds = iterations
        .map((it: any) => it.id)
        .sort((a: number, b: number) => a - b);
      expect(iterIdsOnResults).toEqual(expectedIterIds);
    });
  });

  it("all iterations passing rolls up to passed", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const passed = await tx.status.findUnique({
        where: { systemName: "passed" },
      });
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });

      for (const it of iterations) {
        await submitOneIterationResult(tx, {
          testRunId: fx.testRunId,
          testRunCaseId: fx.testRunCaseId,
          iterationId: it.id,
          statusId: passed.id,
          executedById: fx.creatorId,
          projectId: fx.projectId,
        });
      }

      const runCase = await tx.testRunCases.findUnique({
        where: { id: fx.testRunCaseId },
        select: {
          statusId: true,
          passedIterations: true,
          failedIterations: true,
        },
      });
      expect(runCase.statusId).toBe(passed.id);
      expect(runCase.passedIterations).toBe(3);
      expect(runCase.failedIterations).toBe(0);
    });
  });

  it("partial submission (1 of 3): counters reflect only completed iterations, rollup uses the worst-of recorded statuses (unrecorded iterations don't drag the rollup)", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const passed = await tx.status.findUnique({
        where: { systemName: "passed" },
      });
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });

      // Submit only the first iteration as passed.
      await submitOneIterationResult(tx, {
        testRunId: fx.testRunId,
        testRunCaseId: fx.testRunCaseId,
        iterationId: iterations[0].id,
        statusId: passed.id,
        executedById: fx.creatorId,
        projectId: fx.projectId,
      });

      const runCase = await tx.testRunCases.findUnique({
        where: { id: fx.testRunCaseId },
        select: {
          statusId: true,
          passedIterations: true,
          failedIterations: true,
        },
      });
      expect(runCase.passedIterations).toBe(1);
      expect(runCase.failedIterations).toBe(0);
      // Rollup intentionally considers ONLY recorded iteration statuses.
      // With 1 of 3 recorded as passed, the case-level rollup is `passed`;
      // unrecorded iterations don't drag the rollup back to `untested`.
      // Users dig into the drill-down to see incomplete iterations — the
      // case row is not the place to signal partial testing (the per-status
      // counters do that).
      expect(runCase.statusId).toBe(passed.id);
    });
  });

  it("TestRunResults.iterationId FK is set to the supplied iteration", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const passed = await tx.status.findUnique({
        where: { systemName: "passed" },
      });
      const targetIteration = await tx.testRunCaseIteration.findFirst({
        where: { testRunCaseId: fx.testRunCaseId, rowIndex: 1 },
      });
      const { createdResult } = await submitOneIterationResult(tx, {
        testRunId: fx.testRunId,
        testRunCaseId: fx.testRunCaseId,
        iterationId: targetIteration.id,
        statusId: passed.id,
        executedById: fx.creatorId,
        projectId: fx.projectId,
      });
      const persisted = await tx.testRunResults.findUnique({
        where: { id: createdResult.id },
        select: { iterationId: true },
      });
      expect(persisted.iterationId).toBe(targetIteration.id);
    });
  });

  it("skipped iteration result increments skippedIterations counter", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const skipped = await tx.status.findUnique({
        where: { systemName: "skipped" },
      });
      expect(skipped).not.toBeNull();
      // Sanity-check the skip-class semantics: isCompleted but neither
      // success nor failure — this is the inverse-of-pass-and-fail rule
      // the route uses to derive skippedCount.
      expect(skipped.isCompleted).toBe(true);
      expect(skipped.isSuccess).toBe(false);
      expect(skipped.isFailure).toBe(false);

      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });
      expect(iterations).toHaveLength(3);

      // Submit only the first iteration as skipped.
      await submitOneIterationResult(tx, {
        testRunId: fx.testRunId,
        testRunCaseId: fx.testRunCaseId,
        iterationId: iterations[0].id,
        statusId: skipped.id,
        executedById: fx.creatorId,
        projectId: fx.projectId,
      });

      const runCase = await tx.testRunCases.findUnique({
        where: { id: fx.testRunCaseId },
        select: {
          passedIterations: true,
          failedIterations: true,
          skippedIterations: true,
          totalIterations: true,
        },
      });
      expect(runCase.passedIterations).toBe(0);
      expect(runCase.failedIterations).toBe(0);
      expect(runCase.skippedIterations).toBe(1);
      expect(runCase.totalIterations).toBe(3);
    });
  });

  it("snapshot's parametersJson preserves sensitive flags after fan-out (audit boundary input)", async () => {
    // The route reads parametersJson from TestRunCaseDataSetSnapshot to feed
    // redactValues at the audit boundary. Verify the serialized shape can be
    // round-tripped into ParameterSchemaEntry[].
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
        where: { testRunCaseId: fx.testRunCaseId },
        select: { parametersJson: true },
      });
      expect(snapshot).not.toBeNull();
      const params = snapshot.parametersJson as Array<{
        name: string;
        sensitive: boolean;
      }>;
      const password = params.find((p) => p.name === "password");
      expect(password).toBeDefined();
      expect(password?.sensitive).toBe(true);
    });
  });

  // ─── INT-04 — iteration.result.recorded outbox + redaction divergence ────

  it("INT-04: iteration.result.recorded outbox row exists after iteration submit", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const passed = await tx.status.findUnique({
        where: { systemName: "passed" },
      });
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });

      await submitOneIterationResult(tx, {
        testRunId: fx.testRunId,
        testRunCaseId: fx.testRunCaseId,
        iterationId: iterations[0].id,
        statusId: passed.id,
        executedById: fx.creatorId,
        projectId: fx.projectId,
        emitWebhook: true,
      });

      const outboxRows = await tx.webhookOutboxEvent.findMany({
        where: {
          eventName: "iteration.result.recorded",
          projectId: fx.projectId,
        },
      });
      expect(outboxRows).toHaveLength(1);
      const outbox = outboxRows[0];
      const payload = outbox.payload as Record<string, unknown>;
      expect(payload.iterationId).toBe(iterations[0].id);
      expect(payload.testRunCaseId).toBe(fx.testRunCaseId);
      expect(payload.testRunId).toBe(fx.testRunId);
      expect(payload.statusId).toBe(passed.id);
      expect(payload.projectId).toBe(fx.projectId);
      expect(payload.rowIndex).toBe(iterations[0].rowIndex);
    });
  });

  it("INT-04 D-13: webhookRedactedValues uses viewerCanReadSensitive=false even when submitter has READ_SENSITIVE — audit and webhook redactions diverge for sensitive params", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const passed = await tx.status.findUnique({
        where: { systemName: "passed" },
      });
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });
      expect(iterations[0].valuesJson).toMatchObject({
        username: "alice",
        password: "p1",
      });

      // Submitter has READ_SENSITIVE — drives audit redaction's flag true.
      const { auditRedactedValues, webhookRedactedValues } =
        await submitOneIterationResult(tx, {
          testRunId: fx.testRunId,
          testRunCaseId: fx.testRunCaseId,
          iterationId: iterations[0].id,
          statusId: passed.id,
          executedById: fx.creatorId,
          projectId: fx.projectId,
          viewerCanReadSensitive: true,
          emitWebhook: true,
        });

      // (a) Audit retains cleartext (viewer has the permission).
      expect(auditRedactedValues).toMatchObject({
        username: "alice",
        password: "p1",
      });
      // (b) Webhook redacts sensitive param regardless of viewer permission.
      expect(webhookRedactedValues).toMatchObject({
        username: "alice",
        password: "[REDACTED]",
      });
      // (c) The two structures differ for the sensitive key — proves
      //     the redactions are computed independently.
      expect(webhookRedactedValues!.password).not.toBe(
        auditRedactedValues!.password
      );

      // The outbox row stores the webhook (NOT audit) redaction.
      const outboxRows = await tx.webhookOutboxEvent.findMany({
        where: {
          eventName: "iteration.result.recorded",
          projectId: fx.projectId,
        },
      });
      expect(outboxRows).toHaveLength(1);
      const outboxPayload = outboxRows[0].payload as {
        redactedValues: Record<string, unknown>;
      };
      expect(outboxPayload.redactedValues).toMatchObject({
        username: "alice",
        password: "[REDACTED]",
      });
    });
  });

  it("INT-04: outbox row commits with the result write (atomicity); rollback also drops the outbox row", async () => {
    const { prisma, materializeIterations } = await importDeps();
    let outboxRowsAfterRollback: any[] = [];
    await withRollback(prisma, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const passed = await tx.status.findUnique({
        where: { systemName: "passed" },
      });
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });

      await submitOneIterationResult(tx, {
        testRunId: fx.testRunId,
        testRunCaseId: fx.testRunCaseId,
        iterationId: iterations[0].id,
        statusId: passed.id,
        executedById: fx.creatorId,
        projectId: fx.projectId,
        emitWebhook: true,
      });

      // Inside tx: outbox row exists.
      const insideTx = await tx.webhookOutboxEvent.findMany({
        where: {
          eventName: "iteration.result.recorded",
          projectId: fx.projectId,
        },
      });
      expect(insideTx).toHaveLength(1);

      // Capture the projectId for the post-rollback check below.
      outboxRowsAfterRollback = [{ projectId: fx.projectId }];
    });

    // Outside the rolled-back tx: nothing visible. The `withRollback`
    // helper always throws ROLLBACK_SENTINEL so the tx never commits.
    const projectId = outboxRowsAfterRollback[0]?.projectId;
    if (projectId != null) {
      const persistedRows = await prisma.webhookOutboxEvent.findMany({
        where: {
          eventName: "iteration.result.recorded",
          projectId,
        },
      });
      expect(persistedRows).toHaveLength(0);
    }
  });
});
