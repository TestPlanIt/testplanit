import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import { seedOutboundConfig } from "../../fixtures/webhooks-seed";

/**
 * Deliveries tab performance against a large dataset (N-03).
 *
 * Workflow under test: an admin lands on the Deliveries tab for a project
 * with N existing rows. The tab MUST render the first page within a
 * generous time budget, the cursor pagination "Load more" button must be
 * visible at PAGE_SIZE=50, and applying a filter must not stall the UI.
 *
 * Why this spec exists: `useFindManyWebhookDelivery` in
 * webhook-deliveries-tab.tsx requests `take: PAGE_SIZE` via ZenStack's
 * generated React Query hook. A regression where the page accidentally
 * loads ALL rows (forgotten `take`, accidental `include` exploding into
 * an N+1) would silently work for tiny seed datasets but crater for any
 * project with real production volume. This spec exercises the page
 * against 1,000 seeded rows so a missing `take` would force the query to
 * return all 1,000 + paint them all + open a 1,000-row Drawer-eligible
 * table — and blow the timing budget.
 *
 * Production scale per the manual test plan (N-03) is 100k rows. CI
 * budget is the dominating constraint here — 100k rows take ~30s to seed
 * via createMany, push the test container heap up, and cause Postgres
 * write-amp during cleanup. 1,000 rows at ~100ms seed time still
 * exercises the page-size-vs-total-row separation that's the only thing
 * the spec actually proves. Run a 100k variant manually before a release
 * if you want to assert against true production-shape load.
 *
 * Timing budget: PAGE_LOAD_BUDGET_MS is generous (10s) to absorb
 * Playwright's networkidle + first-paint variance on a loaded CI box.
 * The 5s manual-test-plan target is the production goal; the spec
 * tolerates 2x that to follow `feedback_no_flaky_tests` (no flaky tests
 * accepted — every failure must reflect a real regression). Tighten only
 * after a few weeks of clean runs establish a real baseline.
 */

const SEEDED_ROW_COUNT = 1_000;
const PAGE_SIZE = 50; // matches webhook-deliveries-tab.tsx
const PAGE_LOAD_BUDGET_MS = 10_000;
const FILTER_APPLY_BUDGET_MS = 10_000;

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook deliveries tab — large dataset performance (N-03)", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let outboundConfigId: string;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Perf Deliveries ${uniqueId}`);
    prisma = new PrismaClient();

    const seeded = await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/perf/outbound",
      name: "E2E Perf Outbound",
    });
    outboundConfigId = seeded.configId;

    // Bulk-seed 1,000 delivery rows via createMany. The shared seedDeliveries
    // helper writes paired WebhookOutboxEvent rows (replay needs them) but
    // this spec never drives replay — skipping outbox creation halves the
    // setup time and avoids two-orders-of-magnitude write amplification.
    //
    // payloadDigest is required (NOT NULL) and stores the SHA-256 of the
    // raw request body. We synthesise a small JSON envelope per row so the
    // digest is unique; production readers (the deliveries-tab table only
    // displays the digest in the drawer) treat it as opaque.
    //
    // receivedAt is staggered 1ms apart so orderBy [receivedAt desc, id desc]
    // returns rows in a deterministic insertion order — matters for the
    // pagination assertion that the first 50 visible rows are the most
    // recent 50.
    const baseTs = Date.now();
    const rows: Array<{
      webhookConfigId: string;
      direction: "OUTBOUND";
      adapterType: "GENERIC_HMAC";
      eventType: string;
      eventId: string;
      statusCode: number;
      latencyMs: number;
      payloadDigest: string;
      error: null;
      attempt: number;
      replayedFromDeliveryId: null;
      receivedAt: Date;
    }> = [];
    for (let i = 0; i < SEEDED_ROW_COUNT; i++) {
      const eventId = `evt_perf_${uniqueId}_${i}`;
      const payload = JSON.stringify({
        eventName: "test_run.completed",
        eventId,
        idx: i,
      });
      rows.push({
        webhookConfigId: outboundConfigId,
        direction: "OUTBOUND",
        adapterType: "GENERIC_HMAC",
        eventType: "test_run.completed",
        eventId,
        statusCode: 200,
        latencyMs: 12,
        payloadDigest: createHash("sha256").update(payload).digest("hex"),
        error: null,
        attempt: 1,
        replayedFromDeliveryId: null,
        receivedAt: new Date(baseTs + i),
      });
    }
    await prisma.webhookDelivery.createMany({ data: rows });
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test(`tab renders first page of ${PAGE_SIZE} rows within ${PAGE_LOAD_BUDGET_MS}ms against ${SEEDED_ROW_COUNT} seeded rows; Load more is visible; config-filter change does not stall the UI`, async ({
    page,
    baseURL,
  }) => {
    // 1. Navigate to the Deliveries tab and time the path from URL submit
    //    to the first row rendering. Use a since=epoch filter so the
    //    default last-7-days filter does not exclude the seeded rows
    //    (seed timestamps are based on Date.now() so technically they ARE
    //    within last-7-days, but pinning the filter explicitly removes a
    //    subtle dependency on test wall-clock).
    const deliveriesUrl =
      `${baseURL}/projects/settings/${projectId}/webhooks` +
      `?tab=deliveries&since=${new Date(0).toISOString()}`;

    const t0 = Date.now();
    await page.goto(deliveriesUrl);
    await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
      timeout: PAGE_LOAD_BUDGET_MS,
    });
    await expect(page.getByTestId("webhook-deliveries-table")).toBeVisible({
      timeout: PAGE_LOAD_BUDGET_MS,
    });
    // Wait for the first row to render — proves the table is not just an
    // empty skeleton. Without this guard the budget could pass while the
    // useFindManyWebhookDelivery query is still in-flight.
    await expect(
      page.locator('[data-testid^="webhook-delivery-row-"]').first()
    ).toBeVisible({
      timeout: PAGE_LOAD_BUDGET_MS,
    });
    const initialRenderMs = Date.now() - t0;
    expect(
      initialRenderMs,
      `Deliveries tab took ${initialRenderMs}ms to render against ${SEEDED_ROW_COUNT} rows; budget=${PAGE_LOAD_BUDGET_MS}ms. A useFindManyWebhookDelivery query without 'take' would explode here.`
    ).toBeLessThan(PAGE_LOAD_BUDGET_MS);

    // 2. The first page renders exactly PAGE_SIZE rows (proves the `take`
    //    in useFindManyWebhookDelivery is honoured). A naive table that
    //    hydrates ALL 1,000 rows would fail this assertion AND the
    //    timing assertion above.
    const visibleRowCount = await page
      .locator('[data-testid^="webhook-delivery-row-"]')
      .count();
    expect(
      visibleRowCount,
      `Expected exactly ${PAGE_SIZE} rows on page 1; got ${visibleRowCount}`
    ).toBe(PAGE_SIZE);

    // 3. Load more button is visible (the deliveries.length >= PAGE_SIZE
    //    gate in webhook-deliveries-tab.tsx:466). Exists IFF we have at
    //    least one full page → the next-page cursor is reachable.
    await expect(
      page.getByTestId("webhook-deliveries-load-more")
    ).toBeVisible();

    // 4. Click Load more → query re-runs with cursor=last-row-id + skip:1
    //    and the result REPLACES the visible rows (cursor pagination is
    //    page-replace, not infinite-append, in the current implementation
    //    at webhook-deliveries-tab.tsx:472-475). Capture page-1 row IDs
    //    before the click and assert page-2 returns a disjoint set —
    //    proves the cursor was honoured, the rows DID change, and the
    //    query returned a fresh page within budget.
    const page1Ids = await page
      .locator('[data-testid^="webhook-delivery-row-"]')
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).getAttribute("data-testid"))
      );
    expect(page1Ids).toHaveLength(PAGE_SIZE);

    await page.getByTestId("webhook-deliveries-load-more").click();
    await expect
      .poll(
        async () => {
          const ids = await page
            .locator('[data-testid^="webhook-delivery-row-"]')
            .evaluateAll((els) =>
              els.map((el) => (el as HTMLElement).getAttribute("data-testid"))
            );
          // Settled = exactly PAGE_SIZE rows AND none overlap with page 1.
          if (ids.length !== PAGE_SIZE) return false;
          return ids.every((id) => !page1Ids.includes(id));
        },
        {
          message: `Load more did not converge on a fresh PAGE_SIZE-sized page disjoint from page 1`,
          timeout: PAGE_LOAD_BUDGET_MS,
        }
      )
      .toBe(true);

    // 5. Apply the config filter — the dropdown lists the seeded outbound
    //    config; selecting it re-runs the query under the same cursor
    //    state but with where.webhookConfigId in [outboundConfigId]. Time
    //    the round-trip: a filter regression that drops `take` would
    //    blow this budget the same way the initial render did.
    const t1 = Date.now();
    await page.getByTestId("webhook-deliveries-filter-config").click();
    await page
      .getByRole("option", { name: "E2E Perf Outbound" })
      .first()
      .click();
    // The first page after filter applies — by design only the seeded
    // outbound config has rows in this project, so post-filter row count
    // matches PAGE_SIZE again (same config, just under-filter).
    await expect
      .poll(
        async () =>
          await page.locator('[data-testid^="webhook-delivery-row-"]').count(),
        {
          message:
            "Filter apply did not converge to PAGE_SIZE rows within budget — useFindManyWebhookDelivery may be over-fetching",
          timeout: FILTER_APPLY_BUDGET_MS,
        }
      )
      .toBe(PAGE_SIZE);
    const filterApplyMs = Date.now() - t1;
    expect(
      filterApplyMs,
      `Filter apply took ${filterApplyMs}ms; budget=${FILTER_APPLY_BUDGET_MS}ms`
    ).toBeLessThan(FILTER_APPLY_BUDGET_MS);

    // 6. URL preserves the filter (D-32 — filter state lives in URL params
    //    so reload is idempotent). Poll because router.replace inside
    //    updateFilter is async with respect to the click that triggered
    //    it, and the row-count poll above can settle before the URL
    //    commits (this project has one config so post-filter row count
    //    equals pre-filter row count). The param key is `configIds`
    //    plural — matches updateFilter / parseFilterFromSearchParams in
    //    webhook-deliveries-tab.tsx; a single selection is the bare id.
    await expect
      .poll(() => page.url(), {
        message:
          "Filter selection did not push configIds=<id> into the URL within budget — router.replace may have failed",
        timeout: 5_000,
      })
      .toContain(`configIds=${outboundConfigId}`);
  });
});
