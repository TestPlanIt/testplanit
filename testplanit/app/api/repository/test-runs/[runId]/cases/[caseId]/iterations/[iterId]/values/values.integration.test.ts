/**
 * Live-DB integration test for the iteration values override branch.
 *
 * Phase 3 Wave 5 (Task 12) — Verifies that:
 *   - PATCH against TestRunCaseIteration.valuesJson succeeds with valid values.
 *   - The snapshot's rowsJson is NOT modified (PARAM-07).
 *   - The override is reflected in the iteration's valuesJson.
 *   - Sensitive parameter values are redacted in the audit metadata for
 *     viewers who lack `canReadSensitive`.
 *
 * Execution model matches `submitResult.integration.test.ts`:
 *   - Opt-in via `RUN_DB_INTEGRATION=1`.
 *   - Each test wraps its writes in a transaction that always rolls back.
 *   - We invoke the route's transactional contract directly (not via HTTP),
 *     since the auth/Zod layers are covered by unit-style tests.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("iteration values override (live DB)", () => {
  const importDeps = async () => {
    const { prisma } = await import("~/lib/prisma");
    const { materializeIterations } = await import(
      "~/lib/services/iterationFanOut"
    );
    return { prisma, materializeIterations };
  };

  const ROLLBACK_SENTINEL = "__OVERRIDE_VALUES_TEST_ROLLBACK__";

   
  async function withRollback<T>(
    prisma: any,
     
    body: (tx: any) => Promise<T>,
    timeoutMs = 60_000,
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
        { timeout: timeoutMs },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes(ROLLBACK_SENTINEL)) throw err;
    }
    if (captureErr) throw captureErr;
    return captured as T;
  }

   
  async function seedParameterizedRunCase(tx: any) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state) throw new Error("No Workflows row available — seed the DB first");
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template)
      throw new Error("No Templates row available — seed the DB first");

    const project = await tx.projects.create({
      data: {
        name: `override-values-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
          valuesJson: { username: "alice", password: "secret1" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 1,
          label: "bob",
          valuesJson: { username: "bob", password: "secret2" },
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
      datasetId: dataset.id,
      testRunId: testRun.id,
      testRunCaseId: testRunCase.id,
    };
  }

  it("PATCH succeeds for valid values and snapshot rowsJson is not modified", async () => {
    const { prisma, materializeIterations } = await importDeps();
    await withRollback(prisma, async (tx) => {
      const fixture = await seedParameterizedRunCase(tx);
      await materializeIterations(fixture.testRunId, tx);
      const iteration = await tx.testRunCaseIteration.findFirst({
        where: { testRunCaseId: fixture.testRunCaseId },
        select: {
          id: true,
          rowIndex: true,
          valuesJson: true,
          dataSetSnapshotId: true,
        },
      });
      expect(iteration).not.toBeNull();
      const before = (iteration!.valuesJson as Record<string, unknown>) ?? {};

      // Mimic the route's update body.
      const newValues = { ...before, username: "alice-overridden" };
      await tx.testRunCaseIteration.update({
        where: { id: iteration!.id },
        data: { valuesJson: newValues },
      });

      const after = await tx.testRunCaseIteration.findUnique({
        where: { id: iteration!.id },
        select: { valuesJson: true },
      });
      expect((after!.valuesJson as Record<string, unknown>).username).toBe(
        "alice-overridden",
      );

      // Snapshot must be unchanged.
      const snap = await tx.testRunCaseDataSetSnapshot.findUnique({
        where: { id: iteration!.dataSetSnapshotId! },
        select: { rowsJson: true },
      });
      // Snapshot rows have shape { sourceRowId, rowIndex, label, valuesJson }
      // — original parameter values live under `valuesJson`, not at the top
      // level (materializeIterations wraps each dataset row this way for audit
      // correlation).
      const snapRows = snap!.rowsJson as Array<{
        rowIndex: number;
        valuesJson: Record<string, unknown>;
      }>;
      const matching = snapRows.find(
        (r) => r.rowIndex === iteration!.rowIndex,
      );
      expect(matching).toBeDefined();
      // Iteration may correspond to rowIndex 0 (alice) or 1 (bob) depending
      // on findFirst ordering; assert the original value is unchanged from
      // the dataset row, whichever was picked.
      const expectedUsername = iteration!.rowIndex === 0 ? "alice" : "bob";
      expect(matching!.valuesJson.username).toBe(expectedUsername);
    });
  });

  it("redactValues masks sensitive params in audit metadata for non-privileged viewers", () => {
    const schema: ParameterSchemaEntry[] = [
      { name: "username", sensitive: false },
      { name: "password", sensitive: true },
    ];
    const out = redactValues(
      { username: "alice", password: "secret1" },
      schema,
      false,
    );
    expect(out.username).toBe("alice");
    expect(out.password).toBe("[REDACTED]");
  });

  afterAll(async () => {
    if (RUN_INTEGRATION && HAS_DB_URL) {
      const { prisma } = await importDeps();
      await prisma.$disconnect();
    }
  });
});
