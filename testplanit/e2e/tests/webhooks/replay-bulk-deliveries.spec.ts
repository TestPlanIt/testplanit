
import { createHash, createHmac } from "node:crypto";
import { createRawDbClient } from "~/lib/rawDbClient";

import { expect, test } from "../../fixtures/index";
import {
  startStubServer,
  type StubServerHandle,
} from "../../fixtures/webhook-outbound-stub-server";

/**
 * Phase 4 / Plan 04-08 — bulk replay E2E (CONTEXT D-07, D-08, D-09, D-17a).
 *
 * Closes the loop:
 *   admin configures one outbound webhook (against a 200-stub) + one inbound
 *   webhook (GitHub) in the same project. We seed 5 failed OUTBOUND delivery
 *   rows by writing matched (WebhookOutboxEvent, WebhookDelivery) pairs via
 *   Prisma, and 2 failed INBOUND rows by sending signed no_handler push events
 *   through the receiver. Admin filters Deliveries to the outbound config +
 *   status=failed; bulk-replay button label reads "Bulk replay 5 outbound
 *   failures" — count is OUTBOUND-only, NOT 7. Confirm fires
 *   bulkReplayFailedDeliveries; the 5 enqueued jobs land on the 200 stub →
 *   5 replay rows with replayedFromDeliveryId set. The 2 inbound originals
 *   have ZERO replay rows (defense-in-depth — bulk replay filters by both
 *   webhookConfigId AND direction='OUTBOUND').
 *
 * Failed outbound rows are seeded via direct Prisma writes rather than driving
 * the BullMQ retry curve (Phase 2 D-21 schedules ~21h per event — incompatible
 * with E2E budgets). The seed mirrors what dispatch.ts:267-281 writes on a
 * non-2xx response: WebhookOutboxEvent (eventName, eventId @unique, payload)
 * paired with WebhookDelivery (eventId @ref, direction=OUTBOUND, statusCode=500,
 * error="500_seeded"). The replay path loads the outbox row by delivery.eventId
 * and enqueues a fresh dispatch (Plan 04-03).
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const FAILED_OUTBOUND_COUNT = 5;
const FAILED_INBOUND_COUNT = 2;

function signGithubBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook delivery bulk replay — outbound-only count", () => {
  let projectId: number;
  let stub: StubServerHandle;
  let prisma: ReturnType<typeof createRawDbClient>;
  let outboundConfigId: string;
  let inboundConfigId: string;
  const seededOutboundDeliveryIds: string[] = [];
  const seededInboundDeliveryIds: string[] = [];

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Bulk Replay ${uniqueId}`);
    // Inbound webhook below requires the project to have a matching
    // active issue integration; spec configures GitHub.
    await api.setupProjectIssueIntegration(projectId, "GITHUB");
    stub = await startStubServer(); // always 200 — replays succeed
    prisma = createRawDbClient();
  });

  test.afterAll(async () => {
    if (stub) await stub.close();
    if (prisma) await prisma.$disconnect();
  });

  test("admin sees 'Bulk replay 5 outbound failures' label and bulk replay enqueues only the 5 outbound rows; 2 inbound originals have zero replays", async ({
    page,
    request,
    baseURL,
  }) => {
    let inboundToken: string | undefined;
    let inboundSecret: string | undefined;
    const bulkButton = page.getByTestId("webhook-bulk-replay-button");

    await test.step("Configure outbound webhook via the admin form", async () => {
      await page.goto(
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks`
      );
      await expect(page.getByTestId("webhooks-tab-inbound")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("webhooks-tab-outbound").click();
      await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId("webhook-outbound-add-button").click();
      await page
        .getByTestId("webhook-outbound-name-input")
        .fill("E2E Bulk Stub");
      await page.getByTestId("webhook-outbound-url-input").fill(stub.url);
      const completedCheckbox = page.getByTestId(
        "webhook-outbound-subs-event-test_run.completed"
      );
      if (!(await completedCheckbox.isChecked())) {
        await completedCheckbox.check();
      }
      await page.getByTestId("webhook-outbound-create-submit").click();
      await expect(page.getByTestId("webhook-outbound-add-button")).toBeVisible(
        {
          timeout: 10_000,
        }
      );

      const outboundConfig = await prisma.webhookConfig.findFirst({
        where: { projectId, direction: "OUTBOUND" },
        select: { id: true },
      });
      expect(outboundConfig).not.toBeNull();
      outboundConfigId = outboundConfig!.id;
    });

    await test.step("Configure GitHub inbound webhook in the same project", async () => {
      await page.goto(
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks`
      );
      await page.waitForLoadState("networkidle");
      const form = page.getByTestId("webhook-config-form");
      await expect(form).toBeVisible();
      // 1:1 inbound model: Add skips the chooser and creates inline.
      await page.getByTestId("webhook-inbound-add-button").click();

      const githubCard = page.getByTestId("webhook-inbound-card-github");
      await expect(githubCard).toBeVisible();
      const urlText = await githubCard.getByTestId("webhook-url").innerText();
      const tokenMatch = urlText.match(/\/api\/webhooks\/(whk_[0-9a-f]+)/);
      expect(tokenMatch).not.toBeNull();
      inboundToken = tokenMatch![1];
      inboundSecret = await githubCard
        .getByTestId("webhook-secret")
        .innerText();

      const inboundConfig = await prisma.webhookConfig.findFirst({
        where: { projectId, direction: "INBOUND" },
        select: { id: true },
      });
      expect(inboundConfig).not.toBeNull();
      inboundConfigId = inboundConfig!.id;
    });

    await test.step("Seed 5 failed outbound delivery rows via Prisma", async () => {
      // Each has a paired WebhookOutboxEvent so the replay service can find it.
      for (let i = 0; i < FAILED_OUTBOUND_COUNT; i++) {
        const eventId = `evt_${uniqueId}_outbound_${i}`;
        const payload = {
          eventName: "test_run.completed",
          eventId,
          projectId,
          seededFor: "bulk-replay-spec",
        };
        const payloadStr = JSON.stringify(payload);
        const payloadDigest = createHash("sha256")
          .update(payloadStr)
          .digest("hex");
        await prisma.webhookOutboxEvent.create({
          data: {
            projectId,
            eventName: "test_run.completed",
            eventId,
            payload,
            dispatchedAt: new Date(),
          },
        });
        const delivery = await prisma.webhookDelivery.create({
          data: {
            webhookConfigId: outboundConfigId,
            direction: "OUTBOUND",
            adapterType: "SLACK",
            eventType: "test_run.completed",
            eventId,
            statusCode: 500,
            latencyMs: 12,
            payloadDigest,
            error: "500_seeded",
            attempt: 7,
            replayedFromDeliveryId: null,
          },
          select: { id: true },
        });
        seededOutboundDeliveryIds.push(delivery.id);
      }
      expect(seededOutboundDeliveryIds.length).toBe(FAILED_OUTBOUND_COUNT);
    });

    await test.step("Seed 2 failed inbound delivery rows via the no_handler flow", async () => {
      // These end up on inboundConfigId, NOT outboundConfigId, so bulk replay
      // (scoped to outboundConfigId) must not touch them.
      for (let i = 0; i < FAILED_INBOUND_COUNT; i++) {
        const body = JSON.stringify({
          ref: `refs/heads/seed-${uniqueId}-${i}`,
          repository: { full_name: `octocat/Hello-World-${uniqueId}-${i}` },
        });
        const sig = signGithubBody(body, inboundSecret!);
        const response = await request.post(
          `${baseURL}/api/webhooks/${inboundToken!}`,
          {
            data: body,
            headers: {
              "content-type": "application/json",
              "x-hub-signature-256": sig,
              "x-github-event": "push",
            },
          }
        );
        expect(response.status()).toBe(200);
      }

      const inboundFailedRows = await prisma.webhookDelivery.findMany({
        where: {
          webhookConfigId: inboundConfigId,
          direction: "INBOUND",
          error: "no_handler",
        },
        select: { id: true },
        orderBy: { receivedAt: "desc" },
        take: FAILED_INBOUND_COUNT,
      });
      expect(inboundFailedRows.length).toBe(FAILED_INBOUND_COUNT);
      seededInboundDeliveryIds.push(...inboundFailedRows.map((r) => r.id));
    });

    await test.step("Open Deliveries tab filtered to the outbound config and failed status", async () => {
      // Bulk-replay button gates on configIds.length===1 AND status===failed
      // AND outboundFailedCount>0.
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const deliveriesUrl =
        `${baseURL}/en-US/projects/settings/${projectId}/webhooks` +
        `?tab=deliveries&configIds=${outboundConfigId}&status=failed&since=${since.toISOString()}`;
      await page.goto(deliveriesUrl);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId("webhook-deliveries-table")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Assert bulk-replay label shows the outbound-only count", async () => {
      // Label includes the OUTBOUND count (5), NOT the total failure count (7).
      // The wording "outbound" in the label is the cross-direction contract —
      // inbound failures (which are scoped out by configId here AND by
      // direction in the server action) never enter this count.
      await expect(bulkButton).toBeVisible({ timeout: 10_000 });
      await expect(bulkButton).toContainText(
        new RegExp(`${FAILED_OUTBOUND_COUNT}\\s+outbound`, "i")
      );
      // Defensive — the label MUST NOT advertise 7 (5 outbound + 2 inbound).
      await expect(bulkButton).not.toContainText(/\b7\s+outbound\b/i);
    });

    await test.step("Confirm the bulk replay dialog and start the batch", async () => {
      // AlertDialog confirms count = 5 (NOT 7).
      await bulkButton.click();
      const dialog = page.getByTestId("webhook-bulk-replay-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(String(FAILED_OUTBOUND_COUNT));
      await page.getByTestId("webhook-bulk-replay-confirm").click();

      // Toast confirms the batch was started.
      await expect(page.getByText(/Bulk replay started/i)).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Verify 5 outbound replays landed and the 2 inbound originals have zero replays", async () => {
      // Each replay enqueues a dispatch job that POSTs to the (200) stub →
      // success row written.
      const replayRows = await waitForCount(prisma, {
        where: {
          replayedFromDeliveryId: { in: seededOutboundDeliveryIds },
        },
        target: FAILED_OUTBOUND_COUNT,
        timeoutMs: 60_000,
      });
      expect(replayRows.length).toBe(FAILED_OUTBOUND_COUNT);
      for (const row of replayRows) {
        expect(row.replayedFromDeliveryId).not.toBeNull();
        expect(seededOutboundDeliveryIds).toContain(
          row.replayedFromDeliveryId!
        );
        expect(row.webhookConfigId).toBe(outboundConfigId);
        expect(row.error).toBeNull(); // 200 stub
        expect(row.statusCode).toBe(200);
      }

      // Defense-in-depth: the 2 inbound originals have ZERO replay rows.
      // bulk replay filters by direction=OUTBOUND in its SELECT and is scoped
      // to outboundConfigId by webhookConfigId — inbound rows in the same
      // project/timeframe must never be enqueued.
      const inboundReplays = await prisma.webhookDelivery.findMany({
        where: {
          replayedFromDeliveryId: { in: seededInboundDeliveryIds },
        },
        select: { id: true },
      });
      expect(inboundReplays).toHaveLength(0);
    });
  });
});

async function waitForCount(
  prisma: ReturnType<typeof createRawDbClient>,
  args: {
    where: Record<string, unknown>;
    target: number;
    timeoutMs: number;
  }
): Promise<
  Array<{
    id: string;
    webhookConfigId: string | null;
    replayedFromDeliveryId: string | null;
    statusCode: number | null;
    error: string | null;
  }>
> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < args.timeoutMs) {
    const rows = await prisma.webhookDelivery.findMany({
      where: args.where,
      select: {
        id: true,
        webhookConfigId: true,
        replayedFromDeliveryId: true,
        statusCode: true,
        error: true,
      },
    });
    if (rows.length >= args.target) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out after ${args.timeoutMs}ms waiting for ${args.target} matches: ${JSON.stringify(args.where)}`
  );
}
