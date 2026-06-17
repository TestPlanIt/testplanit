import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";

/**
 * Phase 2 outbound dispatch demo target (Plan 02-08, Task 8.2).
 *
 * Closes the loop:
 *   admin opens project webhooks (?tab=outbound) → creates outbound webhook
 *   pointing at a local node:http stub server → completes a test run via the
 *   E2E API fixture helpers (api.createTestRun + api.completeTestRunViaStateChange,
 *   both flowing through the same ZenStack RPC pathway as the in-app UI →
 *   triggers the lib/prisma.ts $extends middleware → emits test_run.state_changed
 *   + test_run.completed via the outbox → outbox poller enqueues dispatch jobs →
 *   dispatch worker POSTs to the stub) → asserts the stub captured a
 *   test_run.completed envelope, the WebhookDelivery row exists with
 *   direction=OUTBOUND, statusCode=200, and the WEBHOOK_DISPATCHED audit log
 *   entry exists.
 *
 * Slack-specific bits (real channel rendering, Block Kit fidelity) are
 * validated separately by Task 8.3's manual UAT dress rehearsal.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Outbound webhook — test_run.completed delivery (Phase 2 demo target)", () => {
  let projectId: number;
  let stub: StubServerHandle;
  let prisma: PrismaClient;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Outbound Webhook ${uniqueId}`);
    stub = await startStubServer();
    prisma = new PrismaClient();
  });

  test.afterAll(async () => {
    if (stub) await stub.close();
    if (prisma) await prisma.$disconnect();
  });

  test("project admin configures outbound, completes a test run, sees delivery in stub + DB", async ({
    page,
    baseURL,
    api,
  }) => {
    let deliveries:
      | Awaited<ReturnType<typeof prisma.webhookDelivery.findMany>>
      | undefined;

    // 1. Configure the outbound webhook via the admin form. The Phase 2
    //    admin page uses a Tabs primitive (D-27) with URL-driven state
    //    (?tab=outbound). Radix Tabs only mounts the active tab's content,
    //    so we click the outbound trigger explicitly rather than relying
    //    on the query-string roundtrip surviving the i18n redirect.
    await test.step("Open project webhooks and switch to the outbound tab", async () => {
      await page.goto(
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks`
      );
      // Wait for project data to load (tabs only render after useFindFirstProjects resolves).
      await expect(page.getByTestId("webhooks-tab-inbound")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("webhooks-tab-outbound").click();

      await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("Create an outbound webhook pointing at the stub server", async () => {
      await page.getByTestId("webhook-outbound-add-button").click();

      await page.getByTestId("webhook-outbound-name-input").fill("E2E Stub");
      await page.getByTestId("webhook-outbound-url-input").fill(stub.url);

      // The default-preset (D-08, set server-side by createOutboundWebhook)
      // already includes test_run.completed, but we re-check defensively in
      // case the form was opened on a partial state.
      const completedCheckbox = page.getByTestId(
        "webhook-outbound-subs-event-test_run.completed"
      );
      await expect(completedCheckbox).toBeVisible();
      if (!(await completedCheckbox.isChecked())) {
        await completedCheckbox.check();
      }

      await page.getByTestId("webhook-outbound-create-submit").click();

      // After submit the page returns to the list view with a card per config;
      // the create form unmounts and the add button becomes visible again.
      await expect(
        page.getByTestId("webhook-outbound-add-button")
      ).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Create and complete a test run to fire test_run.completed", async () => {
      // 2. Trigger a test_run.completed event using the API fixture helpers.
      //    Step 2a: create a test run (uses ZenStack RPC → testRuns.create).
      const testRunId = await api.createTestRun(
        projectId,
        `E2E completion run ${uniqueId}`
      );
      //    Step 2b: transition stateId to a DONE-typed workflow. This is the
      //    line that fires test_run.state_changed + test_run.completed via the
      //    lib/prisma.ts $extends middleware (testRunEvents.emitTestRunUpdateEvents).
      await api.completeTestRunViaStateChange(testRunId, projectId);
    });

    await test.step("Wait for the dispatch worker to deliver the completed envelope to the stub", async () => {
      // 3. Wait for the dispatch worker to deliver to the stub. The outbox poller
      //    is on a 2s cadence + the dispatch worker has 5 concurrency, so end-to-end
      //    completion within 5-10s is expected; 30s is generous slack.
      const captures = await stub.waitForCapture(
        (c) =>
          c.some(
            (capt) =>
              typeof (capt.parsedBody as { eventName?: unknown })
                ?.eventName === "string" &&
              (capt.parsedBody as { eventName: string }).eventName ===
                "test_run.completed"
          ),
        60_000
      );
      // Both test_run.state_changed AND test_run.completed fire on the same
      // transition (D-09); we assert the completed one specifically since
      // that's the demo target.
      const completedCapture = captures.find(
        (c) =>
          typeof (c.parsedBody as { eventName?: unknown })?.eventName ===
            "string" &&
          (c.parsedBody as { eventName: string }).eventName ===
            "test_run.completed"
      );
      expect(completedCapture).toBeDefined();
      expect(completedCapture!.method).toBe("POST");
      expect(completedCapture!.parsedBody).toMatchObject({
        eventName: "test_run.completed",
        eventId: expect.stringMatching(/^evt_[0-9a-f-]+$/),
        projectId,
      });
    });

    await test.step("Verify the OUTBOUND WebhookDelivery row was written", async () => {
      // 4. Assert the WebhookDelivery row was written.
      deliveries = await prisma.webhookDelivery.findMany({
        where: {
          webhookConfig: { projectId },
          direction: "OUTBOUND",
          eventType: "test_run.completed",
        },
        orderBy: { receivedAt: "desc" },
        take: 5,
      });
      expect(deliveries.length).toBeGreaterThanOrEqual(1);
      expect(deliveries[0].statusCode).toBe(200);
      expect(deliveries[0].error).toBeNull();
    });

    await test.step("Verify the WEBHOOK_DISPATCHED audit log entry records success", async () => {
      // 5. Assert the audit log entry. The audit row is written asynchronously
      //    by the BullMQ audit worker (captureAuditEvent enqueues, the worker
      //    drains). When the dispatcher returns and writes the WebhookDelivery
      //    row, the audit job is just enqueued — the row may not exist yet.
      //    Poll for it (mirrors waitForDelivery / waitForAudit patterns used
      //    in other webhook specs; deterministic per feedback_no_flaky_tests).
      const audit = await waitForAuditRow(prisma, {
        where: {
          action: "WEBHOOK_DISPATCHED",
          entityType: "WebhookDelivery",
          entityId: deliveries![0].id,
        },
        timeoutMs: 10_000,
      });
      expect((audit.metadata as { outcome?: string }).outcome).toBe("success");
    });
  });
});

/**
 * Poll Prisma until an AuditLog row matching `where` exists. Throws on
 * timeout. Mirrors `waitForAudit` in auto-disable-and-reenable.spec.ts but
 * without the predicate refinement — here a single `findFirst` match is
 * sufficient because the (action, entityType, entityId) tuple uniquely
 * identifies the dispatched-event audit row for this delivery.
 */
async function waitForAuditRow(
  prisma: PrismaClient,
  args: {
    where: Record<string, unknown>;
    timeoutMs: number;
  }
): Promise<{ metadata: unknown }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < args.timeoutMs) {
    const row = await prisma.auditLog.findFirst({
      where: args.where,
      select: { metadata: true },
    });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `waitForAuditRow: timed out after ${args.timeoutMs}ms; where=${JSON.stringify(args.where)}`
  );
}
