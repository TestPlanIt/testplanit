import { expect, test } from "../../../fixtures";

/**
 * Audit Log Management E2E Tests
 *
 * Tests for the Admin > Audit Logs page covering:
 * - Viewing the audit log table
 * - Filtering by action type (AuditAction enum)
 * - Filtering by search text
 * - Viewing the detail modal for a log entry
 * - Exporting audit logs as CSV
 *
 * The page renders a VirtualizedDataTable (testIdPrefix="audit-logs-table",
 * rowTestIdPrefix="audit-log-row"), which is an ARIA-rolled div structure — NOT
 * a semantic <table>/<thead>/<tbody>. The container carries
 * data-testid="audit-logs-table", the scroll body "audit-logs-table-scroll",
 * each data row "audit-log-row-<id>", header cells role="columnheader", and the
 * row view-details button data-testid="audit-log-view-details". Because the
 * row/cell/columnheader roles have no role="table" ancestor, they are matched by
 * literal [role=...] attribute selectors rather than Playwright getByRole.
 *
 * Audit log entries are written via a BullMQ queue worker which may not be
 * running during E2E tests. Tests that require data degrade gracefully:
 * - If rows exist: full interaction is tested
 * - If no rows: UI state (empty table, disabled export) is verified
 */

test.describe("Audit Log Management - Page Display", () => {
  test("Admin can view audit logs page", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // The page title has data-testid="audit-logs-page-title"
    const pageTitle = page.getByTestId("audit-logs-page-title");
    await expect(pageTitle).toBeVisible({ timeout: 10000 });

    // The page renders the virtualized audit-log table container
    const table = page.getByTestId("audit-logs-table");
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test("Audit log table renders with column headers", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // The table renders a header row of role="columnheader" cells
    const table = page.getByTestId("audit-logs-table");
    await expect(table).toBeVisible({ timeout: 10000 });

    const headers = table.locator('[role="columnheader"]');
    expect(await headers.count()).toBeGreaterThan(0);
    await expect(headers.first()).toBeVisible();
  });

  test("Audit log table renders table body", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // The scroll body holds the virtualized rows (empty-state copy or data rows)
    const scrollBody = page.getByTestId("audit-logs-table-scroll");
    await expect(scrollBody).toBeVisible({ timeout: 10000 });

    // If rows exist, verify the first row is visible
    const rows = page.locator('[data-testid^="audit-log-row-"]');
    if ((await rows.count()) > 0) {
      await expect(rows.first()).toBeVisible();
    }
  });
});

test.describe("Audit Log Management - Filtering", () => {
  test("Admin can filter audit logs by action type", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // The action filter is the first MultiAsyncCombobox trigger; the
    // DateRangePicker before it is a plain button. Scoped to `button` so the
    // cmdk search input (also role="combobox") can't match once open.
    const actionFilter = page.locator('button[role="combobox"]').first();
    await expect(actionFilter).toBeVisible({ timeout: 10000 });
    await actionFilter.click();

    // getAuditLogActions only offers actions that have rows behind them, and
    // which actions exist shifts as other specs write audit entries, so drive
    // the selection from whatever the picker actually lists.
    const options = page.locator('[role="option"]');
    await expect(options.first()).toBeVisible({ timeout: 5000 });
    const action = (await options.first().innerText()).trim();

    await options.first().click();
    await page.keyboard.press("Escape");

    // The selection shows as a badge on the trigger and the table re-renders.
    await expect(actionFilter).toContainText(action, { timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("audit-logs-table")).toBeVisible({
      timeout: 10000,
    });

    // Removing the badge clears the filter back to "All Actions".
    await actionFilter
      .locator('[role="button"]')
      .first()
      .click({ force: true });
    await expect(actionFilter).toContainText(/all actions/i, { timeout: 5000 });
  });

  test("Admin can select multiple action types at once", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    const actionFilter = page.locator('button[role="combobox"]').first();
    await expect(actionFilter).toBeVisible({ timeout: 10000 });
    await actionFilter.click();

    // Same data-driven selection as the single-select test: take the first two
    // actions the picker offers rather than naming ones that may have no rows.
    const options = page.locator('[role="option"]');
    await expect(options.first()).toBeVisible({ timeout: 5000 });
    const available = (await options.allInnerTexts())
      .map((text) => text.trim())
      .filter(Boolean);
    expect(
      available.length,
      "need at least two audit actions present to multi-select"
    ).toBeGreaterThanOrEqual(2);
    const [firstAction, secondAction] = available;

    // Options render in source order and keep their position when selected, so
    // the popover stays open and both can be picked by index in one pass.
    await options.nth(0).click();
    await options.nth(1).click();

    await page.keyboard.press("Escape");

    await expect(actionFilter).toContainText(firstAction, {
      timeout: 5000,
    });
    await expect(actionFilter).toContainText(secondAction);

    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("audit-logs-table")).toBeVisible({
      timeout: 10000,
    });
  });

  test("Admin can filter audit logs by entity type", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // Entity type filter is the second combobox trigger
    const entityTypeFilter = page.locator('button[role="combobox"]').nth(1);
    await expect(entityTypeFilter).toBeVisible({ timeout: 10000 });
    await entityTypeFilter.click();

    // Entity types come from the audit rows themselves, so the list is empty
    // when the queue worker hasn't produced any.
    const options = page
      .locator('[role="option"]')
      .filter({ hasNotText: "Select All" });

    if ((await options.count()) === 0) {
      await page.keyboard.press("Escape");
      return;
    }

    const entityType = (await options.first().innerText()).trim();
    await options.first().click();
    await page.keyboard.press("Escape");

    await expect(entityTypeFilter).toContainText(entityType, { timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("audit-logs-table")).toBeVisible({
      timeout: 10000,
    });
  });

  test("Admin can filter audit logs by search text", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // The Filter component renders an input — locate by placeholder
    const searchInput = page.getByPlaceholder(/filter|search/i).first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Type a search string that's unlikely to match (to test empty state)
    await searchInput.fill("zzz_no_match_xyz_999");

    // Wait for debounce (500ms) + network
    await page.waitForTimeout(600);
    await page.waitForLoadState("networkidle");

    // Table should still be rendered (possibly with 0 rows)
    await expect(page.getByTestId("audit-logs-table")).toBeVisible({
      timeout: 10000,
    });

    // Clear search — restore full list
    await searchInput.clear();
    await page.waitForTimeout(600);
    await page.waitForLoadState("networkidle");
  });
});

test.describe("Audit Log Management - Detail Modal", () => {
  test("Admin can view audit log detail modal", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // Data rows carry data-testid="audit-log-row-<id>". When the queue worker
    // hasn't produced rows in the E2E env, none are present.
    const dataRows = page.locator('[data-testid^="audit-log-row-"]');
    const dataRowCount = await dataRows.count();

    if (dataRowCount === 0) {
      // No audit data available — verify the table body (empty state) renders.
      await expect(page.getByTestId("audit-logs-table-scroll")).toBeVisible({
        timeout: 10000,
      });
      return;
    }

    // Open the view-details modal from the first row's Eye button. Scoped by
    // testid so a grouped row's expand toggle isn't clicked by mistake.
    const viewDetailsButton = page
      .getByTestId("audit-log-view-details")
      .first();
    await expect(viewDetailsButton).toBeVisible({ timeout: 10000 });
    await viewDetailsButton.click();

    // AuditLogDetailModal dialog opens
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog should contain audit log details
    // The modal shows action badge, entityType, entityId, etc.
    await expect(dialog).toContainText(/timestamp|entity|action/i);

    // Close the dialog
    const closeButton = dialog.getByRole("button", { name: /close/i });
    if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeButton.click();
    } else {
      // Press Escape to close
      await page.keyboard.press("Escape");
    }

    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe("Audit Log Management - CSV Export", () => {
  test("Admin can export audit logs as CSV", async ({ page }) => {
    await page.goto("/en-US/admin/audit-logs");
    await page.waitForLoadState("networkidle");

    // Find the Export CSV button (button text is "Export CSV")
    const exportButton = page.getByRole("button", {
      name: /export csv/i,
    });
    await expect(exportButton).toBeVisible({ timeout: 10000 });

    // Check whether any data rows exist (export is disabled when totalCount is 0)
    const dataRows = page.locator('[data-testid^="audit-log-row-"]');
    const dataRowCount = await dataRows.count();

    if (dataRowCount === 0) {
      // No data — export button should be disabled (totalCount === 0)
      await expect(exportButton).toBeDisabled();
      return;
    }

    // Data exists — export button should be enabled
    await expect(exportButton).not.toBeDisabled();

    // The export uses a programmatic download via blob URL (not a download event)
    // It creates an anchor element, sets href to blob URL, and clicks it.
    // Verify the button click completes without error and the page stays intact.
    await exportButton.click();

    // Wait for the export to complete (isExporting state resets)
    await page.waitForLoadState("networkidle");

    // Verify the button is no longer in "exporting" state (text resets)
    await expect(exportButton).not.toContainText(/exporting/i, {
      timeout: 10000,
    });

    // Page should still be functional after export
    await expect(page.getByTestId("audit-logs-page-title")).toBeVisible();
  });
});
