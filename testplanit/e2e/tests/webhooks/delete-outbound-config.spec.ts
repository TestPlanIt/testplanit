import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import {
  seedDeliveries,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";

/**
 * Delete outbound webhook flow (M-04).
 *
 * Workflow under test: an admin clicks Delete on an outbound config card,
 * confirms via the shadcn AlertDialog (D-31 — never window.confirm), the
 * card disappears, the success toast renders, and subsequent test_run.
 * completed events for the project DO NOT fan out to that destination
 * (verified at the data layer — no new WebhookDelivery rows for the
 * deleted config id appear after the delete).
 *
 * Schema reality (recorded for future maintainers):
 *   `WebhookDelivery.webhookConfigId` references `WebhookConfig` with
 *   `onDelete: Cascade` (schema.zmodel:3544). When the admin deletes a
 *   config, ALL existing WebhookDelivery rows for that config are
 *   cascade-deleted by Postgres in the same transaction — they do NOT
 *   survive on a 30-day retention cycle. This spec asserts the actual
 *   cascade contract: queries for the deleted config id return zero rows
 *   afterwards.
 *
 *   The original M-04 manual test case (.planning/v0.23.0-manual-test-
 *   cases.md:770) reads "Existing WebhookDelivery rows for this config
 *   are NOT deleted (audit history preserved); they purge on the 30-day
 *   cycle." That expectation is at odds with the schema's Cascade rule
 *   and would require an architectural change (e.g. `onDelete: SetNull`
 *   on the FK + a nullable webhookConfigId column to keep orphaned rows
 *   queryable). Documenting the discrepancy here so any future audit-
 *   history-preservation work has a starting point — and so this spec
 *   doesn't silently lock in the cascade behavior as intentional product
 *   policy.
 *
 * Tenant isolation isn't re-asserted here — `replay-bulk-deliveries.spec.
 * ts` and `cross-tenant-isolation` audits already lock that down. M-04 is
 * about the destructive admin action.
 */

const PRE_DELETE_DELIVERY_COUNT = 3;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook outbound config delete — card disappears + no future fan-out (M-04)", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let configId: string;
  const preDeleteDeliveryIds: string[] = [];

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Delete Outbound ${uniqueId}`);
    prisma = new PrismaClient();

    const seeded = await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/M-04/delete-target",
      name: "E2E M-04 Delete Target",
    });
    configId = seeded.configId;

    // Seed a few historical delivery rows so the cascade behaviour has
    // something to act on. Using "all-success" so these don't accidentally
    // trip any failure-driven UI surfaces during the navigation portion.
    const deliveries = await seedDeliveries(prisma, {
      webhookConfigId: configId,
      direction: "OUTBOUND",
      projectId,
      adapterType: "GENERIC_HMAC",
      count: PRE_DELETE_DELIVERY_COUNT,
      statusPattern: "all-success",
    });
    preDeleteDeliveryIds.push(...deliveries.map((r) => r.id));
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("admin clicks Delete, confirms AlertDialog, card disappears, no future events fan out to the deleted destination", async ({
    page,
    baseURL,
    api,
  }) => {
    // 1. Land on the outbound tab and confirm the card is rendered before
    //    delete. The delete button is per-card-scoped by config id so
    //    parallel test runs against multiple configs don't collide.
    await page.goto(
      `${baseURL}/projects/settings/${projectId}/webhooks?tab=outbound`
    );
    await expect(page.getByTestId("webhooks-tab-outbound")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("webhooks-tab-outbound").click();
    await expect(page.getByTestId("webhook-outbound-form")).toBeVisible({
      timeout: 15_000,
    });

    const card = page.getByTestId(`webhook-outbound-card-${configId}`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // 2. Click Delete → AlertDialog opens (shadcn primitive, NOT window.
    //    confirm — D-31). Cancel first to confirm the dialog wiring is
    //    clean, then re-open and confirm so the destructive action only
    //    fires through the explicit confirm path.
    await page
      .getByTestId(`webhook-outbound-delete-button-${configId}`)
      .click();
    const dialog = page.getByTestId("webhook-outbound-delete-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("webhook-outbound-delete-dialog-cancel").click();
    await expect(dialog).not.toBeVisible();
    await expect(card).toBeVisible(); // card survived the cancel

    await page
      .getByTestId(`webhook-outbound-delete-button-${configId}`)
      .click();
    await expect(dialog).toBeVisible();
    await page.getByTestId("webhook-outbound-delete-dialog-confirm").click();

    // 3. Success toast renders + the card is removed from the form.
    await expect(page.getByText(/Webhook deleted/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(card).not.toBeVisible({ timeout: 10_000 });

    // 4. Data-layer truth — the WebhookConfig row is gone.
    const after = await prisma.webhookConfig.findUnique({
      where: { id: configId },
      select: { id: true },
    });
    expect(after).toBeNull();

    // 5. Subsequent events do not fan out to the deleted destination.
    //    Trigger a real test_run.completed event via the API helper —
    //    this normally enqueues an outbound dispatch for every active
    //    OUTBOUND config in the project. With the only outbound config
    //    deleted, NO new WebhookDelivery rows can land on the deleted
    //    config id (since the row itself is gone). Asserts at the data
    //    layer to defend against a future regression where the
    //    dispatcher might somehow attempt fan-out using a stale cache
    //    of the config.
    const testRunId = await api.createTestRun(
      projectId,
      `E2E delete fan-out probe ${Date.now()}`
    );
    await api.completeTestRunViaStateChange(testRunId, projectId);

    // Allow the dispatch worker a brief window to consume the event.
    // No row CAN be written for the deleted config id (FK is gone), so
    // we poll briefly then assert zero rows.
    const pollDeadline = Date.now() + 5_000;
    let postDeleteRows: Array<{ id: string }> = [];
    while (Date.now() < pollDeadline) {
      postDeleteRows = await prisma.webhookDelivery.findMany({
        where: { webhookConfigId: configId },
        select: { id: true },
      });
      if (postDeleteRows.length > 0) break; // would be a regression
      await new Promise((r) => setTimeout(r, 200));
    }
    // No new rows landed on the deleted config id. Schema cascade also
    // removed the historical rows so the count is zero (see header note
    // for the audit-history preservation discrepancy with M-04 case copy).
    expect(postDeleteRows).toHaveLength(0);
  });
});
