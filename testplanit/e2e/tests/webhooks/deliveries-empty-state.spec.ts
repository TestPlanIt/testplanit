

import { expect, test } from "../../fixtures/index";
import { createRawDbClient } from "~/lib/rawDbClient";
import { seedOutboundConfig } from "../../fixtures/webhooks-seed";

/**
 * Deliveries tab empty state (E-06).
 *
 * Workflow under test: a fresh project with NO webhooks configured →
 * navigate to the Deliveries tab → empty-state copy renders ("No
 * deliveries match these filters") with a Reset filters button → click
 * Reset filters → URL query params reset to just `?tab=deliveries`
 * (no `configIds`, `status`, `since`, or `until` params). The reset
 * also resets the cursor pagination state to null.
 *
 * The empty-state CTA matters because the Deliveries tab renders the
 * filter bar above the empty box: a confused admin staring at "No
 * deliveries" with `?status=failed&since=...&configIds=...` in the URL
 * needs an obvious one-click escape back to the default view. The
 * reset path lives in resetFilters() in webhook-deliveries-tab.tsx:
 * 221-226 — it builds a fresh URLSearchParams with just `tab=
 * deliveries` and replace()s the route.
 *
 * No webhooks setup is required for this spec — empty state surfaces
 * regardless of webhook config presence when there are zero deliveries
 * matching the active filter (the gate is `deliveries.length === 0`).
 * Driving with a freshly-created project avoids any pre-existing rows
 * from earlier runs leaking into the view.
 */

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Webhook deliveries tab empty state — copy + Reset filters CTA (E-06)", () => {
  let projectId: number;
  let prisma: PrismaClient;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Empty Deliveries ${uniqueId}`);
    prisma = createRawDbClient();
    // Seed an outbound config so the deliveries tab renders the
    // "no matches" empty-state (with Reset filters CTA), NOT the
    // "no webhooks configured" empty-state. The two branches are
    // distinguished by `configList.length` in renderEmpty().
    await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/E-06/empty-state",
      name: "E2E E-06 Outbound",
    });
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("admin lands on Deliveries tab, sees empty-state copy + Reset filters button, click clears filter query params", async ({
    page,
    baseURL,
  }) => {
    let resetButton: ReturnType<typeof page.getByTestId> | undefined;

    await test.step("Land on the Deliveries tab with a non-default filter applied", async () => {
      // 1. Land on the Deliveries tab with a non-default filter applied.
      //    Using `status=failed` ensures the empty-state branch renders
      //    even if a future seed accidentally drops a stray delivery row;
      //    the empty-state gate is `deliveries.length === 0` after filter
      //    application, so the test stays meaningful regardless.
      const filteredUrl =
        `${baseURL}/projects/settings/${projectId}/webhooks` +
        `?tab=deliveries&status=failed&since=${new Date(0).toISOString()}`;
      await page.goto(filteredUrl);
      await expect(page.getByTestId("webhook-deliveries-tab")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("Verify empty-state copy, Reset filters button, and absent table", async () => {
      // 2. The empty-state container renders with the expected copy + a
      //    Reset filters button inside it (sibling to the "ghost" reset
      //    button in the filter bar — both reach the same handler).
      const empty = page.getByTestId("webhook-deliveries-empty");
      await expect(empty).toBeVisible({ timeout: 10_000 });
      await expect(empty).toContainText(/No deliveries match these filters/i);

      resetButton = page.getByTestId("webhook-deliveries-reset");
      await expect(resetButton).toBeVisible();
      await expect(resetButton).toContainText(/Reset filters/i);

      // 3. The full deliveries TABLE is NOT rendered when the empty state
      //    is showing (the component renders one or the other, never both).
      await expect(page.getByTestId("webhook-deliveries-table")).toHaveCount(0);
    });

    await test.step("Click Reset filters and confirm filter params clear while empty state holds", async () => {
      // 4. Click Reset filters → URL drops every filter param. The component's
      //    resetFilters() rebuilds the search params from `?tab=deliveries`,
      //    after which PaginationProvider re-syncs `page` + `pageSize` from
      //    its state. The exact suffix is therefore tab-deliveries plus a
      //    pagination tail; assert the filter keys are absent in step 5.
      await resetButton!.click();

      // Poll until every filter param is gone — the URL settles in two
      // steps (resetFilters writes ?tab=deliveries&page=...&pageSize=..., then
      // PaginationProvider may follow up). Polling guards against reading
      // page.url() in the brief window between those writes.
      await expect
        .poll(
          () => {
            const u = new URL(page.url());
            return [
              u.searchParams.get("status"),
              u.searchParams.get("since"),
              u.searchParams.get("until"),
              u.searchParams.get("configIds"),
            ];
          },
          { timeout: 5_000 }
        )
        .toEqual([null, null, null, null]);

      // 5. Defensive parse — tab is preserved; nothing else lingers.
      const url = new URL(page.url());
      expect(url.searchParams.get("tab")).toBe("deliveries");
      expect(url.searchParams.get("status")).toBeNull();
      expect(url.searchParams.get("since")).toBeNull();
      expect(url.searchParams.get("until")).toBeNull();
      expect(url.searchParams.get("configIds")).toBeNull();

      // 6. The empty state is still showing — a fresh project has zero
      //    deliveries to match the now-default filter (last-7-days,
      //    status=all, configIds=all), so the empty branch holds.
      await expect(page.getByTestId("webhook-deliveries-empty")).toBeVisible();
    });
  });
});
