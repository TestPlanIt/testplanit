import { test, expect } from "../../fixtures";

/**
 * Repository Statistics - Test Case Dimension E2E Tests
 *
 * Tests for the Test Case dimension in Repository Statistics reports.
 * This dimension allows grouping report data by individual test cases.
 */
test.describe("Repository Statistics - Test Case Dimension", () => {
  async function getTestProjectId(
    api: import("../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    return await api.createProject(`E2E Report Test Project ${Date.now()}`);
  }

  /**
   * Helper to navigate to project reports page
   */
  async function navigateToReports(
    page: import("@playwright/test").Page,
    projectId: number
  ) {
    await page.goto(`/en-US/projects/reports/${projectId}`);
    await page.waitForLoadState("networkidle");
  }

  /**
   * Helper to switch to the Builder tab
   */
  async function switchToBuilderTab(page: import("@playwright/test").Page) {
    const builderTab = page.locator('[role="tab"]').filter({ hasText: /Report Builder/i });
    await expect(builderTab).toBeVisible({ timeout: 5000 });
    await builderTab.click();
    await page.waitForLoadState("networkidle");
  }

  /**
   * Helper to select Repository Statistics report type
   */
  async function selectRepositoryStatsReport(page: import("@playwright/test").Page) {
    const reportTypeSelect = page.locator('[data-testid="report-type-select"]');
    await expect(reportTypeSelect).toBeVisible({ timeout: 5000 });
    await reportTypeSelect.click();

    const repositoryStatsOption = page.locator('[role="option"]').filter({
      hasText: /Repository Statistics/i,
    });
    await expect(repositoryStatsOption).toBeVisible({ timeout: 3000 });
    await repositoryStatsOption.click();
    await page.waitForLoadState("networkidle");
  }

  /**
   * Helper to open dimension selector and check for Test Case option
   */
  async function openDimensionSelector(page: import("@playwright/test").Page) {
    const dimensionsSelect = page.locator("#dimensions-select");
    await expect(dimensionsSelect).toBeVisible({ timeout: 5000 });
    await dimensionsSelect.click();
  }

  /**
   * Helper to select a dimension from the dropdown
   */
  async function selectDimension(
    page: import("@playwright/test").Page,
    dimensionName: string
  ) {
    await openDimensionSelector(page);

    const option = page.locator('[class*="option"]').filter({
      hasText: new RegExp(`^${dimensionName}$`, "i"),
    });
    await expect(option.first()).toBeVisible({ timeout: 3000 });
    await option.first().click();
  }

  /**
   * Helper to open metric selector
   */
  async function openMetricSelector(page: import("@playwright/test").Page) {
    const metricsSelect = page.locator("#metrics-select");
    await expect(metricsSelect).toBeVisible({ timeout: 5000 });
    await metricsSelect.click();
  }

  /**
   * Helper to select a metric from the dropdown
   */
  async function selectMetric(
    page: import("@playwright/test").Page,
    metricName: string
  ) {
    await openMetricSelector(page);

    const option = page.locator('[class*="option"]').filter({
      hasText: new RegExp(metricName, "i"),
    });
    await expect(option.first()).toBeVisible({ timeout: 3000 });
    await option.first().click();
  }

  /**
   * Helper to run the report
   */
  async function runReport(page: import("@playwright/test").Page) {
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await expect(runButton).toBeEnabled();
    await runButton.click();
    await page.waitForLoadState("networkidle");
  }

  test("Test Case dimension is available in Repository Statistics report @smoke", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Open dimension selector
    await openDimensionSelector(page);

    // Look for Test Case option
    const testCaseOption = page.locator('[class*="option"]').filter({
      hasText: /Test Case/i,
    });
    await expect(testCaseOption.first()).toBeVisible({ timeout: 5000 });
  });

  test("Can select Test Case dimension and run report", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases for the report
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Report Test Case 1 ${Date.now()}`);
    await api.createTestCase(projectId, rootFolderId, `Report Test Case 2 ${Date.now()}`);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Select a metric (Test Cases Count)
    await selectMetric(page, "Test Cases Count");

    // Run the report
    await runReport(page);

    // Verify results are displayed
    const resultsCard = page.locator('text=/Results/i');
    await expect(resultsCard.first()).toBeVisible({ timeout: 10000 });

    // The table should show the test cases
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test("Test Case dimension shows test case names in results", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases with unique names
    const rootFolderId = await api.getRootFolderId(projectId);
    const timestamp = Date.now();
    const testCaseName1 = `Unique TC Alpha ${timestamp}`;
    const testCaseName2 = `Unique TC Beta ${timestamp}`;
    await api.createTestCase(projectId, rootFolderId, testCaseName1);
    await api.createTestCase(projectId, rootFolderId, testCaseName2);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Select Test Cases Count metric
    await selectMetric(page, "Test Cases Count");

    // Run the report
    await runReport(page);

    // Wait for the table to be visible
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // The table should contain the test case names
    await expect(page.locator(`text=${testCaseName1}`).first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(`text=${testCaseName2}`).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("Test Case dimension can be combined with other dimensions", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Combined TC ${Date.now()}`);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Also select Template dimension
    await selectDimension(page, "Template");

    // Select a metric
    await selectMetric(page, "Test Cases Count");

    // Run the report
    await runReport(page);

    // Verify results are displayed
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Table should have both Test Case and Template columns
    await expect(table.locator('th:has-text("Test Case")')).toBeVisible({
      timeout: 5000,
    });
    await expect(table.locator('th:has-text("Template")')).toBeVisible({
      timeout: 5000,
    });
  });

  test("Test Case dimension works with multiple metrics", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Multi Metric TC ${Date.now()}`);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Select multiple metrics
    await selectMetric(page, "Test Cases Count");
    await selectMetric(page, "Automation Rate");

    // Run the report
    await runReport(page);

    // Verify results table has columns for both metrics
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Check that metric columns are present
    await expect(
      table.locator('th:has-text("Test Cases Count"), th:has-text("Test Cases")')
    ).toBeVisible({ timeout: 5000 });
  });

  test("Test Case dimension report shows visualization", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Chart TC 1 ${Date.now()}`);
    await api.createTestCase(projectId, rootFolderId, `Chart TC 2 ${Date.now()}`);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Select a metric
    await selectMetric(page, "Test Cases Count");

    // Run the report
    await runReport(page);

    // Verify visualization section is displayed
    const visualizationCard = page.locator('text=/Visualization/i');
    await expect(visualizationCard.first()).toBeVisible({ timeout: 10000 });
  });

  test("Test Case dimension respects date range filter", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Date Filter TC ${Date.now()}`);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Select a metric
    await selectMetric(page, "Test Cases Count");

    // Click on date range picker to select a range
    const dateRangeButton = page.locator('button:has-text("Select date range")');
    if (await dateRangeButton.isVisible()) {
      await dateRangeButton.click();

      // Select "Last 30 days" preset if available
      const last30Days = page.locator('button:has-text("Last 30 days")');
      if (await last30Days.isVisible({ timeout: 2000 }).catch(() => false)) {
        await last30Days.click();
      } else {
        // Close the date picker
        await page.keyboard.press("Escape");
      }
    }

    // Run the report
    await runReport(page);

    // Verify results are displayed (test cases created within the date range)
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test("Empty project shows no data message with Test Case dimension", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    // Don't create any test cases

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Select a metric
    await selectMetric(page, "Test Cases Count");

    // Run the report
    await runReport(page);

    // Should show no results message
    const noResultsMessage = page.locator(
      'text=/No results found|No data|No test cases/i'
    );
    await expect(noResultsMessage.first()).toBeVisible({ timeout: 10000 });
  });

  test("Test Case dimension URL parameters persist on reload", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `URL Persist TC ${Date.now()}`);

    await navigateToReports(page, projectId);
    await switchToBuilderTab(page);
    await selectRepositoryStatsReport(page);

    // Select Test Case dimension
    await selectDimension(page, "Test Case");

    // Select a metric
    await selectMetric(page, "Test Cases Count");

    // Run the report
    await runReport(page);

    // Wait for results to load
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Verify URL contains dimensions parameter
    await expect(page).toHaveURL(/dimensions=testCase/);

    // Reload the page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // The report should auto-run with persisted parameters
    await expect(table).toBeVisible({ timeout: 10000 });
  });
});
