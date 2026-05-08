import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

import { expect, test } from "../../fixtures/index";

/**
 * Phase 4 / Plan 04-08 — inbound row contract spec.
 *
 * Asserts the v0.23.0 outbound-only replay scope (CONTEXT D-17a / D-17b):
 *   - inbound rows surface `payloadDigest` (not `eventId`)
 *   - inbound drawer renders the gray "cannot be replayed" banner
 *     (testid `webhook-delivery-replay-not-supported`)
 *   - inbound drawer does NOT render a Replay button
 *
 * Failed inbound rows are seeded via the `no_handler` flow: a correctly-signed
 * GitHub `push` event is accepted at the receiver but the service has no
 * handler for it, so the route returns 200 + writes a `WebhookDelivery` row
 * with `error="no_handler"`. This is the same seed pattern used by
 * `github-inbound-webhook.spec.ts` Spec 3 — bad-signature requests 401 BEFORE
 * the service runs, so they cannot seed a row.
 */

const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function signGithubBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook deliveries — inbound row shows replay-not-supported banner", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let configToken: string;
  let plainSecret: string;
  let failedDeliveryId: string;

  test.beforeAll(async ({ api }) => {
    projectId = await api.createProject(`E2E Inbound Banner ${uniqueId}`);
    await api.setupProjectIssueIntegration(projectId, "GITHUB");
    prisma = new PrismaClient();
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("admin clicks failed inbound row, drawer opens with payloadDigest + banner + no Replay button", async ({
    page,
    request,
    baseURL,
  }) => {
    // 1. Configure a GitHub inbound webhook via the admin form (multi-card flow).
    await page.goto(`${baseURL}/projects/settings/${projectId}/webhooks`);
    const form = page.getByTestId("webhook-config-form");
    await expect(form).toBeVisible();

    // 1:1 inbound model: Add skips the chooser and creates inline.
    await page.getByTestId("webhook-inbound-add-button").click();

    const githubCard = page.getByTestId("webhook-inbound-card-github");
    await expect(githubCard).toBeVisible();
    await expect(githubCard.getByTestId("webhook-url")).toBeVisible();
    await expect(githubCard.getByTestId("webhook-secret")).toBeVisible();

    const urlText = await githubCard.getByTestId("webhook-url").innerText();
    const tokenMatch = urlText.match(/\/api\/webhooks\/(whk_[0-9a-f]+)/);
    expect(tokenMatch).not.toBeNull();
    configToken = tokenMatch![1];
    plainSecret = await githubCard.getByTestId("webhook-secret").innerText();

    // 2. Seed a failed inbound row via the no_handler flow: signed `push`
    //    event hits the receiver, payload verifies, adapter accepts, service
    //    has no handler → writes WebhookDelivery row with error="no_handler".
    const body = JSON.stringify({
      ref: "refs/heads/main",
      repository: { full_name: "octocat/Hello-World" },
    });
    const sig = signGithubBody(body, plainSecret);
    const response = await request.post(
      `${baseURL}/api/webhooks/${configToken}`,
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

    const config = await prisma.webhookConfig.findFirst({
      where: { token: configToken, direction: "INBOUND" },
      select: { id: true },
    });
    expect(config).not.toBeNull();

    const failedRows = await prisma.webhookDelivery.findMany({
      where: {
        webhookConfigId: config!.id,
        direction: "INBOUND",
        error: "no_handler",
      },
      orderBy: { receivedAt: "desc" },
      take: 1,
    });
    expect(failedRows.length).toBeGreaterThanOrEqual(1);
    failedDeliveryId = failedRows[0].id;

    // 3. Navigate to the Deliveries tab and find the failed row.
    await page.goto(
      `${baseURL}/projects/settings/${projectId}/webhooks?tab=deliveries`
    );
    await expect(page.getByTestId("webhooks-tab-deliveries")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("webhooks-tab-deliveries").click();

    await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("webhook-deliveries-table")).toBeVisible({
      timeout: 10_000,
    });

    const failedRow = page.getByTestId(
      `webhook-delivery-row-${failedDeliveryId}`
    );
    await expect(failedRow).toBeVisible({ timeout: 10_000 });
    // Drawer now opens via the per-row "View details" Eye icon, not the
    // row itself (D-17a follow-up — explicit affordance).
    await page
      .getByTestId(`webhook-delivery-view-details-${failedDeliveryId}`)
      .click();

    // 4. Drawer opens with the inbound contract.
    const drawer = page.getByTestId("webhook-delivery-drawer");
    await expect(drawer).toBeVisible();

    // 4a. payloadDigest is shown for INBOUND.
    await expect(
      drawer.getByTestId("webhook-drawer-payload-digest")
    ).toBeVisible();

    // 4b. eventId is NOT shown for INBOUND (outbound-only field).
    await expect(drawer.getByTestId("webhook-drawer-event-id")).toHaveCount(0);

    // 4c. Gray "cannot be replayed" banner is rendered.
    const banner = drawer.getByTestId("webhook-delivery-replay-not-supported");
    await expect(banner).toBeVisible();

    // 4d. Replay button is NOT rendered for INBOUND (D-17a contract).
    await expect(
      drawer.getByTestId("webhook-drawer-replay-button")
    ).toHaveCount(0);
  });
});
