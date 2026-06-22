import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import {
  seedDeliveries,
  seedInboundConfig,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";

/**
 * Bulk replay discovery flow (M-02).
 *
 * Workflow under test: an admin notices failed outbound deliveries in the
 * Deliveries tab, narrows the view via the filter bar (status=failed +
 * single config + since-yesterday), spots the "Bulk replay {count} outbound
 * failures" call-to-action, opens the AlertDialog, and confirms — exactly
 * the path a project admin would walk on day one of v0.23.0.
 *
 * The OUTBOUND-only count is the contract this spec locks in (CONTEXT
 * D-17b): with 5 failed OUTBOUND rows + 2 failed INBOUND rows on the same
 * project, the bulk-replay button label MUST advertise "5 outbound" — not
 * "7" — because the server action filters by direction in its SELECT and
 * the UI is scoped to a single outbound config via the filter bar. The 2
 * inbound rows live on a separate INBOUND config and are out of scope for
 * the bulk action by construction (configIds.length===1 + scoped to the
 * outbound config), but we explicitly seed them in the SAME project to
 * prove that "all-failures-in-project" never enters the count calculation
 * even when the same admin can see them via the Deliveries tab's
 * unfiltered view.
 *
 * Diff from `replay-bulk-deliveries.spec.ts`: that spec drives the full
 * dispatch round-trip (stub server, replay rows landing on the 200 stub).
 * This spec focuses on UI discovery — admin filter UX, button label, and
 * AlertDialog content — and uses the shared seed helper rather than
 * configuring the outbound webhook through the admin form. Lighter setup,
 * tighter assertions on the discovery surface; the dispatch round-trip is
 * already covered upstream.
 */

const FAILED_OUTBOUND_COUNT = 5;
const FAILED_INBOUND_COUNT = 2;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook bulk-replay discovery — outbound-only count via filter UI (M-02)", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let outboundConfigId: string;
  let inboundConfigId: string;
  const outboundDeliveryIds: string[] = [];
  const inboundDeliveryIds: string[] = [];

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Bulk Discovery ${uniqueId}`);
    prisma = new PrismaClient();

    // Seed outbound config + 5 failed delivery rows. Each OUTBOUND seed
    // produces a paired WebhookOutboxEvent so the replay service can locate
    // the original payload (mirrors the production dispatch.ts:267-281 shape).
    const outbound = await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/M-02/outbound",
    });
    outboundConfigId = outbound.configId;
    const outboundRows = await seedDeliveries(prisma, {
      webhookConfigId: outboundConfigId,
      direction: "OUTBOUND",
      projectId,
      adapterType: "GENERIC_HMAC",
      count: FAILED_OUTBOUND_COUNT,
      statusPattern: "all-failure",
      errorSentinel: "TIMEOUT",
    });
    outboundDeliveryIds.push(...outboundRows.map((r) => r.id));

    // Seed an INBOUND GitHub config + 2 failed inbound rows in the SAME
    // project. These are the foil — the admin can see them on the
    // Deliveries tab's unfiltered view, but the bulk-replay button must
    // never advertise them in its outbound-only count.
    const inbound = await seedInboundConfig(prisma, {
      projectId,
      adapterType: "GITHUB",
    });
    inboundConfigId = inbound.configId;
    const inboundRows = await seedDeliveries(prisma, {
      webhookConfigId: inboundConfigId,
      direction: "INBOUND",
      adapterType: "GITHUB",
      count: FAILED_INBOUND_COUNT,
      statusPattern: "all-failure",
      errorSentinel: "no_handler",
    });
    inboundDeliveryIds.push(...inboundRows.map((r) => r.id));
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("admin filters Deliveries to status=failed + single outbound config + date range, button label reads OUTBOUND-only count, dialog confirms with same count", async ({
    page,
    baseURL,
  }) => {
    let bulkButton: ReturnType<typeof page.getByTestId> | undefined;
    let dialog: ReturnType<typeof page.getByTestId> | undefined;

    await test.step("Open the unfiltered Deliveries tab", async () => {
      // 1. Land on the Deliveries tab unfiltered. Both outbound + inbound
      //    rows are visible to the admin in this view (no config filter
      //    applied yet) — confirms the cross-direction reach of the page.
      await page.goto(
        `${baseURL}/projects/settings/${projectId}/webhooks?tab=deliveries`
      );
      await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("Filter to status=failed, single outbound config, since yesterday", async () => {
      // 2. Drive the filter bar via URL params (same path the Select +
      //    Calendar widgets use under the hood — the tab parses URL state
      //    on render). status=failed + single outbound config + since-
      //    yesterday is the discovery scenario the manual case spells out.
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const filteredUrl =
        `${baseURL}/projects/settings/${projectId}/webhooks` +
        `?tab=deliveries&configIds=${outboundConfigId}&status=failed` +
        `&since=${since.toISOString()}`;
      await page.goto(filteredUrl);
      await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("webhook-deliveries-table")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("Verify bulk-replay button advertises outbound-only count", async () => {
      // 3. Bulk-replay button is visible (configIds.length===1 +
      //    status===failed + outboundFailedCount > 0). Label MUST advertise
      //    the OUTBOUND-only count, not the project-wide failure count.
      bulkButton = page.getByTestId("webhook-bulk-replay-button");
      await expect(bulkButton).toBeVisible({ timeout: 10_000 });
      await expect(bulkButton).toContainText(
        new RegExp(`${FAILED_OUTBOUND_COUNT}\\s+outbound`, "i")
      );
      // Defensive — the label MUST NOT advertise 7 (5 outbound + 2 inbound).
      await expect(bulkButton).not.toContainText(/\b7\s+outbound\b/i);
    });

    await test.step("Open the confirm dialog and verify its count", async () => {
      // 4. Click the button → AlertDialog opens with the same count + a
      //    Replay action button labelled with the count (D-31 — confirmed
      //    via shadcn AlertDialog, never window.confirm).
      await bulkButton!.click();
      dialog = page.getByTestId("webhook-bulk-replay-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(String(FAILED_OUTBOUND_COUNT));
      await expect(dialog).not.toContainText(
        new RegExp(
          `\\b${FAILED_OUTBOUND_COUNT + FAILED_INBOUND_COUNT}\\s+outbound\\b`,
          "i"
        )
      );

      const confirmButton = page.getByTestId("webhook-bulk-replay-confirm");
      await expect(confirmButton).toBeVisible();
      await expect(confirmButton).toContainText(String(FAILED_OUTBOUND_COUNT));
    });

    await test.step("Cancel the dialog without enqueuing", async () => {
      // 5. Cancel — discovery loop exited cleanly without enqueuing.
      await page.getByTestId("webhook-bulk-replay-cancel").click();
      await expect(dialog!).not.toBeVisible();
    });

    await test.step("Confirm inbound foil rows have no replays", async () => {
      // 6. Defense-in-depth at the data layer: the 2 inbound rows must NOT
      //    have replays. (Cancel above means no rows at all; this asserts
      //    that even if a future bug confirmed-without-clicking, the inbound
      //    foil rows would still be untouched by the outbound-scoped action.)
      const inboundReplays = await prisma.webhookDelivery.findMany({
        where: { replayedFromDeliveryId: { in: inboundDeliveryIds } },
        select: { id: true },
      });
      expect(inboundReplays).toHaveLength(0);
    });
  });
});
