import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";

/**
 * Phase 4 / Plan 04-08 — single outbound replay E2E (CONTEXT D-04..D-06, D-17a).
 *
 * Closes the loop:
 *   admin configures outbound webhook against a stub returning 500 on first
 *   request → triggers test_run.completed → first dispatch attempt writes a
 *   failed WebhookDelivery row with error set → admin opens Deliveries tab,
 *   clicks the failed row, drawer renders eventId + Replay button → confirms
 *   the AlertDialog → server enqueues a replay job → second dispatch lands on
 *   the (now 200) stub → new WebhookDelivery row exists with
 *   replayedFromDeliveryId pointing at the original.
 *
 * The stub's `failNTimes: 1` knob produces the failed row on the FIRST attempt
 * without waiting for the full 7-attempt retry curve (Plan 02-02 D-21 schedule
 * tops out at ~21h — incompatible with E2E budgets). The replay path then
 * succeeds against the 200 fallthrough.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook delivery replay — single outbound", () => {
  let projectId: number;
  let stub: StubServerHandle;
  let prisma: PrismaClient;
  let originalDeliveryId: string;
  let webhookConfigId: string;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Outbound Replay ${uniqueId}`);
    // First attempt fails (500) → seeds the failed row; subsequent requests
    // (the replay) succeed with 200.
    stub = await startStubServer({ failNTimes: 1 });
    prisma = new PrismaClient();
  });

  test.afterAll(async () => {
    if (stub) await stub.close();
    if (prisma) await prisma.$disconnect();
  });

  test("admin clicks failed outbound row, drawer opens, replay creates a new row with replayedFromDeliveryId set", async ({
    page,
    baseURL,
    api,
  }) => {
    // 1. Configure outbound webhook pointing at the stub.
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
    await page
      .getByTestId("webhook-outbound-name-input")
      .fill("E2E Replay Stub");
    await page.getByTestId("webhook-outbound-url-input").fill(stub.url);

    const completedCheckbox = page.getByTestId(
      "webhook-outbound-subs-event-test_run.completed"
    );
    await expect(completedCheckbox).toBeVisible();
    if (!(await completedCheckbox.isChecked())) {
      await completedCheckbox.check();
    }

    await page.getByTestId("webhook-outbound-create-submit").click();
    await expect(page.getByTestId("webhook-outbound-add-button")).toBeVisible({
      timeout: 10_000,
    });

    // 2. Trigger one outbound event. First attempt hits the stub which returns
    //    500 (per failNTimes: 1) → dispatcher writes a failed delivery row.
    const testRunId = await api.createTestRun(
      projectId,
      `E2E replay run ${uniqueId}`
    );
    await api.completeTestRunViaStateChange(testRunId, projectId);

    // 3. Wait for the failed delivery row to land in the DB.
    const failedRows = await waitForDelivery(prisma, {
      projectId,
      where: {
        direction: "OUTBOUND",
        eventType: "test_run.completed",
        error: { not: null },
        replayedFromDeliveryId: null,
      },
      timeoutMs: 60_000,
    });
    expect(failedRows.length).toBeGreaterThanOrEqual(1);
    const failed = failedRows[0];
    originalDeliveryId = failed.id;
    // Schema (Plan 04-08 SetNull): webhookConfigId is nullable on the row,
    // but a freshly dispatched failure row from this seeded config has the
    // FK populated. Narrow with a runtime guard so the local non-null
    // variable stays type-safe.
    expect(failed.webhookConfigId).not.toBeNull();
    webhookConfigId = failed.webhookConfigId as string;
    expect(failed.statusCode).toBe(500);
    expect(failed.error).not.toBeNull();
    expect(failed.eventId).not.toBeNull();

    // 4. Open the Deliveries tab and click the failed row.
    await page.goto(
      `${baseURL}/en-US/projects/settings/${projectId}/webhooks?tab=deliveries`
    );
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("webhooks-tab-deliveries")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId("webhooks-tab-deliveries").click();
    await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("webhook-deliveries-table")).toBeVisible({
      timeout: 10_000,
    });

    const failedRow = page.getByTestId(
      `webhook-delivery-row-${originalDeliveryId}`
    );
    await expect(failedRow).toBeVisible({ timeout: 10_000 });
    // Drawer now opens via the per-row "View details" Eye icon, not the
    // row itself (D-17a follow-up — explicit affordance).
    await page
      .getByTestId(`webhook-delivery-view-details-${originalDeliveryId}`)
      .click();

    // 5. Drawer renders the OUTBOUND contract.
    const drawer = page.getByTestId("webhook-delivery-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId("webhook-drawer-event-id")).toBeVisible();

    // 6. Click Replay → AlertDialog → confirm.
    await drawer.getByTestId("webhook-drawer-replay-button").click();
    const dialog = page.getByTestId("webhook-replay-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("webhook-replay-dialog-confirm").click();

    // 7. Toast confirms the replay was queued.
    await expect(page.getByText(/Replay queued/i)).toBeVisible({
      timeout: 10_000,
    });

    // 8. Wait for the replay row to land in the DB. The replay re-dispatches
    //    against the stub which now returns 200 (failNTimes was 1).
    const replayRows = await waitForDelivery(prisma, {
      projectId,
      where: {
        direction: "OUTBOUND",
        replayedFromDeliveryId: originalDeliveryId,
      },
      timeoutMs: 60_000,
    });
    expect(replayRows.length).toBeGreaterThanOrEqual(1);
    const replay = replayRows[0];
    expect(replay.replayedFromDeliveryId).toBe(originalDeliveryId);
    expect(replay.attempt).toBe(1);
    expect(replay.webhookConfigId).toBe(webhookConfigId);
    expect(replay.statusCode).toBe(200);
    expect(replay.error).toBeNull();
  });
});

/**
 * Poll Prisma until at least one matching delivery row exists. Mirrors the
 * stub server's waitForCapture helper but for DB-side assertions; avoids
 * arbitrary `setTimeout` waits that flake under load.
 */
async function waitForDelivery(
  prisma: PrismaClient,
  args: {
    projectId: number;
    where: Record<string, unknown>;
    timeoutMs: number;
  }
): Promise<
  Array<{
    id: string;
    webhookConfigId: string | null;
    statusCode: number | null;
    error: string | null;
    eventId: string | null;
    attempt: number;
    replayedFromDeliveryId: string | null;
  }>
> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < args.timeoutMs) {
    const rows = await prisma.webhookDelivery.findMany({
      where: {
        webhookConfig: { projectId: args.projectId },
        ...args.where,
      },
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        webhookConfigId: true,
        statusCode: true,
        error: true,
        eventId: true,
        attempt: true,
        replayedFromDeliveryId: true,
      },
      take: 5,
    });
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out after ${args.timeoutMs}ms waiting for WebhookDelivery match: ${JSON.stringify(args.where)}`
  );
}
