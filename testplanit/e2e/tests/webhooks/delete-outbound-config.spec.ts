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
 * completed events for the project DO NOT fan out to that destination.
 *
 * Schema contract (Plan 04-08 — `WebhookDelivery.webhookConfig` is
 * `onDelete: SetNull` with a nullable `webhookConfigId`, schema.zmodel:
 * 3541-3550). When the admin hard-deletes a `WebhookConfig`:
 *   1. The `WebhookConfig` row is gone (`findUnique` returns null).
 *   2. The pre-existing `WebhookDelivery` rows survive as orphaned audit
 *      records — `webhookConfigId` flips to NULL on each row, the row
 *      itself is retained for the standard 30-day retention cycle (the
 *      retention worker is the only thing that purges delivery rows;
 *      admin click-to-delete must not erase audit history per the SOC2
 *      / GDPR audit-trail invariant).
 *   3. Project-scoped Deliveries-tab queries naturally exclude orphans
 *      because they filter by `webhookConfig.projectId`, and orphans
 *      have no related WebhookConfig.
 *   4. New events fired for the project after the delete CANNOT land
 *      new rows on the deleted config id — no live config to dispatch
 *      against.
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

    // 5. Audit-history preservation (Plan 04-08 SetNull contract). The
    //    pre-delete WebhookDelivery rows MUST survive the admin's Delete
    //    click — the retention worker is the only path that purges
    //    delivery rows. Each orphan keeps its `id`, its `payloadDigest`,
    //    its `receivedAt`, etc., but `webhookConfigId` flips to NULL.
    const orphanedRows = await prisma.webhookDelivery.findMany({
      where: { id: { in: preDeleteDeliveryIds } },
      select: { id: true, webhookConfigId: true },
    });
    expect(orphanedRows).toHaveLength(PRE_DELETE_DELIVERY_COUNT);
    for (const row of orphanedRows) {
      expect(row.webhookConfigId).toBeNull();
    }

    // 6. Project-scoped Deliveries-tab query naturally excludes orphans
    //    (they filter by `webhookConfig.projectId`, and an orphan has no
    //    related WebhookConfig). Mirrors the project-scoped query
    //    pattern in webhook-deliveries-tab.tsx so the admin UI shows
    //    zero rows for the deleted config — even though the rows are
    //    still in the DB for audit purposes.
    const projectScopedRows = await prisma.webhookDelivery.findMany({
      where: { webhookConfig: { projectId } },
      select: { id: true },
    });
    const projectScopedIds = new Set(projectScopedRows.map((r) => r.id));
    for (const id of preDeleteDeliveryIds) {
      expect(projectScopedIds.has(id)).toBe(false);
    }
    // Querying by the gone-config's id returns no project-scoped matches
    // for the same reason — `webhookConfigId = configId` matches zero rows
    // (orphans have NULL, no live row has the old id).
    const byDeletedConfigId = await prisma.webhookDelivery.findMany({
      where: { webhookConfigId: configId },
      select: { id: true },
    });
    expect(byDeletedConfigId).toHaveLength(0);

    // 7. Subsequent events do not fan out to the deleted destination.
    //    Trigger a real test_run.completed event via the API helper —
    //    this normally enqueues an outbound dispatch for every active
    //    OUTBOUND config in the project. With the only outbound config
    //    deleted, NO new WebhookDelivery rows can land on the deleted
    //    config id (no live config to dispatch against). Asserts at the
    //    data layer to defend against a future regression where the
    //    dispatcher might somehow attempt fan-out using a stale cache
    //    of the config.
    const testRunId = await api.createTestRun(
      projectId,
      `E2E delete fan-out probe ${Date.now()}`
    );
    await api.completeTestRunViaStateChange(testRunId, projectId);

    // Allow the dispatch worker a brief window to consume the event,
    // then assert no NEW row landed for the deleted config id. The
    // orphans from step 5 (id ∈ preDeleteDeliveryIds) remain with
    // webhookConfigId = NULL — they don't satisfy `webhookConfigId =
    // configId`, so the count below is purely "did a new row land".
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
    expect(postDeleteRows).toHaveLength(0);
  });
});
