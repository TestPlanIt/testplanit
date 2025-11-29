import { test, expect, Page } from "@playwright/test";
import {
  format,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfQuarter,
  endOfQuarter,
} from "date-fns";
import { loginAsAdmin } from "./helpers/auth";

// Helper function to select a date range preset
async function selectDateRangePreset(page: Page, presetName: string) {
  const dateRangeButton = page.locator('[data-testid="date-range-button"]');
  
  // Check if there's already a date range selected and clear it first
  const currentText = await dateRangeButton.textContent();
  if (currentText && !currentText.includes('Select date range')) {
    await dateRangeButton.click();
    await page.waitForTimeout(500);
    const clearButton = page.getByRole("button", { name: "Clear" });
    if (await clearButton.isVisible()) {
      await clearButton.click();
      await page.waitForTimeout(500);
    }
  }
  
  // Open date range picker
  await dateRangeButton.click();
  await page.waitForTimeout(1000);
  
  // Wait for the popover to be visible
  const popover = page.locator('[role="dialog"]');
  await expect(popover).toBeVisible();
  
  // Try multiple approaches to interact with the preset selector
  const presetSelect = page.locator('[data-testid="date-range-preset-select"]');
  
  // First ensure the element is in view
  await presetSelect.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  
  // Try clicking with different strategies
  let selectOpened = false;
  
  try {
    // First try: Direct click
    await presetSelect.click({ timeout: 2000 });
    selectOpened = true;
  } catch (e1) {
    try {
      // Second try: Click with force
      await presetSelect.click({ force: true, timeout: 2000 });
      selectOpened = true;
    } catch (e2) {
      // Third try: Use keyboard to focus and open
      await presetSelect.focus();
      await page.keyboard.press('Enter');
      selectOpened = true;
    }
  }
  
  if (!selectOpened) {
    throw new Error('Failed to open date range preset selector');
  }
  
  await page.waitForTimeout(500);
  
  // Look for the option - it might be in a portal
  const option = page.locator(`[role="option"]:has-text("${presetName}")`);
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
  
  // Wait for popover to close
  await page.waitForTimeout(1000);
  
  // Ensure popover is closed
  if (await popover.isVisible()) {
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);
  }
  
  return dateRangeButton;
}

test.describe("Report Date Filtering", () => {
  test.describe("Project Reports", () => {
    test.beforeEach(async ({ page }) => {
      // Login as admin
      await loginAsAdmin(page);
      
      // Navigate to E2E Test Project reports
      await page.goto("/en-US/projects/reports/331");
      await page.waitForLoadState("networkidle");
      // Wait for the report builder to be visible
      await page.waitForSelector('[data-testid="report-type-select"]', { timeout: 10000 });
    });

    test("should display date range picker in report builder", async ({
      page,
    }) => {
      // Check that date range picker is visible
      await expect(page.locator('[data-testid="date-range-button"]')).toBeVisible();
    });

    test("should filter reports by Last 7 days", async ({ page }) => {
      // First ensure dimensions and metrics are selected
      // Select a dimension - React Select uses input element
      await page.locator('#dimensions-select').click();
      await page.getByText("Test Run", { exact: true }).click();
      await page.waitForTimeout(500);

      // Select a metric - React Select uses input element
      await page.locator('#metrics-select').click();
      await page.getByText("Pass Rate (%)", { exact: true }).click();
      await page.waitForTimeout(500);

      // Apply Last 7 days filter using helper
      const dateRangeButton = await selectDateRangePreset(page, "Last 7 days");

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      
      // Wait for loading to complete - look for either a table or a "no data" message
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000); // Give extra time for the report to render

      // Verify results are displayed - check if we have a table or at least the report ran
      // The report might show "No data" if there's no test data for the last 7 days
      const table = page.getByRole("table");
      // Look for the specific "No results found" heading
      const noResultsHeading = page.getByText("No results found.", { exact: true });
      
      // Either we should have a table with results or a "no results" message
      const hasTable = await table.isVisible().catch(() => false);
      const hasNoResults = await noResultsHeading.isVisible().catch(() => false);
      
      expect(hasTable || hasNoResults).toBeTruthy();

      // If we got a table, verify it has data
      if (hasTable) {
        const tableRows = await page.getByRole("row").count();
        expect(tableRows).toBeGreaterThan(1); // Header + at least one data row
      }
      
      // Verify the date range is displayed correctly
      const verifyToday = new Date();
      const verifySevenDaysAgo = subDays(verifyToday, 6);
      
      // Check if the date range is displayed in the button
      await expect(dateRangeButton).toContainText(format(verifySevenDaysAgo, "MMM d"));
      await expect(dateRangeButton).toContainText(format(verifyToday, "MMM d, yyyy"));
    });

    test("should filter reports by Last 30 days", async ({ page }) => {
      // Select dimensions and metrics
      await page.locator('#dimensions-select').click();
      await page.getByText( "User", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Results Count", { exact: true }).click();

      // Apply Last 30 days filter
      await page.locator('[data-testid="date-range-button"]').click();
      await page.waitForTimeout(500); // Wait for popover animation
      
      // Wait for the popover content to be visible
      const popoverContent = page.locator('[role="dialog"]');
      await expect(popoverContent).toBeVisible();
      
      // Click on the preset selector using data-testid
      // The select might be at the edge of the viewport, so use force: true
      const presetSelect = page.locator('[data-testid="date-range-preset-select"]');
      await presetSelect.click({ force: true });
      
      // Wait for the select dropdown to appear (it's rendered in a portal)
      await page.waitForTimeout(300);
      
      // Wait for and click the option
      const option = page.getByRole("option", { name: "Last 30 days" });
      await option.waitFor({ state: 'visible', timeout: 5000 });
      await option.click({ force: true });
      
      // The popover should close automatically after selection
      await page.waitForTimeout(500);

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify results
      await expect(page.getByRole("table")).toBeVisible();

      // Check that we have data from the last 30 days
      const tableRows = await page.getByRole("row").count();
      expect(tableRows).toBeGreaterThan(1); // Header + at least one data row
    });

    test("should filter reports by Previous month", async ({ page }) => {
      // Select dimensions and metrics
      await page.locator('#dimensions-select').click();
      await page.getByText( "Status", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Results Count", { exact: true }).click();

      // Apply Previous month filter
      await page.locator('[data-testid="date-range-button"]').click();
      await page.waitForTimeout(500); // Wait for popover animation
      
      // Wait for the popover content to be visible
      const popoverContent = page.locator('[role="dialog"]');
      await expect(popoverContent).toBeVisible();
      
      // Click on the preset selector using data-testid
      // The select might be at the edge of the viewport, so use force: true
      const presetSelect = page.locator('[data-testid="date-range-preset-select"]');
      await presetSelect.click({ force: true });
      
      // Wait for the select dropdown to appear (it's rendered in a portal)
      await page.waitForTimeout(300);
      
      // Wait for and click the option
      const option = page.getByRole("option", { name: "Previous month" });
      await option.waitFor({ state: 'visible', timeout: 5000 });
      await option.click({ force: true });
      
      // The popover should close automatically after selection
      await page.waitForTimeout(500);

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify the date range shows previous month
      const previousMonth = subMonths(new Date(), 1);
      const monthStart = startOfMonth(previousMonth);
      const monthEnd = endOfMonth(previousMonth);
      
      // Wait for the date range button to update
      await page.waitForTimeout(1000);
      
      // Check if the date range is displayed in the button
      const dateRangeButton = page.locator('[data-testid="date-range-button"]');
      await expect(dateRangeButton).toContainText(format(monthStart, "MMM"));
      await expect(dateRangeButton).toContainText(format(monthEnd, "MMM d, yyyy"));
    });

    test("should filter reports by Previous quarter", async ({ page }) => {
      // Select dimensions and metrics
      await page.locator('#dimensions-select').click();
      await page.getByText( "Test Case", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Cases Count", { exact: true }).click();

      // Apply Previous quarter filter
      await selectDateRangePreset(page, "Previous quarter");

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify results - may show "No results found" for previous quarter if no data exists
      await expect(
        page.getByRole("table").or(page.getByText("No results found"))
      ).toBeVisible();

      // Verify the date range shows previous quarter
      const previousQuarter = subMonths(new Date(), 3);
      const quarterStart = startOfQuarter(previousQuarter);
      const quarterEnd = endOfQuarter(previousQuarter);
      
      // Wait for the date range button to update
      await page.waitForTimeout(1000);
      
      // Check if the date range is displayed in the button
      const dateRangeButton = page.locator('[data-testid="date-range-button"]');
      await expect(dateRangeButton).toContainText(format(quarterStart, "MMM"));
      await expect(dateRangeButton).toContainText(format(quarterEnd, "MMM d, yyyy"));
    });

    test("should filter reports by custom date range", async ({ page }) => {
      // Select dimensions and metrics
      await page.locator('#dimensions-select').click();
      await page.getByText( "Test Run", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Avg. Elapsed Time", { exact: true }).click();

      // Open date picker
      await page.locator('[data-testid="date-range-button"]').click();
      await page.waitForTimeout(500); // Wait for popover animation

      // Wait for the popover to be visible
      const popover = page.locator('[role="dialog"]');
      await expect(popover).toBeVisible();
      
      // The calendar should be visible when Custom is selected
      // Be specific about which combobox we're checking (the date range preset selector)
      await expect(popover.locator('[data-testid="date-range-preset-select"]')).toHaveText("Custom");

      // Select the first day of current month (should be visible in the calendar)
      const today = new Date();
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const firstDayText = firstDayOfMonth.getDate().toString();
      
      // Wait for calendar to be fully loaded
      await page.waitForSelector('[role="grid"]', { state: 'visible' });
      
      // Try clicking dates more robustly - look for buttons within grid cells
      const firstDayButton = page.locator('[role="gridcell"] button').filter({ hasText: new RegExp(`^${firstDayText}$`) }).first();
      await firstDayButton.waitFor({ state: 'visible', timeout: 5000 });
      await firstDayButton.click();
      
      // Small wait between date selections
      await page.waitForTimeout(200);
      
      // Click on today (should be the second date for range) 
      const todayText = today.getDate().toString();
      const todayButton = page.locator('[role="gridcell"] button').filter({ hasText: new RegExp(`^${todayText}$`) }).last();
      await todayButton.waitFor({ state: 'visible', timeout: 5000 });
      await todayButton.click();
      
      // The popover should close automatically after selecting both dates
      await page.waitForTimeout(500);

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify results are displayed
      await expect(page.getByRole("table")).toBeVisible();
    });

    test("should clear date filter", async ({ page }) => {
      // First apply dimensions and metrics
      await page.locator('#dimensions-select').click();
      await page.getByText("Test Run", { exact: true }).click();
      
      await page.locator('#metrics-select').click();
      await page.getByText("Test Results Count", { exact: true }).click();
      
      // Apply a date filter
      await selectDateRangePreset(page, "Last 7 days");
      
      // Verify filter is applied - the button should show the date range
      await page.waitForTimeout(1000);
      const dateRangeButton = page.locator('[data-testid="date-range-button"]');
      const today = new Date();
      const sevenDaysAgo = subDays(today, 6);
      await expect(dateRangeButton).toContainText(format(sevenDaysAgo, "MMM d"));
      await expect(dateRangeButton).toContainText(format(today, "MMM d, yyyy"));

      // Clear the filter by clicking the date button again and clicking Clear
      await dateRangeButton.click();
      await page.waitForTimeout(500); // Wait for popover to open
      await page.getByRole("button", { name: "Clear" }).click();

      // Verify filter is cleared
      await expect(
        page.locator('[data-testid="date-range-button"]').filter({ hasText: "Select date range" })
      ).toBeVisible();
    });

    test("should persist date filter when changing dimensions", async ({
      page,
    }) => {
      // Apply date filter
      await selectDateRangePreset(page, "Last 30 days");

      // Select initial dimension and metric
      await page.locator('#dimensions-select').click();
      await page.getByText( "User", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Results Count", { exact: true }).click();

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Change dimension - remove User and add Status
      // Click the remove button for User dimension
      await page.locator('.select__multi-value__remove').first().click();
      await page.waitForTimeout(500);
      
      // Add Status dimension
      await page.locator('#dimensions-select').click();
      await page.getByText("Status", { exact: true }).click();

      // Run report again
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify date filter is still applied
      const today = new Date();
      const thirtyDaysAgo = subDays(today, 29);
      
      // Check that the date range button contains the expected date range
      const dateRangeButton = page.locator('[data-testid="date-range-button"]');
      await expect(dateRangeButton).toContainText(format(thirtyDaysAgo, "MMM d"));
      await expect(dateRangeButton).toContainText(format(today, "MMM d, yyyy"));
    });

    test("should show different results for different date ranges", async ({
      page,
    }) => {
      // Select dimensions and metrics
      await page.locator('#dimensions-select').click();
      await page.getByText( "Status", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Results Count", { exact: true }).click();

      // Run report for Last 7 days
      await page.locator('[data-testid="date-range-button"]').click();
      await page.waitForTimeout(500); // Wait for popover animation
      
      // Wait for the popover to be visible
      const popover = page.locator('[role="dialog"]');
      await expect(popover).toBeVisible();
      
      // Click on the preset selector using data-testid
      // The select might be at the edge of the viewport, so use force: true
      const presetSelect = page.locator('[data-testid="date-range-preset-select"]');
      await presetSelect.click({ force: true });
      
      // Wait for the select dropdown to appear (it's rendered in a portal)
      await page.waitForTimeout(300);
      
      // Wait for and click the option
      const option2 = page.getByRole("option", { name: "Last 7 days" });
      await option2.waitFor({ state: 'visible', timeout: 5000 });
      await option2.click({ force: true });
      
      // The popover should close automatically after selection
      await page.waitForTimeout(500);
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Get count for Last 7 days
      const sevenDayRows = await page.getByRole("row").count();

      // Clear the current date filter
      await page.locator('[data-testid="date-range-button"]').click();
      await page.getByRole("button", { name: "Clear" }).click();

      await page.locator('[data-testid="date-range-button"]').click();
      await page.waitForTimeout(500); // Wait for popover animation
      
      // Wait for the popover content to be visible
      const popoverContent2 = page.locator('[role="dialog"]');
      await expect(popoverContent2).toBeVisible();
      
      // Click on the preset selector using data-testid
      // The select might be at the edge of the viewport, so use force: true
      const presetSelect2 = page.locator('[data-testid="date-range-preset-select"]');
      await presetSelect2.click({ force: true });
      
      // Wait for the select dropdown to appear (it's rendered in a portal)
      await page.waitForTimeout(300);
      
      // Wait for and click the option
      const option = page.getByRole("option", { name: "Last 30 days" });
      await option.waitFor({ state: 'visible', timeout: 5000 });
      await option.click({ force: true });
      
      // The popover should close automatically after selection
      await page.waitForTimeout(500);
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Get count for Last 30 days
      const thirtyDayRows = await page.getByRole("row").count();

      // Last 30 days should have more or equal data than Last 7 days
      expect(thirtyDayRows).toBeGreaterThanOrEqual(sevenDayRows);
    });
  });

  test.describe("Admin Reports", () => {
    test.beforeEach(async ({ page }) => {
      // Login as admin
      await loginAsAdmin(page);
      
      // Navigate to admin reports
      await page.goto("/en-US/admin/reports");
      await page.waitForLoadState("networkidle");
    });

    test("should filter admin reports by date range", async ({ page }) => {
      // Clear any pre-selected dimensions if they exist
      const removeButtons = page.locator('.select__multi-value__remove');
      const count = await removeButtons.count();
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          await removeButtons.first().click();
        }
      }
      
      // Select dimension and metric
      await page.locator('#dimensions-select').click();
      await page.getByText( "User", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Results Count", { exact: true }).click();

      // Apply date filter
      await selectDateRangePreset(page, "Last 7 days");

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify results
      await expect(page.getByRole("table")).toBeVisible();

      // Verify date filter is applied
      await page.waitForTimeout(1000);
      const dateRangeButton = page.locator('[data-testid="date-range-button"]');
      const today = new Date();
      const sevenDaysAgo = subDays(today, 6);
      await expect(dateRangeButton).toContainText(format(sevenDaysAgo, "MMM d"));
      await expect(dateRangeButton).toContainText(format(today, "MMM d, yyyy"));
    });

    test("should filter cross-project reports by date range", async ({
      page,
    }) => {
      // Clear any pre-selected dimensions
      const removeButtons = page.locator('.select__multi-value__remove');
      const count = await removeButtons.count();
      for (let i = 0; i < count; i++) {
        await removeButtons.first().click();
      }
      
      // Select Project dimension for cross-project report
      await page.locator('#dimensions-select').click();
      await page.getByText( "Project", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Results Count", { exact: true }).click();

      // Apply Previous month filter
      await selectDateRangePreset(page, "Previous month");

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify results
      await expect(page.getByRole("table")).toBeVisible();

      // Verify the correct date range is applied
      await page.waitForTimeout(1000);
      const dateRangeButton = page.locator('[data-testid="date-range-button"]');
      const previousMonth = subMonths(new Date(), 1);
      const monthStart = startOfMonth(previousMonth);
      const monthEnd = endOfMonth(previousMonth);
      await expect(dateRangeButton).toContainText(format(monthStart, "MMM"));
      await expect(dateRangeButton).toContainText(format(monthEnd, "MMM d, yyyy"));
    });
  });

  test.describe("Session Reports with Date Filtering", () => {
    test("should filter session metrics by date range", async ({ page }) => {
      // Login as admin
      await loginAsAdmin(page);
      
      // Navigate to project reports
      await page.goto("/en-US/projects/reports/331");
      await page.waitForLoadState("networkidle");

      // Change report type to Session Analysis
      await page.locator('[data-testid="report-type-select"]').click();
      await page.getByRole('option', { name: "Session Analysis" }).click();

      // Select session-related dimension and metric
      await page.locator('#dimensions-select').click();
      await page.getByText( "State", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Session Count", { exact: true }).click();

      // Apply Last 30 days filter
      await page.locator('[data-testid="date-range-button"]').click();
      await page.waitForTimeout(500); // Wait for popover animation
      
      // Wait for the popover content to be visible
      const popoverContent = page.locator('[role="dialog"]');
      await expect(popoverContent).toBeVisible();
      
      // Click on the preset selector using data-testid
      // The select might be at the edge of the viewport, so use force: true
      const presetSelect = page.locator('[data-testid="date-range-preset-select"]');
      await presetSelect.click({ force: true });
      
      // Wait for the select dropdown to appear (it's rendered in a portal)
      await page.waitForTimeout(300);
      
      // Wait for and click the option
      const option = page.getByRole("option", { name: "Last 30 days" });
      await option.waitFor({ state: 'visible', timeout: 5000 });
      await option.click({ force: true });
      
      // The popover should close automatically after selection
      await page.waitForTimeout(500);

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify results
      await expect(page.getByRole("table")).toBeVisible();

      // Session data should be filtered by createdAt date
      const tableRows = await page.getByRole("row").count();
      expect(tableRows).toBeGreaterThan(1);
    });
  });

  test.describe("Repository Case Reports with Date Filtering", () => {
    test("should filter repository case metrics by creation date", async ({
      page,
    }) => {
      // Login as admin
      await loginAsAdmin(page);
      
      // Navigate to project reports
      await page.goto("/en-US/projects/reports/331");
      await page.waitForLoadState("networkidle");

      // Change report type to Repository Statistics
      await page.locator('[data-testid="report-type-select"]').click();
      await page.getByRole('option', { name: "Repository Statistics" }).click();

      // Select repository case dimension and metric
      await page.locator('#dimensions-select').click();
      await page.getByText( "Template", { exact: true }).click();

      await page.locator('#metrics-select').click();
      await page.getByText( "Test Cases Count", { exact: true }).click();

      // Apply Previous quarter filter
      await selectDateRangePreset(page, "Previous quarter");

      // Run report
      await page.locator('[data-testid="run-report-button"]').click();
      await page.waitForLoadState("networkidle");

      // Verify results
      await expect(page.getByRole("table")).toBeVisible();

      // Verify the date range
      await page.waitForTimeout(1000);
      const dateRangeButton = page.locator('[data-testid="date-range-button"]');
      const previousQuarter = subMonths(new Date(), 3);
      const quarterStart = startOfQuarter(previousQuarter);
      const quarterEnd = endOfQuarter(previousQuarter);
      await expect(dateRangeButton).toContainText(format(quarterStart, "MMM"));
      await expect(dateRangeButton).toContainText(format(quarterEnd, "MMM d, yyyy"));
    });
  });
});
