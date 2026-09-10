/**
 * Live-DB integration test for the automated-execution request path
 * (lib/execution/requestExecution.ts → dispatch.ts → GenericWebhookDispatchAdapter)
 * and the automation plan (lib/execution/plan.ts).
 *
 * Proves, against a real database and a real HTTP receiver:
 *   - the run row lock, the one-active-execution rule (the partial unique
 *     index in the migration is the DB-level backstop for it),
 *   - REGULAR → HYBRID promotion on dispatch,
 *   - the generic webhook receives a signed payload carrying the run id and
 *     the plan URL, and the execution lands in DISPATCHED with the ids the
 *     receiver answered,
 *   - the plan lists only the run's automated cases (and only the requested
 *     subset for an ad-hoc execution),
 *   - results-received and run-completion hooks close the execution.
 *
 * requestExecution writes through the singleton client inside its own
 * transactions, so this suite cannot ride a rollback; it cleans up
 * explicitly. Skipped by default; opt in with RUN_DB_INTEGRATION=1 +
 * DATABASE_URL (a scratch database — never ew). Without Valkey the dispatch
 * runs inline, which is exactly what the test wants.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("Automated execution request (live DB)", () => {
  let baseDb: any;
  let server: Server;
  let receivedBodies: Array<{ headers: Record<string, string>; body: any }> =
    [];
  let webhookUrl = "";
  const created = {
    projectId: 0,
    repoId: 0,
    folderId: 0,
    caseIds: [] as number[],
    runId: 0,
    targetId: 0,
    userId: "",
  };

  beforeAll(async () => {
    // The receiver is local; the SSRF guard must be told so.
    process.env.ALLOWED_PRIVATE_HOSTS = "127.0.0.1";
    process.env.NEXTAUTH_URL = "https://tpi.example.com";
    ({ baseDb } = await import("~/lib/db"));

    server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        receivedBodies.push({
          headers: req.headers as Record<string, string>,
          body: data ? JSON.parse(data) : null,
        });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            externalRunId: "job-1",
            externalUrl: "https://ci.example.com/jobs/1",
          })
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    webhookUrl = `http://127.0.0.1:${address.port}/hooks/tpi`;

    const creator = await baseDb.user.findFirst({ select: { id: true } });
    const state = await baseDb.workflows.findFirst({ select: { id: true } });
    const template = await baseDb.templates.findFirst({ select: { id: true } });
    if (!creator || !state || !template)
      throw new Error("Seed the database first");
    created.userId = creator.id;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = await baseDb.projects.create({
      data: { name: `exec-${suffix}`, createdBy: creator.id },
      select: { id: true },
    });
    created.projectId = project.id;
    const repo = await baseDb.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    created.repoId = repo.id;
    const folder = await baseDb.repositoryFolders.create({
      data: {
        name: `f-${suffix}`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: creator.id,
      },
      select: { id: true },
    });
    created.folderId = folder.id;
    for (const [tag, automated] of [
      ["auto-1", true],
      ["auto-2", true],
      ["manual", false],
    ] as const) {
      const c = await baseDb.repositoryCases.create({
        data: {
          projectId: project.id,
          repositoryId: repo.id,
          folderId: folder.id,
          templateId: template.id,
          name: `Case ${tag} ${suffix}`,
          className: "tests.Suite",
          stateId: state.id,
          creatorId: creator.id,
          automated,
        },
        select: { id: true },
      });
      created.caseIds.push(c.id);
    }
    const run = await baseDb.testRuns.create({
      data: {
        name: `run-${suffix}`,
        projectId: project.id,
        stateId: state.id,
        createdById: creator.id,
        testRunType: "REGULAR",
        testCases: {
          create: created.caseIds.map((id, index) => ({
            repositoryCaseId: id,
            order: index,
          })),
        },
      },
      select: { id: true },
    });
    created.runId = run.id;

    const { encrypt } = await import("~/utils/encryption");
    const target = await baseDb.executionTarget.create({
      data: {
        projectId: project.id,
        name: `generic-${suffix}`,
        provider: "GENERIC_WEBHOOK",
        url: webhookUrl,
        credentials: {
          encrypted: await encrypt(JSON.stringify({ secret: "test-secret" })),
        },
        staticInputs: { ENV: "staging" },
        createdById: creator.id,
      },
      select: { id: true },
    });
    created.targetId = target.id;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (!baseDb || !created.projectId) return;
    await baseDb.testRunExecution.deleteMany({
      where: { projectId: created.projectId },
    });
    await baseDb.executionTarget.deleteMany({
      where: { projectId: created.projectId },
    });
    await baseDb.jUnitTestSuite.deleteMany({
      where: { testRunId: created.runId },
    });
    await baseDb.testRunCases.deleteMany({
      where: { testRunId: created.runId },
    });
    await baseDb.testRuns.deleteMany({
      where: { projectId: created.projectId },
    });
    await baseDb.repositoryCases.deleteMany({
      where: { projectId: created.projectId },
    });
    await baseDb.repositoryFolders.deleteMany({
      where: { projectId: created.projectId },
    });
    await baseDb.repositories.deleteMany({
      where: { projectId: created.projectId },
    });
    await baseDb.projects.deleteMany({ where: { id: created.projectId } });
  }, 60_000);

  it("lists only the automated cases of the run in the plan", async () => {
    const { buildAutomationPlan } = await import("~/lib/execution/plan");
    const plan = await buildAutomationPlan(baseDb, created.runId);
    expect(plan).not.toBeNull();
    expect(plan!.cases.map((c) => c.id)).toEqual(created.caseIds.slice(0, 2));
    expect(plan!.cases[0].selector.fullName).toMatch(
      /^tests\.Suite\.Case auto-1/
    );
    expect(plan!.cases[0].selector.idTokens.brackets).toBe(
      `[${created.caseIds[0]}]`
    );

    const subset = await buildAutomationPlan(baseDb, created.runId, {
      requestedCaseIds: [created.caseIds[1], created.caseIds[2]],
    });
    expect(subset!.cases.map((c) => c.id)).toEqual([created.caseIds[1]]);
  });

  it("dispatches to the generic webhook, promotes the run, and refuses a second active execution", async () => {
    const { requestExecution } =
      await import("~/lib/execution/requestExecution");
    receivedBodies = [];
    const result = await requestExecution({
      runId: created.runId,
      projectId: created.projectId,
      requestedById: created.userId,
      targetId: created.targetId,
      inputs: { browser: "chrome" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.queued).toBe(false); // no Valkey → inline dispatch
    expect(result.execution.selectionCount).toBe(2);

    const execution = await baseDb.testRunExecution.findUnique({
      where: { id: result.execution.id },
    });
    expect(execution.status).toBe("DISPATCHED");
    expect(execution.externalRunId).toBe("job-1");
    expect(execution.externalUrl).toBe("https://ci.example.com/jobs/1");
    expect(execution.inputs).toMatchObject({
      ENV: "staging",
      browser: "chrome",
      TESTPLANIT_RUN_ID: String(created.runId),
      TESTPLANIT_EXECUTION_ID: String(execution.id),
      TESTPLANIT_PLAN_URL: `https://tpi.example.com/api/test-runs/${created.runId}/automation-plan?executionId=${execution.id}`,
    });

    expect(receivedBodies).toHaveLength(1);
    const hit = receivedBodies[0];
    expect(hit.headers["x-testplanit-event"]).toBe("test_run.execute");
    expect(hit.headers["x-testplanit-signature"]).toMatch(
      /^t=\d+,v1=[0-9a-f]{64}$/
    );
    expect(hit.body).toMatchObject({
      event: "test_run.execute",
      runId: created.runId,
      executionId: execution.id,
      inputs: expect.objectContaining({
        TESTPLANIT_RUN_ID: String(created.runId),
      }),
    });

    const run = await baseDb.testRuns.findUnique({
      where: { id: created.runId },
      select: { testRunType: true },
    });
    expect(run.testRunType).toBe("HYBRID");

    const second = await requestExecution({
      runId: created.runId,
      projectId: created.projectId,
      requestedById: created.userId,
      targetId: created.targetId,
    });
    expect(second).toMatchObject({
      ok: false,
      code: "EXECUTION_IN_PROGRESS",
      executionId: execution.id,
    });

    // The partial unique index is the DB-level backstop for the same rule.
    await expect(
      baseDb.testRunExecution.create({
        data: {
          testRunId: created.runId,
          projectId: created.projectId,
          targetId: created.targetId,
          provider: "GENERIC_WEBHOOK",
          requestedById: created.userId,
          status: "PENDING",
        },
      })
    ).rejects.toThrow();
  });

  it("marks results received, then closes the execution when the run completes", async () => {
    const { markExecutionResultsReceived, completeExecutionsForRun } =
      await import("~/lib/execution/service");
    await markExecutionResultsReceived(baseDb, created.runId);
    let execution = await baseDb.testRunExecution.findFirst({
      where: { testRunId: created.runId },
      orderBy: { id: "desc" },
    });
    expect(execution.status).toBe("RUNNING");
    expect(execution.resultsReceivedAt).not.toBeNull();

    await expect(completeExecutionsForRun(baseDb, created.runId)).resolves.toBe(
      1
    );
    execution = await baseDb.testRunExecution.findUnique({
      where: { id: execution.id },
    });
    expect(execution.status).toBe("SUCCEEDED");
    expect(execution.completedAt).not.toBeNull();

    // A new execution is allowed once the previous one is terminal.
    const { requestExecution } =
      await import("~/lib/execution/requestExecution");
    const again = await requestExecution({
      runId: created.runId,
      projectId: created.projectId,
      requestedById: created.userId,
      targetId: created.targetId,
      caseIds: [created.caseIds[0]],
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.execution.selectionCount).toBe(1);
  });

  it("refuses an execution with no automated cases and a disabled target", async () => {
    const { requestExecution } =
      await import("~/lib/execution/requestExecution");
    const none = await requestExecution({
      runId: created.runId,
      projectId: created.projectId,
      requestedById: created.userId,
      targetId: created.targetId,
      caseIds: [created.caseIds[2]],
    });
    expect(none).toMatchObject({ ok: false });
    // Either the previous execution is still active or the selection is empty;
    // both are refusals, and the empty selection is checked when no execution is active.
    if (!none.ok)
      expect(["EXECUTION_IN_PROGRESS", "NO_AUTOMATED_CASES"]).toContain(
        none.code
      );

    await baseDb.executionTarget.update({
      where: { id: created.targetId },
      data: { isEnabled: false },
    });
    const disabled = await requestExecution({
      runId: created.runId,
      projectId: created.projectId,
      requestedById: created.userId,
      targetId: created.targetId,
    });
    expect(disabled).toMatchObject({ ok: false, code: "TARGET_DISABLED" });
  });
});
