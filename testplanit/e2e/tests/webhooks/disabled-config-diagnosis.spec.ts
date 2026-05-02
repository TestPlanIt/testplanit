import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import {
  seedDeliveries,
  seedOutboundConfig,
} from "../../fixtures/webhooks-seed";

/**
 * Disabled config diagnosis flow (M-03).
 *
 * Workflow under test: an admin sees a red DISABLED badge on an outbound
 * config card, hovers it for context, then opens the Deliveries tab to
 * inspect the recent failure pattern. The Re-enable button is visible on
 * the card so the admin can recover once the upstream issue is fixed.
 *
 * Setup mirrors the post-auto-disable state that lib/webhooks/health.ts
 * `transition(configId, "failure")` lands in production after the 10th
 * consecutive terminal failure: endpointHealth=DISABLED,
 * consecutiveFailureCount=10, lastFailureAt set. The 11 seeded delivery
 * rows match what an admin would actually see in this scenario — 10
 * upstream failures (TIMEOUT / 502_<msg>) and a final endpoint_disabled
 * row written by the dispatcher's DISABLED gate (dispatch.ts:122) on the
 * very next event after auto-disable kicked in.
 *
 * Diff from `auto-disable-and-reenable.spec.ts`: that consolidated spec
 * drives the auto-disable transition + audit log + re-enable click +
 * post-re-enable dispatch. THIS spec is purely the diagnosis surface —
 * what the admin sees on the card and the Deliveries tab in the steady
 * DISABLED state — so we skip the audit log + post-re-enable dispatch
 * assertions to keep the failure surface tight.
 *
 * The badge title tooltip uses the native `title=` attribute (string
 * tooltip, not shadcn Tooltip primitive) so we assert via toHaveAttribute
 * rather than hover-then-find-popover. Same surface a real admin reads
 * via OS tooltip on hover.
 */

const FAILURE_HISTORY_DEPTH = 10; // matches DISABLED_THRESHOLD from health.ts

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook DISABLED diagnosis surface — badge + tooltip + activity + Re-enable button (M-03)", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let configId: string;
  const failureDeliveryIds: string[] = [];
  let endpointDisabledDeliveryId: string;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Disabled Diagnosis ${uniqueId}`);
    prisma = new PrismaClient();

    const seeded = await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/M-03/disabled",
      name: "E2E M-03 Disabled Outbound",
    });
    configId = seeded.configId;

    // Land the config in the canonical post-auto-disable state. lastFailureAt
    // anchors the tooltip's "Disabled after 10 consecutive failures · {ts}"
    // string — the spec asserts the tooltip's structure, not a literal
    // timestamp, so any past Date is fine here.
    const lastFailureAt = new Date();
    lastFailureAt.setMinutes(lastFailureAt.getMinutes() - 5);
    await prisma.webhookConfig.update({
      where: { id: configId },
      data: {
        endpointHealth: "DISABLED",
        consecutiveFailureCount: 10,
        lastFailureAt,
      },
    });

    // Seed 10 upstream-failure rows (TIMEOUT / 502_*) — the realistic
    // pattern an admin sees when an upstream is flapping for hours before
    // tripping the threshold. The seed helper alternates only with
    // statusPattern="mixed"; here we want all-failure so we drive two
    // batches with different sentinels rather than tweak the helper.
    const timeoutRows = await seedDeliveries(prisma, {
      webhookConfigId: configId,
      direction: "OUTBOUND",
      projectId,
      adapterType: "GENERIC_HMAC",
      count: 5,
      statusPattern: "all-failure",
      errorSentinel: "TIMEOUT",
      eventIdPrefix: `evt_${uniqueId}_timeout`,
    });
    failureDeliveryIds.push(...timeoutRows.map((r) => r.id));

    const badGatewayRows = await seedDeliveries(prisma, {
      webhookConfigId: configId,
      direction: "OUTBOUND",
      projectId,
      adapterType: "GENERIC_HMAC",
      count: 5,
      statusPattern: "all-failure",
      errorSentinel: "502_bad_gateway",
      eventIdPrefix: `evt_${uniqueId}_502`,
    });
    failureDeliveryIds.push(...badGatewayRows.map((r) => r.id));
    expect(failureDeliveryIds).toHaveLength(FAILURE_HISTORY_DEPTH);

    // Seed the post-disable row: DISABLED gate short-circuited dispatch and
    // wrote a row with error="endpoint_disabled" + statusCode=null. This is
    // the most-recent row admins land on when they open the Deliveries tab.
    const endpointDisabledRows = await seedDeliveries(prisma, {
      webhookConfigId: configId,
      direction: "OUTBOUND",
      projectId,
      adapterType: "GENERIC_HMAC",
      count: 1,
      statusPattern: "all-failure",
      errorSentinel: "endpoint_disabled",
      eventIdPrefix: `evt_${uniqueId}_disabled`,
    });
    endpointDisabledDeliveryId = endpointDisabledRows[0]!.id;
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("admin sees red DISABLED badge with diagnostic tooltip, finds Re-enable button on the card, and the Deliveries tab shows the 11-row failure pattern", async ({
    page,
    baseURL,
  }) => {
    // 1. Navigate to the outbound tab — the DISABLED config renders here.
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

    // 2. Health badge is red (destructive variant) and reads "Disabled".
    const badge = page.getByTestId(`webhook-health-badge-${configId}`);
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toContainText(/disabled/i);

    // 3. Tooltip wiring — native title attribute carries the diagnostic
    //    string so OS tooltip surfaces it on hover. Assert the structural
    //    shape ("Disabled after 10 consecutive failures · …") rather than
    //    the exact timestamp string, which depends on the seeded Date.
    const titleAttr = await badge.getAttribute("title");
    expect(titleAttr).not.toBeNull();
    expect(titleAttr).toMatch(/Disabled after 10 consecutive failures/i);

    // 4. Re-enable button is visible on the card (the button only renders
    //    when endpointHealth === "DISABLED" — the very condition we just
    //    seeded). This is the recovery affordance the diagnosis flow ends on.
    const reenableButton = page.getByTestId(
      `webhook-reenable-button-${configId}`
    );
    await expect(reenableButton).toBeVisible({ timeout: 5_000 });

    // 5. Activity field group is present on the card (M-03 sibling to the
    //    badge — admins read it before opening the Deliveries tab to gauge
    //    how recent the failure window is).
    await expect(
      page.getByTestId(`webhook-delivery-activity-${configId}`)
    ).toBeVisible();

    // 6. Hop to the Deliveries tab + filter to this config to see the 11
    //    rows. The most-recent row is the endpoint_disabled one (auto-
    //    disable kicked in AFTER the 10 upstream failures).
    const since = new Date();
    since.setDate(since.getDate() - 1);
    // Pin pageSize=50 so all 11 seeded rows fit on page 1. Default
    // pageSize honours admin's itemsPerPage preference (often P10), which
    // would push the oldest TIMEOUT row onto page 2.
    const deliveriesUrl =
      `${baseURL}/projects/settings/${projectId}/webhooks` +
      `?tab=deliveries&configIds=${configId}&status=failed` +
      `&since=${since.toISOString()}&pageSize=50`;
    await page.goto(deliveriesUrl);
    await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("webhook-deliveries-table")).toBeVisible({
      timeout: 10_000,
    });

    // 7. The post-disable row is rendered (most-recent-first ordering means
    //    it lands at the top of the failure history).
    await expect(
      page.getByTestId(`webhook-delivery-row-${endpointDisabledDeliveryId}`)
    ).toBeVisible({ timeout: 10_000 });

    // 8. A spot-check from the upstream-failure history is visible too —
    //    proves the table shows the full window, not just the latest row.
    const sampleFailureId = failureDeliveryIds[0]!;
    await expect(
      page.getByTestId(`webhook-delivery-row-${sampleFailureId}`)
    ).toBeVisible({ timeout: 10_000 });

    // 9. Data-layer truth — DB has 11 rows on this config (10 upstream +
    //    1 endpoint_disabled). Locks the seed shape against silent drift.
    const allRows = await prisma.webhookDelivery.findMany({
      where: { webhookConfigId: configId, direction: "OUTBOUND" },
      select: { id: true, error: true },
    });
    expect(allRows).toHaveLength(FAILURE_HISTORY_DEPTH + 1);
    const errorBreakdown = allRows.reduce<Record<string, number>>((acc, r) => {
      const key = r.error ?? "null";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(errorBreakdown.TIMEOUT).toBe(5);
    expect(errorBreakdown["502_bad_gateway"]).toBe(5);
    expect(errorBreakdown.endpoint_disabled).toBe(1);
  });
});
