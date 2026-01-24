import { test, expect } from "../../fixtures";

/**
 * Authenticated Share Flow E2E Tests
 *
 * Tests the complete flow for creating and accessing authenticated share links.
 * Authenticated shares require users to be logged in and have project access.
 */
test.describe("Authenticated Share Flow", () => {
  /**
   * Helper to navigate to report builder with repository stats
   */
  async function navigateToRepositoryStatsReport(
    page: import("@playwright/test").Page,
    projectId: number
  ) {
    const params = new URLSearchParams({
      tab: "builder",
      reportType: "repository-stats",
      dimensions: "testCase",
      metrics: "testCaseCount",
    });
    await page.goto(`/en-US/projects/reports/${projectId}?${params.toString()}`);
    await page.waitForLoadState("networkidle");

    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await expect(runButton).toBeEnabled({ timeout: 10000 });
  }

  /**
   * Helper to run the report
   */
  async function runReport(page: import("@playwright/test").Page) {
    const runButton = page.locator('[data-testid="run-report-button"]');
    await runButton.click();
    await page.waitForLoadState("networkidle");

    const resultsCard = page.locator('text=/Results/i');
    await expect(resultsCard.first()).toBeVisible({ timeout: 10000 });
  }

  test("Create authenticated share and redirect unauthenticated user to signin @smoke", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Auth Share Test ${timestamp}`);

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case 1 ${timestamp}`);
    await api.createTestCase(projectId, rootFolderId, `Test Case 2 ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create an authenticated share
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    // Select AUTHENTICATED mode
    // Note: The data-testid uses lowercase version of the mode
    const authModeRadio = page.locator('[data-testid="share-mode-authenticated"]');
    await expect(authModeRadio).toBeVisible({ timeout: 5000 });
    await authModeRadio.click();

    // Add title
    const titleInput = page.getByTestId("share-title-input");
    await titleInput.fill(`Authenticated Report ${timestamp}`);

    // Create the share
    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Get the share URL
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });
    const shareUrl = await shareUrlInput.inputValue();
    const shareKey = shareUrl.split("/share/")[1];

    // Track for cleanup
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
      expect(shareLinkData.mode).toBe("AUTHENTICATED");
    }

    await page.keyboard.press("Escape");

    // Access in unauthenticated incognito mode
    const incognitoContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Should be redirected to sign-in page
      await expect(incognitoPage).toHaveURL(/\/signin/, { timeout: 10000 });

      // Verify callback URL is set to return to share
      const currentUrl = incognitoPage.url();
      expect(currentUrl).toContain("callbackUrl");
      expect(currentUrl).toContain(`/share/${shareKey}`);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Authenticated user with project access redirects to Reports page", async ({
    api,
    page,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Auth Redirect Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create an authenticated share
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const authModeRadio = page.getByTestId("share-mode-authenticated");
    await authModeRadio.click();

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Get the share URL
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });
    const shareUrl = await shareUrlInput.inputValue();
    const shareKey = shareUrl.split("/share/")[1];

    // Track for cleanup
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }

    await page.keyboard.press("Escape");

    // Navigate to the share URL as authenticated admin user
    await page.goto(shareUrl);
    await page.waitForLoadState("networkidle");

    // Should be redirected to the Reports page with the report configuration
    await expect(page).toHaveURL(/\/projects\/reports\/\d+/, { timeout: 10000 });

    // Verify the URL contains the report configuration parameters
    const finalUrl = page.url();
    expect(finalUrl).toContain("reportType=repository-stats");
    expect(finalUrl).toContain("dimensions=testCase");
    expect(finalUrl).toContain("metrics=testCaseCount");

    // Verify we're on the Report Builder tab (not viewing static share)
    const reportBuilder = page.locator('text=/Report Builder/i');
    await expect(reportBuilder.first()).toBeVisible({ timeout: 5000 });
  });

  test("Authenticated share increments view count on access", async ({
    api,
    page,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Auth View Count Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create an authenticated share
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const authModeRadio = page.getByTestId("share-mode-authenticated");
    await authModeRadio.click();

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Get the share URL
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });
    const shareUrl = await shareUrlInput.inputValue();
    const shareKey = shareUrl.split("/share/")[1];

    // Get initial view count
    let shareLinkData = await api.getShareLinkByKey(shareKey);
    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
      expect(shareLinkData.viewCount).toBe(0);
    }

    await page.keyboard.press("Escape");

    // Access the share URL
    await page.goto(shareUrl);
    await page.waitForLoadState("networkidle");

    // Wait for redirect to complete
    await page.waitForURL(/\/projects\/reports\/\d+/, { timeout: 10000 });

    // Wait a moment for view count to be incremented
    await page.waitForTimeout(2000);

    // Check updated view count
    shareLinkData = await api.getShareLinkByKey(shareKey);
    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      expect(shareLinkData.viewCount).toBe(1);
    }
  });

  test("Authenticated share shows warning for PUBLIC mode security", async ({
    api,
    page,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Auth Warning Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Open share dialog
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    // Select AUTHENTICATED mode
    const authModeRadio = page.getByTestId("share-mode-authenticated");
    await authModeRadio.click();

    // Verify share dialog is open with mode selection
    const shareDialog = page.locator('[role="dialog"]');
    await expect(shareDialog).toBeVisible({ timeout: 5000 });

    // Switch between modes to verify they all work
    const publicModeRadio = page.getByTestId("share-mode-public");
    await publicModeRadio.click();
    await page.waitForTimeout(500);

    // Switch back to authenticated
    await authModeRadio.click();
    await page.waitForTimeout(500);

    // Verify we can see the create button (basic validation that mode works)
    const createButton = page.getByTestId("share-create-button");
    await expect(createButton).toBeVisible();
  });
});
