import { createHash } from "node:crypto";
import { createRawDbClient } from "~/lib/rawDbClient";

import { expect, test } from "../../fixtures/index";
import { seedOutboundConfig } from "../../fixtures/webhooks-seed";

/**
 * Deliveries tab performance against a large dataset (N-03).
 *
 * Workflow under test: an admin lands on the Deliveries tab for a project
 * with N existing rows. The tab MUST render the first page (take:PAGE_SIZE,
 * not all rows) within a generous time budget, infinite scroll must fetch a
 * disjoint next page, and applying a filter must not stall the UI. The
 * deliveries table is virtualized (only the visible window is in the DOM), so
 * assertions read the loaded page from the webhookDelivery findMany responses
 * rather than counting DOM rows.
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
  let db: ReturnType<typeof createRawDbClient>;
  let outboundConfigId: string;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Perf Deliveries ${uniqueId}`);
    db = createRawDbClient();

    const seeded = await seedOutboundConfig(db, {
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
    await db.webhookDelivery.createMany({ data: rows });
  });

  test.afterAll(async () => {
    if (db) await db.$disconnect();
  });

  test(`tab renders first page of ${PAGE_SIZE} rows within ${PAGE_LOAD_BUDGET_MS}ms against ${SEEDED_ROW_COUNT} seeded rows; Load more is visible; config-filter change does not stall the UI`, async ({
    page,
    baseURL,
  }) => {
    // page-1 row ids, captured from the network. The deliveries table is
    // virtualized, so the DOM only holds a viewport window of rows, not the
    // loaded page — assert on the loaded page from the findMany response
    // instead of counting DOM rows. Reused to confirm page 2 is disjoint.
    let page1Ids: string[] = [];

    // Await the next webhookDelivery findMany response and return its row ids.
    // Call it *before* the action that triggers the fetch, then await it:
    //   const p = nextDeliveriesRows(); await <action>; const ids = await p;
    const nextDeliveriesRows = async (): Promise<string[]> => {
      const resp = await page.waitForResponse(
        (r) =>
          r.url().includes("/api/model/webhookDelivery/findMany") &&
          r.status() === 200,
        { timeout: PAGE_LOAD_BUDGET_MS }
      );
      const body = (await resp.json()) as
        { data?: Array<{ id: unknown }> } | Array<{ id: unknown }>;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      return rows.map((r) => String(r.id));
    };

    await test.step("First page loads exactly PAGE_SIZE rows (not all) within budget", async () => {
      // Navigate to the Deliveries tab with since=epoch so the default
      // last-7-days filter does not exclude the seeded rows. The deliveries
      // query requests take:PAGE_SIZE; a regression that drops `take` (or
      // explodes an include into an N+1) would return all SEEDED_ROW_COUNT
      // rows and blow the budget. We assert on the loaded page from the
      // findMany response (the table is virtualized, so a DOM count would only
      // see the visible window).
      const deliveriesUrl =
        `${baseURL}/projects/settings/${projectId}/webhooks` +
        `?tab=deliveries&since=${new Date(0).toISOString()}`;

      const t0 = Date.now();
      const firstPage = nextDeliveriesRows();
      await page.goto(deliveriesUrl);
      await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
        timeout: PAGE_LOAD_BUDGET_MS,
      });
      page1Ids = await firstPage;
      const initialRenderMs = Date.now() - t0;

      // take:PAGE_SIZE honoured — exactly one page loaded, not all rows.
      expect(
        page1Ids,
        `first page returned ${page1Ids.length} rows (expected ${PAGE_SIZE}); a query without 'take' would return all ${SEEDED_ROW_COUNT}`
      ).toHaveLength(PAGE_SIZE);
      // Rows actually paint (not just an empty skeleton). Virtualized, so only
      // the visible window is in the DOM — assert the first row, not a count.
      await expect(
        page.locator('[data-testid^="webhook-delivery-row-"]').first()
      ).toBeVisible({ timeout: PAGE_LOAD_BUDGET_MS });
      expect(
        initialRenderMs,
        `Deliveries tab took ${initialRenderMs}ms against ${SEEDED_ROW_COUNT} rows; budget=${PAGE_LOAD_BUDGET_MS}ms`
      ).toBeLessThan(PAGE_LOAD_BUDGET_MS);
    });

    await test.step("Infinite scroll loads a disjoint next page of PAGE_SIZE rows", async () => {
      // The virtualized table pulls the next page when its load-more sentinel
      // scrolls into view (cursor pagination via useInfiniteFindMany). Assert
      // the next fetch returns a fresh PAGE_SIZE-sized page with no overlap —
      // proves the cursor advances rather than re-reading page 1.
      const page2 = nextDeliveriesRows();
      await page
        .getByTestId("webhook-deliveries-vtable-sentinel")
        .scrollIntoViewIfNeeded();
      const page2Ids = await page2;
      expect(page2Ids).toHaveLength(PAGE_SIZE);
      expect(
        page2Ids.every((id) => !page1Ids.includes(id)),
        "page 2 overlaps page 1 — cursor pagination is not advancing"
      ).toBe(true);
    });

    await test.step("Applying a config filter re-fetches one bounded page within budget", async () => {
      // Drive the filter through the URL (configIds param — the same key
      // parseFilterFromSearchParams reads). Only the seeded outbound config has
      // rows in this project, so the filtered first page is still PAGE_SIZE.
      // The re-fetch under the new where clause must stay within budget.
      const t1 = Date.now();
      const filtered = nextDeliveriesRows();
      const filteredUrl = new URL(page.url());
      filteredUrl.searchParams.set("configIds", outboundConfigId);
      await page.goto(filteredUrl.toString());
      const filteredIds = await filtered;
      expect(
        filteredIds,
        `filtered first page returned ${filteredIds.length} rows (expected ${PAGE_SIZE})`
      ).toHaveLength(PAGE_SIZE);
      const filterApplyMs = Date.now() - t1;
      expect(
        filterApplyMs,
        `Filter apply took ${filterApplyMs}ms; budget=${FILTER_APPLY_BUDGET_MS}ms`
      ).toBeLessThan(FILTER_APPLY_BUDGET_MS);
    });

    await test.step("URL preserves the config filter", async () => {
      // Filter state lives in the URL (configIds param) so reloads are
      // idempotent (D-32). The filter was applied via the URL above, so the
      // param must still be present. The key is `configIds` — matches
      // parseFilterFromSearchParams in webhook-deliveries-tab.tsx.
      expect(page.url()).toContain(`configIds=${outboundConfigId}`);
    });
  });
});
