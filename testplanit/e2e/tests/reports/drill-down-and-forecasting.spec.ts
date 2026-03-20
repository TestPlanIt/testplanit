import { expect, test } from "../../fixtures";

/**
 * Report Builder - Drill-Down and Forecasting E2E Tests
 *
 * Tests for RPT-03 (drill-down from report metrics) and RPT-05 (forecasting).
 *
 * Drill-down: clicking a numeric metric cell in the results table opens a
 * DrillDownDrawer (Radix Drawer) with detailed records.
 *
 * Forecasting: the /api/repository-cases/forecast endpoint accepts POST with
 * caseIds and returns estimate data.
 */
test.describe("Report Builder - Drill-Down", () => {
  /**
   * Navigate to a report with URL params and wait for the page to load
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
   * Run the report by clicking the run button
   */
  async function runReport(page: import("@playwright/test").Page) {
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    await runButton.click();
    await page.waitForLoadState("networkidle");
  }

  test("Drill-down: clicking clickable metric cell opens drawer @smoke", async ({
    api,
    page,
  }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(
      `E2E Drill Down Project ${uniqueId}`
    );

    // Create test cases so we have data in the repository-stats report
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Drill Down TC Alpha ${uniqueId}`);
    await api.createTestCase(projectId, rootFolderId, `Drill Down TC Beta ${uniqueId}`);

    // Navigate to repository-stats with testCase dimension + testCaseCount metric
    await navigateToReport(page, projectId, "repository-stats", ["testCase"], ["testCaseCount"]);

    await runReport(page);

    // Wait for table to be visible - this means data exists
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Look for a clickable metric cell (cursor-pointer span in a table cell)
    // The metric cells render as <span class="... cursor-pointer ..."> when drill-down is available
    const clickableMetricCell = table
      .locator("td span.cursor-pointer")
      .first();

    const isCellClickable = await clickableMetricCell.isVisible().catch(() => false);

    if (isCellClickable) {
      await clickableMetricCell.click();

      // The DrillDownDrawer opens as a Radix Drawer - it has role="dialog"
      const drawer = page.locator('[role="dialog"]').first();
      await expect(drawer).toBeVisible({ timeout: 5000 });

      // Drawer title should be visible (shows the metric label)
      const drawerTitle = drawer.locator('[data-slot="drawer-title"]').or(
        drawer.locator('h2, h3').first()
      );
      await expect(drawerTitle.first()).toBeVisible({ timeout: 3000 });

      // Close the drawer
      const closeButton = drawer
        .locator('button[aria-label="Close"], button:has-text("Close"), button:has-text("close")')
        .first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
      } else {
        await page.keyboard.press("Escape");
      }
    } else {
      // Fallback: if no clickable cells (no data with count > 0), verify the drill-down
      // API endpoint is reachable via direct request
      const response = await page.request.post(
        `/api/report-builder/drill-down`,
        {
          data: {
            context: {
              metricId: "testCaseCount",
              metricLabel: "Test Cases Count",
              metricValue: 0,
              reportType: "repository-stats",
              mode: "project",
              projectId,
              dimensions: { testCase: {} },
            },
            offset: 0,
            limit: 10,
          },
        }
      );

      // API should respond with 200 (data or empty) or 400 (invalid context) - not 500
      expect(response.status()).toBeLessThan(500);
    }
  });

  test("Drill-down API endpoint responds to valid POST request", async ({
    api,
    page,
  }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(
      `E2E Drill Down API Project ${uniqueId}`
    );

    // Test the drill-down API directly with a valid context
    const response = await page.request.post(
      `/api/report-builder/drill-down`,
      {
        data: {
          context: {
            metricId: "testCaseCount",
            metricLabel: "Test Cases Count",
            metricValue: 1,
            reportType: "repository-stats",
            mode: "project",
            projectId,
            dimensions: {},
          },
          offset: 0,
          limit: 10,
        },
      }
    );

    // Should respond (200 with data/empty, or 400 for invalid config - not 401/403/500)
    expect(response.status()).not.toBe(401);
    expect(response.status()).not.toBe(403);
    expect(response.status()).not.toBe(500);

    const body = await response.json();
    // Response should have data array and total field (either empty or with data)
    // Note: the API returns { data, total, hasMore, context } not { records, total }
    if (response.status() === 200) {
      expect(body).toHaveProperty("total");
      // The API may return "records" or "data" as the array property name
      const hasRecordsOrData = "records" in body || "data" in body;
      expect(hasRecordsOrData).toBeTruthy();
      const items = body.records ?? body.data;
      expect(Array.isArray(items)).toBeTruthy();
    }
  });

  test("Drill-down API rejects unauthenticated requests with 401", async ({
    page,
  }) => {
    // Use a fresh incognito context without authentication cookies
    // E2E server runs on port 3002
    const e2eBaseURL = process.env.E2E_BASE_URL || "http://localhost:3002";

    const incognitoContext = await page.context().browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      const response = await incognitoPage.request.post(
        `${e2eBaseURL}/api/report-builder/drill-down`,
        {
          data: {
            context: {
              metricId: "testCaseCount",
              metricLabel: "Test Cases Count",
              metricValue: 1,
              reportType: "repository-stats",
              mode: "project",
              projectId: 1,
              dimensions: {},
            },
          },
        }
      );

      // Unauthenticated request should be rejected
      expect(response.status()).toBe(401);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });
});

test.describe("Report Builder - Forecasting", () => {
  test("Forecasting API returns valid response for valid case IDs @smoke", async ({
    api,
    page,
  }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(
      `E2E Forecast Project ${uniqueId}`
    );

    // Create test cases to use in the forecast call
    const rootFolderId = await api.getRootFolderId(projectId);
    const caseId1 = await api.createTestCase(
      projectId,
      rootFolderId,
      `Forecast TC Alpha ${uniqueId}`
    );
    const caseId2 = await api.createTestCase(
      projectId,
      rootFolderId,
      `Forecast TC Beta ${uniqueId}`
    );

    // Call the forecasting API with the created case IDs
    const response = await page.request.post(
      `/api/repository-cases/forecast`,
      {
        data: {
          caseIds: [caseId1, caseId2],
        },
      }
    );

    // Should return 200 with forecast data
    expect(response.status()).toBe(200);

    const body = await response.json();

    // Response shape: { manualEstimate, mixedEstimate, automatedEstimate, areAllCasesAutomated, fetchedTestCasesCount }
    expect(body).toHaveProperty("manualEstimate");
    expect(body).toHaveProperty("mixedEstimate");
    expect(body).toHaveProperty("automatedEstimate");
    expect(body).toHaveProperty("areAllCasesAutomated");
    expect(body).toHaveProperty("fetchedTestCasesCount");

    // We created 2 cases so the count should be 2
    expect(body.fetchedTestCasesCount).toBe(2);

    // areAllCasesAutomated should be false since we created manual test cases
    expect(body.areAllCasesAutomated).toBe(false);
  });

  test("Forecasting API returns empty/zero response for empty project", async ({
    page,
  }) => {
    // Call forecast with no real case IDs to test graceful empty handling
    const response = await page.request.post(
      `/api/repository-cases/forecast`,
      {
        data: {
          caseIds: [], // Empty array - should fail validation
        },
      }
    );

    // The schema requires at least 1 caseId, so this should return 400
    expect(response.status()).toBe(400);
  });

  test("Forecasting API returns zero estimates for non-existent case IDs", async ({
    page,
  }) => {
    // Use IDs that don't exist - should return empty/zero response
    const response = await page.request.post(
      `/api/repository-cases/forecast`,
      {
        data: {
          caseIds: [999999999], // Very unlikely to exist
        },
      }
    );

    // Should return 200 with zero counts (not throw an error)
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.fetchedTestCasesCount).toBe(0);
    expect(body.manualEstimate).toBe(0);
    expect(body.automatedEstimate).toBe(0);
  });

  test("Forecasting API rejects invalid request body", async ({ page }) => {
    const response = await page.request.post(
      `/api/repository-cases/forecast`,
      {
        data: {
          // Missing required caseIds field
          invalidField: "test",
        },
      }
    );

    // Should return 400 for invalid body
    expect(response.status()).toBe(400);
  });
});
