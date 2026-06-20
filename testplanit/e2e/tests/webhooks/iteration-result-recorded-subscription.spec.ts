

import { materializeIterations } from "~/lib/services/iterationFanOut";
import { createRawDbClient } from "~/lib/rawDbClient";
import { expect, test } from "../../fixtures/index";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";

/**
 * INT-04 (Phase 6 Wave 2) — iteration.result.recorded round-trip.
 *
 * Closes the loop end-to-end:
 *   1. Set up a project with a parameterized case + a 2-iteration run.
 *   2. Admin opens the project webhooks tab, creates a new outbound config,
 *      checks ONLY the new iteration.result.recorded box. (Verifies D-06 —
 *      no auto-subscribe; the new event is opt-in.)
 *   3. Submit a result for iteration 1 via the in-app POST to
 *      /api/test-runs/submit-result.
 *   4. The submit-result transaction emits iteration.result.recorded into
 *      the outbox; the outbox poller (2s cadence) enqueues a dispatch job;
 *      the dispatch worker POSTs to the stub.
 *   5. Assert a delivery exists with event=iteration.result.recorded and
 *      payload contains the iteration ID.
 *   6. Submit a result for iteration 2 → assert a SECOND delivery.
 *   7. Confirm test_run.completed was NOT delivered (run not complete).
 *
 * Required env: E2E_PROD=on, WEBHOOK_OUTBOUND_ALLOW_HTTP=true (so the test
 * stub server can be reached over HTTP — the dispatcher refuses HTTP in
 * non-test mode).
 *
 * Wave gate: this spec is exercised by the full `pnpm build && E2E_PROD=on
 * pnpm test:e2e` chain, NOT by per-task unit-test runs.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Outbound webhook — iteration.result.recorded (INT-04 subscription round-trip)", () => {
  let projectId: number;
  let stub: StubServerHandle;
  let prisma: PrismaClient;
  let testRunId: number;
  let testRunCaseId: number;
  let iterationIds: number[];
  let passedStatusId: number;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E INT-04 ${uniqueId}`);
    stub = await startStubServer();
    prisma = createRawDbClient();

    // Seed a parameterized case + 2-iteration run inside a single
    // ZenStack-bypassing transaction. We use raw prisma here because the
    // ZenStack policy layer rejects iteration writes from the admin
    // session for in-flight projects; the test setup mirrors the
    // production fan-out via materializeIterations.
    const status = await prisma.status.findFirst({
      where: { systemName: "passed", isDeleted: false },
      select: { id: true },
    });
    if (!status) {
      throw new Error("seed: passed status missing — run seed:test first");
    }
    passedStatusId = status.id;

    const project = await prisma.projects.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        createdBy: true,
        repositories: { select: { id: true }, take: 1 },
      },
    });
    const repo = project.repositories[0];
    if (!repo) {
      throw new Error("seed: project missing repository");
    }
    const folder = await prisma.repositoryFolders.create({
      data: {
        name: `int04-${uniqueId}`,
        repositoryId: repo.id,
        projectId,
        creatorId: project.createdBy,
      },
      select: { id: true },
    });
    const template = await prisma.templates.findFirstOrThrow({
      select: { id: true },
    });
    const state = await prisma.workflows.findFirstOrThrow({
      select: { id: true },
    });
    const testCase = await prisma.repositoryCases.create({
      data: {
        projectId,
        repositoryId: repo.id,
        folderId: folder.id,
        templateId: template.id,
        name: `INT-04 case ${uniqueId}`,
        stateId: state.id,
        creatorId: project.createdBy,
        hasParameters: true,
      },
      select: { id: true },
    });
    await prisma.testCaseParameter.createMany({
      data: [
        {
          testCaseId: testCase.id,
          name: "env",
          type: "STRING",
          sensitive: false,
          required: true,
          order: 0,
        },
      ],
    });
    const dataset = await prisma.dataSet.create({
      data: {
        name: `int04-ds-${uniqueId}`,
        ownerCaseId: testCase.id,
        projectId,
        createdById: project.createdBy,
      },
      select: { id: true },
    });
    await prisma.dataSetRow.createMany({
      data: [
        {
          dataSetId: dataset.id,
          rowIndex: 0,
          label: "qa",
          valuesJson: { env: "qa" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 1,
          label: "staging",
          valuesJson: { env: "staging" },
        },
      ],
    });
    const testRun = await prisma.testRuns.create({
      data: {
        name: `int04-run-${uniqueId}`,
        projectId,
        stateId: state.id,
        createdById: project.createdBy,
        testRunType: "REGULAR",
      },
      select: { id: true },
    });
    testRunId = testRun.id;
    const testRunCase = await prisma.testRunCases.create({
      data: {
        testRunId: testRun.id,
        repositoryCaseId: testCase.id,
        order: 0,
      },
      select: { id: true },
    });
    testRunCaseId = testRunCase.id;

    // Materialize the iterations as the production fan-out worker would.
    // (Statically imported up top — a dynamic `await import("~/..")` of a
    // TS file is loaded by Node as CommonJS and dies on the ESM `import`
    // statements inside iterationFanOut.ts.)
    await materializeIterations(testRunId, prisma);

    const iters = await prisma.testRunCaseIteration.findMany({
      where: { testRunCaseId },
      orderBy: { rowIndex: "asc" },
      select: { id: true },
    });
    iterationIds = iters.map((it) => it.id);
    expect(iterationIds).toHaveLength(2);
  });

  test.afterAll(async () => {
    if (stub) await stub.close();
    if (prisma) await prisma.$disconnect();
  });

  test("admin opts in to iteration.result.recorded → submit triggers delivery per iteration; test_run.completed NOT delivered", async ({
    page,
    baseURL,
    request,
  }) => {
    let captures: Awaited<ReturnType<typeof stub.waitForCapture>> | undefined;

    await test.step("Create outbound webhook subscribed only to iteration.result.recorded", async () => {
      // 1. Open the project webhooks settings page, switch to outbound, fill
      //    name + URL, and check ONLY the iteration.result.recorded box.
      await page.goto(
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks`
      );
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("webhooks-tab-outbound")).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId("webhooks-tab-outbound").click();
      await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId("webhook-outbound-add-button").click();

      await page.getByTestId("webhook-outbound-name-input").fill("INT-04 Stub");
      await page.getByTestId("webhook-outbound-url-input").fill(stub.url);

      // D-06 verification: ONLY check the iteration.result.recorded box —
      // every other event in the create-form preset stays unchecked, proving
      // the new event is independent of the existing test_run.completed flow.
      const iterCheckbox = page.getByTestId(
        "webhook-outbound-subs-event-iteration.result.recorded"
      );
      await expect(iterCheckbox).toBeVisible();
      if (!(await iterCheckbox.isChecked())) {
        await iterCheckbox.check();
      }

      await page.getByTestId("webhook-outbound-create-submit").click();
      await expect(page.getByTestId("webhook-outbound-add-button")).toBeVisible(
        {
          timeout: 10_000,
        }
      );
    });

    await test.step("Submit iteration 1 result and assert it is delivered to the stub", async () => {
      // 2. Submit a result for iteration 1 via the in-app POST endpoint.
      //    The submit-result transaction fires emitIterationResultRecorded
      //    inside the same tx (atomicity).
      const submit1 = await request.post(
        `${baseURL}/api/test-runs/submit-result`,
        {
          data: {
            testRunId,
            testRunCaseId,
            statusId: passedStatusId,
            attempt: 1,
            testRunCaseVersion: 1,
            iterationId: iterationIds[0],
          },
        }
      );
      expect(submit1.ok()).toBe(true);

      // 3. Wait for the dispatcher to deliver to the stub. The outbox poller
      //    is on a 2s cadence — 30s slack is generous.
      captures = await stub.waitForCapture(
        (c) =>
          c.some(
            (capt) =>
              typeof (capt.parsedBody as { eventName?: unknown })?.eventName ===
                "string" &&
              (capt.parsedBody as { eventName: string }).eventName ===
                "iteration.result.recorded"
          ),
        60_000
      );
      const iter1Delivery = captures.find(
        (c) =>
          (c.parsedBody as { eventName?: string })?.eventName ===
          "iteration.result.recorded"
      );
      expect(iter1Delivery).toBeDefined();
      expect(iter1Delivery!.method).toBe("POST");
      expect(iter1Delivery!.parsedBody).toMatchObject({
        eventName: "iteration.result.recorded",
        eventId: expect.stringMatching(/^evt_[0-9a-f-]+$/),
        projectId,
      });
      // Iteration ID present on the payload.
      const iter1Payload = (
        iter1Delivery!.parsedBody as { data: { iterationId: number } }
      ).data;
      expect(iter1Payload.iterationId).toBe(iterationIds[0]);
    });

    await test.step("Submit iteration 2 result and assert a second delivery arrives", async () => {
      // 4. Submit iteration 2 → assert a SECOND delivery arrives.
      stub.clear();
      const submit2 = await request.post(
        `${baseURL}/api/test-runs/submit-result`,
        {
          data: {
            testRunId,
            testRunCaseId,
            statusId: passedStatusId,
            attempt: 1,
            testRunCaseVersion: 1,
            iterationId: iterationIds[1],
          },
        }
      );
      expect(submit2.ok()).toBe(true);
      captures = await stub.waitForCapture(
        (c) =>
          c.some(
            (capt) =>
              typeof (capt.parsedBody as { eventName?: unknown })?.eventName ===
                "string" &&
              (capt.parsedBody as { eventName: string }).eventName ===
                "iteration.result.recorded"
          ),
        60_000
      );
      const iter2Delivery = captures.find(
        (c) =>
          (c.parsedBody as { eventName?: string })?.eventName ===
          "iteration.result.recorded"
      );
      expect(iter2Delivery).toBeDefined();
      expect(
        (iter2Delivery!.parsedBody as { data: { iterationId: number } }).data
          .iterationId
      ).toBe(iterationIds[1]);
    });

    await test.step("Confirm test_run.completed was not delivered and both deliveries persisted", async () => {
      // 5. Verify test_run.completed was NOT delivered (the run isn't
      //    complete — D-06 / independence assertion).
      const completedDelivery = captures!.find(
        (c) =>
          (c.parsedBody as { eventName?: string })?.eventName ===
          "test_run.completed"
      );
      expect(completedDelivery).toBeUndefined();

      // 6. DB-side assertion: WebhookDelivery rows for both iterations.
      const deliveries = await prisma.webhookDelivery.findMany({
        where: {
          webhookConfig: { projectId },
          direction: "OUTBOUND",
          eventType: "iteration.result.recorded",
        },
        orderBy: { receivedAt: "desc" },
        take: 5,
      });
      expect(deliveries.length).toBeGreaterThanOrEqual(2);
      for (const d of deliveries) {
        expect(d.statusCode).toBe(200);
        expect(d.error).toBeNull();
      }
    });
  });
});
