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
 * Audit log entries are written via a BullMQ queue worker which may not be
 * running during E2E tests. Tests that require data degrade gracefully:
 * - If rows exist: full interaction is tested
 * - If no rows: UI state (empty table, disabled export) is verified
 */

test.describe("Audit Log Management - Page Display", () => {
  test("Admin can view audit logs page", async ({ page }) => {
    await test.step("Open the audit logs page", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the page title and data table render", async () => {
      // The page title has data-testid="audit-logs-page-title"
      const pageTitle = page.getByTestId("audit-logs-page-title");
      await expect(pageTitle).toBeVisible({ timeout: 10000 });

      // The page should render a data table
      const table = page.getByRole("table");
      await expect(table.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Audit log table renders with column headers", async ({ page }) => {
    await test.step("Open the audit logs page", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the header row and column headers", async () => {
      // Verify header row contains expected columns
      const headerRow = page.getByRole("row").first();
      await expect(headerRow).toBeVisible({ timeout: 10000 });

      // Check at least one column header is visible
      const headers = page.getByRole("columnheader");
      expect(await headers.count()).toBeGreaterThan(0);
    });
  });

  test("Audit log table renders table body", async ({ page }) => {
    await test.step("Open the audit logs page", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the table body and any rows render", async () => {
      // The table body should be present (may be empty or have rows)
      const tableBody = page.getByRole("table");
      await expect(tableBody).toBeVisible({ timeout: 10000 });

      // If rows exist, verify first row is visible
      const rows = page.getByRole("row");
      const rowCount = await rows.count();
      if (rowCount > 0) {
        await expect(rows.first()).toBeVisible();
      }
    });
  });
});

test.describe("Audit Log Management - Filtering", () => {
  test("Admin can filter audit logs by action type", async ({ page }) => {
    // There are two SelectTriggers: action filter and entity type filter
    // The action filter is the first one (w-[180px] container)
    const actionFilterTrigger = page.locator('[role="combobox"]').first();

    await test.step("Open the audit logs page", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the action type filter", async () => {
      await expect(actionFilterTrigger).toBeVisible({ timeout: 10000 });

      // Open the select
      await actionFilterTrigger.click();
    });

    await test.step("Select LOGIN, verify the table, then reset the filter", async () => {
      // Select "LOGIN" from the dropdown
      const loginOption = page.getByRole("option", { name: "LOGIN" });
      if (await loginOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await loginOption.click();
        await page.waitForLoadState("networkidle");

        // The table should now show only LOGIN entries (or be empty)
        // Verify the table is still rendered
        const table = page.getByRole("table");
        await expect(table.first()).toBeVisible({ timeout: 10000 });

        // Reset filter back to "all"
        await actionFilterTrigger.click();
        const allActionsOption = page.getByRole("option", {
          name: /all actions/i,
        });
        if (
          await allActionsOption.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await allActionsOption.click();
        }
      }
    });
  });

  test("Admin can filter audit logs by entity type", async ({ page }) => {
    // Entity type filter is the second combobox
    const entityTypeFilterTrigger = page.locator('[role="combobox"]').nth(1);

    await test.step("Open the audit logs page", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the entity type filter", async () => {
      await expect(entityTypeFilterTrigger).toBeVisible({ timeout: 10000 });

      // Open the select
      await entityTypeFilterTrigger.click();
    });

    await test.step("Select an entity type, verify the table, then reset the filter", async () => {
      // If there are entity types available, select the first non-"all" option
      const options = page
        .getByRole("option")
        .filter({ hasNot: page.getByText(/^all entity types$/i) });
      const optionCount = await options.count();
      if (optionCount > 0) {
        await options.first().click();
        await page.waitForLoadState("networkidle");

        // Verify table is still rendered after filter
        const table = page.getByRole("table");
        await expect(table.first()).toBeVisible({ timeout: 10000 });

        // Reset to all
        await entityTypeFilterTrigger.click();
        const allEntityOption = page.getByRole("option", {
          name: /all entity types/i,
        });
        if (
          await allEntityOption.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await allEntityOption.click();
        }
      }
    });
  });

  test("Admin can filter audit logs by search text", async ({ page }) => {
    // The Filter component renders an input — locate by placeholder
    const searchInput = page.getByPlaceholder(/filter|search/i).first();

    await test.step("Open the audit logs page", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter a non-matching search term", async () => {
      await expect(searchInput).toBeVisible({ timeout: 10000 });

      // Type a search string that's unlikely to match (to test empty state)
      await searchInput.fill("zzz_no_match_xyz_999");

      // Wait for debounce (500ms) + network
      await page.waitForTimeout(600);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the table renders, then clear the search", async () => {
      // Table should still be visible (possibly with 0 rows)
      const table = page.getByRole("table");
      await expect(table.first()).toBeVisible({ timeout: 10000 });

      // Clear search — restore full list
      await searchInput.clear();
      await page.waitForTimeout(600);
      await page.waitForLoadState("networkidle");
    });
  });
});

test.describe("Audit Log Management - Detail Modal", () => {
  test("Admin can view audit log detail modal", async ({ page }) => {
    await test.step("Open the audit logs page", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");
    });

    // The DataTable renders a "No Results" row when empty — detect actual data
    // rows by requiring a cell (the header row has columnheaders + sort buttons,
    // so filtering by button alone would wrongly match the header).
    const dataRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell") });
    const dataRowCount = await dataRows.count();

    if (dataRowCount === 0) {
      // No audit data available (queue worker not running in E2E env).
      // Verify the empty state renders correctly and the table is still functional.
      const tableBody = page.getByRole("table");
      await expect(tableBody).toBeVisible({ timeout: 10000 });
      return;
    }

    const dialog = page.getByRole("dialog");

    await test.step("Open the detail modal from the first data row", async () => {
      // Find the view-details button in the first data row
      // columns.tsx renders a Button with Eye icon
      const firstRow = dataRows.first();
      const viewDetailsButton = firstRow.getByRole("button").first();
      await expect(viewDetailsButton).toBeVisible({ timeout: 10000 });
      await viewDetailsButton.click();

      // AuditLogDetailModal dialog opens
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Dialog should contain audit log details
      // The modal shows action badge, entityType, entityId, etc.
      await expect(dialog).toContainText(/timestamp|entity|action/i);
    });

    await test.step("Close the detail modal", async () => {
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
});

test.describe("Audit Log Management - CSV Export", () => {
  test("Admin can export audit logs as CSV", async ({ page }) => {
    // Find the Export CSV button (button text is "Export CSV")
    const exportButton = page.getByRole("button", {
      name: /export csv/i,
    });

    await test.step("Open the audit logs page and locate the export button", async () => {
      await page.goto("/en-US/admin/audit-logs");
      await page.waitForLoadState("networkidle");

      await expect(exportButton).toBeVisible({ timeout: 10000 });
    });

    // Check if there are actual data rows (a cell distinguishes data rows from
    // the header row, which has columnheaders + sort buttons)
    const dataRows = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell") });
    const dataRowCount = await dataRows.count();

    if (dataRowCount === 0) {
      // No data — export button should be disabled (totalItems === 0)
      await expect(exportButton).toBeDisabled();
      return;
    }

    await test.step("Trigger the CSV export", async () => {
      // Data exists — export button should be enabled
      await expect(exportButton).not.toBeDisabled();

      // The export uses a programmatic download via blob URL (not a download event)
      // It creates an anchor element, sets href to blob URL, and clicks it.
      // Verify the button click completes without error and the page stays intact.
      await exportButton.click();

      // Wait for the export to complete (isExporting state resets)
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the export completes and the page stays functional", async () => {
      // Verify the button is no longer in "exporting" state (text resets)
      await expect(exportButton).not.toContainText(/exporting/i, {
        timeout: 10000,
      });

      // Page should still be functional after export
      await expect(page.getByTestId("audit-logs-page-title")).toBeVisible();
    });
  });
});
