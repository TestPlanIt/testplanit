import { expect, test } from "../../fixtures";

/**
 * Report Builder - Multiple Report Types E2E Tests
 *
 * Tests for RPT-01 (report builder with configurable dimensions/metrics) and
 * RPT-02 (pre-built reports with fixed configurations).
 */
test.describe("Report Builder - Multiple Report Types", () => {
  /**
   * Helper to create a project with test data for report testing
   */
  async function createProjectWithTestData(
    api: import("../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(`E2E Report Types Project ${uniqueId}`);

    // Create test cases to have data for the repository-stats based reports
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Report TC Alpha ${uniqueId}`);
    await api.createTestCase(projectId, rootFolderId, `Report TC Beta ${uniqueId}`);

    return projectId;
  }

  /**
   * Helper to navigate to a report builder with URL params
   */
  async function navigateToReport(
    page: import("@playwright/test").Page,
    projectId: number,
    reportType: string,
    dimensions?: string[],
    metrics?: string[]
  ) {
    const params = new URLSearchParams({
      tab: "builder",
      reportType,
    });

    if (dimensions?.length) {
      params.set("dimensions", dimensions.join(","));
    }

    if (metrics?.length) {
      params.set("metrics", metrics.join(","));
    }

    await page.goto(`/en-US/projects/reports/${projectId}?${params.toString()}`);
    await page.waitForLoadState("networkidle");
  }

  /**
   * Helper to wait for the run report button to be ready and click it
   */
  async function runReport(page: import("@playwright/test").Page) {
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    await runButton.click();
    await page.waitForLoadState("networkidle");
  }

  /**
   * Helper to assert that a report produced results or a graceful no-data message
   */
  async function assertReportResultsOrNoData(page: import("@playwright/test").Page) {
    // Accept either a results table, a visualization, or a no-results message
    const hasTable = await page.locator("table").first().isVisible().catch(() => false);
    const hasNoResults = await page
      .locator('text=/No results found|No data|no data|0 results/i')
      .first()
      .isVisible()
      .catch(() => false);
    const hasVisualization = await page
      .locator('text=/Visualization|Chart|visualization/i')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasTable || hasNoResults || hasVisualization).toBeTruthy();
  }

  test("Report builder loads for automation-trends report type @smoke", async ({
    api,
    page,
  }) => {
    const projectId = await createProjectWithTestData(api);

    // automation-trends is a pre-built report (isPreBuilt: true) - no dimensions/metrics needed
    await navigateToReport(page, projectId, "automation-trends");

    // The run report button should be available (pre-built reports don't require dimension selection)
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 10000 });

    // Run the report
    await runButton.click();
    await page.waitForLoadState("networkidle");

    // Assert results or no-data message
    await assertReportResultsOrNoData(page);
  });

  test("Report builder with test-execution report type shows results or no-data", async ({
    api,
    page,
  }) => {
    const projectId = await createProjectWithTestData(api);

    // test-execution with status dimension and testCaseCount metric
    await navigateToReport(page, projectId, "test-execution", ["status"], ["testCaseCount"]);

    // Wait for run button to be enabled (dimensions/metrics loaded from URL)
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await expect(runButton).toBeEnabled({ timeout: 10000 });

    await runReport(page);

    // Should show results table or no-data message
    await assertReportResultsOrNoData(page);
  });

  test("Report builder with flaky-tests report type loads", async ({
    api,
    page,
  }) => {
    const projectId = await createProjectWithTestData(api);

    // flaky-tests is pre-built (isPreBuilt: true) - no dimensions/metrics needed
    await navigateToReport(page, projectId, "flaky-tests");

    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 10000 });

    await runButton.click();
    await page.waitForLoadState("networkidle");

    // Accept results table, visualization (bubble chart), or no-data message
    await assertReportResultsOrNoData(page);
  });

  test("Report builder with test-case-health report type loads", async ({
    api,
    page,
  }) => {
    const projectId = await createProjectWithTestData(api);

    // test-case-health is pre-built (isPreBuilt: true)
    await navigateToReport(page, projectId, "test-case-health");

    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 10000 });

    await runButton.click();
    await page.waitForLoadState("networkidle");

    await assertReportResultsOrNoData(page);
  });

  test("Report builder with repository-stats and folder dimension shows results", async ({
    api,
    page,
  }) => {
    const projectId = await createProjectWithTestData(api);

    // Use repository-stats (not pre-built) with folder dimension + testCaseCount metric
    await navigateToReport(page, projectId, "repository-stats", ["folder"], ["testCaseCount"]);

    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await expect(runButton).toBeEnabled({ timeout: 10000 });

    await runReport(page);

    // Should show results table (project has folders with test cases)
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test("Pre-built report type selector is available on reports page", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E PreBuilt Report Project ${Date.now()}`
    );

    // Navigate to the reports page (no specific report type)
    await page.goto(`/en-US/projects/reports/${projectId}`);
    await page.waitForLoadState("networkidle");

    // The report type selector should be visible
    const reportTypeSelect = page.locator('[data-testid="report-type-select"]');
    await expect(reportTypeSelect.first()).toBeVisible({ timeout: 10000 });
  });

  test("Report builder URL params persist dimensions and metrics on reload", async ({
    api,
    page,
  }) => {
    const projectId = await createProjectWithTestData(api);

    // Navigate with URL params
    await navigateToReport(page, projectId, "repository-stats", ["testCase"], ["testCaseCount"]);

    // Run the report
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    await runReport(page);

    // Verify URL contains the dimension param
    await expect(page).toHaveURL(/dimensions=testCase/);

    // Reload - params should persist and report should re-run
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Report should auto-run with persisted params
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
  });
});
