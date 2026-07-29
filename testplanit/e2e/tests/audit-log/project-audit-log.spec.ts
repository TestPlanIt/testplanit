import { expect, test } from "../../fixtures";
import type { Page } from "@playwright/test";

/**
 * Project > Audit Log surface (app/[locale]/projects/audit-logs/[projectId],
 * rendered by components/projects/ProjectAuditLog.tsx).
 *
 * The page is gated to ADMIN / PROJECTADMIN (ProjectMenu + page guard + the
 * AuditLog @@allow policy); the E2E user is a system admin, so it is reachable.
 * Data is hard-scoped to the project. The audit rows are materialized
 * asynchronously by the CDC correlation worker, so the row/detail assertions are
 * best-effort (retry + warn) while the rendering / access / structure assertions
 * are authoritative — matching the audit-log-management.spec.ts precedent.
 *
 * Table testIdPrefix="project-audit-logs-table", rowTestIdPrefix="project-audit-log-row".
 */

// Reload-retry for CDC-async rows: the page's initial query can fire before the
// worker correlates DataChangeLog → AuditLog. Returns true once a row appears.
async function waitForRows(page: Page, prefix: string): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    const row = page.locator(`[data-testid^="${prefix}"]`).first();
    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) return true;
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
  return false;
}

test.describe("Project Audit Log", () => {
  test("renders the project-scoped audit trail with table, filters, and detail modal", async ({
    api,
    page,
  }) => {
    let projectId: number;

    await test.step("Create a project + case (generates project-scoped audit rows)", async () => {
      const stamp = `${Date.now()}`;
      projectId = await api.createProject(`E2E Project Audit ${stamp}`);
      const folderId = await api.createFolder(projectId, `Folder ${stamp}`);
      await api.createTestCase(projectId, folderId, `Case ${stamp}`);
    });

    await test.step("The ADMIN-gated page opens and identifies the project surface", async () => {
      await page.goto(`/en-US/projects/audit-logs/${projectId}`);
      await page.waitForLoadState("networkidle");
      // The prose description moved into the help popover; the card title
      // identifies the surface now.
      await expect(page.getByText("Audit Logs").first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("The virtualized table and column headers render", async () => {
      const table = page.getByTestId("project-audit-logs-table");
      await expect(table).toBeVisible({ timeout: 10000 });
      const headers = table.locator('[role="columnheader"]');
      expect(await headers.count()).toBeGreaterThan(0);
    });

    await test.step("The project's audit rows appear and the detail modal opens (best-effort)", async () => {
      const hasRows = await waitForRows(page, "project-audit-log-row-");
      if (!hasRows) {
        console.warn(
          "[project-audit-log] no rows materialized in time (CDC worker lag) — verifying empty render only"
        );
        await expect(
          page.getByTestId("project-audit-logs-table")
        ).toBeVisible();
        return;
      }

      await page.getByTestId("audit-log-view-details").first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await expect(dialog).toContainText(/timestamp|entity|action/i);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Filtering by action keeps the table rendered", async () => {
      // Action filter is the first MultiAsyncCombobox trigger (the
      // DateRangePicker before it is a plain button). Scoped to `button` so the
      // cmdk search input (also role="combobox") can't match once open.
      const actionFilter = page.locator('button[role="combobox"]').first();
      await expect(actionFilter).toBeVisible({ timeout: 10000 });
      await actionFilter.click();

      // The action list is paginated, so narrow it by search before selecting.
      await page.locator("[cmdk-input]").first().fill("BULK CREATE");
      const bulkCreateOption = page.locator(
        '[role="option"]:has-text("BULK CREATE")'
      );
      await expect(bulkCreateOption).toBeVisible({ timeout: 5000 });
      await bulkCreateOption.click();
      await page.keyboard.press("Escape");

      await expect(actionFilter).toContainText("BULK CREATE", {
        timeout: 5000,
      });
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("project-audit-logs-table")).toBeVisible({
        timeout: 10000,
      });
    });
  });
});
