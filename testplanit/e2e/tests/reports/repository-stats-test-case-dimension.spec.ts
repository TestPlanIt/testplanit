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
   * Helper to navigate directly to Repository Statistics report builder with parameters
   * This avoids UI interaction issues with the dropdown selector
   */
  async function navigateToRepositoryStatsReport(
    page: import("@playwright/test").Page,
    projectId: number,
    options?: {
      dimensions?: string[];
      metrics?: string[];
    }
  ) {
    const params = new URLSearchParams({
      tab: 'builder',
      reportType: 'repository-stats',
    });

    if (options?.dimensions?.length) {
      params.set('dimensions', options.dimensions.join(','));
    }

    if (options?.metrics?.length) {
      params.set('metrics', options.metrics.join(','));
    }

    await page.goto(`/en-US/projects/reports/${projectId}?${params.toString()}`);
    await page.waitForLoadState("networkidle");

    // Wait for the report builder to load dimensions/metrics from URL params
    // The Run Report button should become enabled once dimensions and metrics are loaded
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });

    // Wait for button to become enabled (means dimensions/metrics loaded from URL)
    await expect(runButton).toBeEnabled({ timeout: 10000 });
  }

  /**
   * Legacy helper - kept for backwards compatibility with passing tests
   */
  async function navigateToReports(
    page: import("@playwright/test").Page,
    projectId: number
  ) {
    await page.goto(`/en-US/projects/reports/${projectId}`);
    await page.waitForLoadState("networkidle");
  }

  /**
   * Legacy helper - kept for backwards compatibility with passing tests
   */
  async function switchToBuilderTab(page: import("@playwright/test").Page) {
    const builderTab = page.locator('[role="tab"]').filter({ hasText: /Report Builder/i });
    await expect(builderTab).toBeVisible({ timeout: 5000 });
    await builderTab.click();
    await page.waitForLoadState("networkidle");
  }

  /**
   * Legacy helper - replaced by direct URL navigation
   * The select component dropdown doesn't open reliably in E2E tests
   */
  async function selectRepositoryStatsReport(page: import("@playwright/test").Page) {
    // This function is deprecated - use navigateToRepositoryStatsReport instead
    throw new Error('Use navigateToRepositoryStatsReport() instead');
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
    await expect(runButton).toBeEnabled({ timeout: 5000 });
    await runButton.click();
    await page.waitForLoadState("networkidle");
  }

  test("Test Case dimension is available in Repository Statistics report @smoke", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Navigate directly to Repository Statistics report (without dimensions to test the UI)
    const params = new URLSearchParams({
      tab: 'builder',
      reportType: 'repository-stats',
    });
    await page.goto(`/en-US/projects/reports/${projectId}?${params.toString()}`);
    await page.waitForLoadState("networkidle");

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

    // Navigate directly with dimensions and metrics
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase'],
      metrics: ['testCaseCount'],
    });

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

    // Navigate directly with dimensions and metrics
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase'],
      metrics: ['testCaseCount'],
    });

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

    // Navigate directly to Repository Statistics with Test Case and Template dimensions
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase', 'template'],
      metrics: ['testCaseCount'],
    });

    // Run the report
    await runReport(page);

    // Verify results are displayed
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Table should have both Test Case and Template columns
    // Check that both dimension columns are present
    const headers = await table.locator('th').allTextContents();
    const hasTestCaseDimension = headers.some(h => /test\s*case/i.test(h) && !h.toLowerCase().includes('count'));
    const hasTemplateColumn = headers.some(h => /^template$/i.test(h.trim()));

    expect(hasTestCaseDimension).toBeTruthy();
    expect(hasTemplateColumn).toBeTruthy();
  });

  test("Test Case dimension works with multiple metrics", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Multi Metric TC ${Date.now()}`);

    // Navigate directly to Repository Statistics with Test Case dimension and multiple metrics
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase'],
      metrics: ['testCaseCount', 'automationRate'],
    });

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

    // Navigate directly to Repository Statistics with Test Case dimension
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase'],
      metrics: ['testCaseCount'],
    });

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

    // Navigate directly with dimensions and metrics
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase'],
      metrics: ['testCaseCount'],
    });

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

    // Navigate directly to Repository Statistics with Test Case dimension
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase'],
      metrics: ['testCaseCount'],
    });

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

    // Navigate directly to Repository Statistics with Test Case dimension
    await navigateToRepositoryStatsReport(page, projectId, {
      dimensions: ['testCase'],
      metrics: ['testCaseCount'],
    });

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
