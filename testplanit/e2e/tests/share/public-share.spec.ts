import { test, expect } from "../../fixtures";

/**
 * Public Share Flow E2E Tests
 *
 * Tests the complete flow for creating and accessing public share links.
 * Public shares allow anyone with the link to view content without authentication.
 */
test.describe("Public Share Flow", () => {
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

    // Wait for Run Report button to become enabled
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

    // Wait for results to be visible
    const resultsCard = page.locator('text=/Results/i');
    await expect(resultsCard.first()).toBeVisible({ timeout: 10000 });
  }

  test("Create and access a public share link @smoke", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Public Share Test ${timestamp}`);

    // Create test cases for the report
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case 1 ${timestamp}`);
    await api.createTestCase(projectId, rootFolderId, `Test Case 2 ${timestamp}`);

    // Navigate to report builder
    await navigateToRepositoryStatsReport(page, projectId);

    // Run the report
    await runReport(page);

    // Click the Share button
    const shareButton = page.getByTestId("share-report-button");
    await expect(shareButton).toBeVisible({ timeout: 5000 });
    await shareButton.click();

    // Wait for share dialog to open
    const shareDialog = page.locator('[role="dialog"]');
    await expect(shareDialog).toBeVisible({ timeout: 5000 });

    // Select PUBLIC mode
    const publicModeRadio = page.getByTestId("share-mode-public");
    await expect(publicModeRadio).toBeVisible({ timeout: 5000 });
    await publicModeRadio.click();

    // Add a custom title
    const titleInput = page.getByTestId("share-title-input");
    await titleInput.fill(`Public Test Report ${timestamp}`);

    // Create the share link
    const createButton = page.getByTestId("share-create-button");
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    // Wait for share creation success screen
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });

    // Get the share URL
    const shareUrl = await shareUrlInput.inputValue();
    console.log(`[TEST] Share URL created: ${shareUrl}`);
    expect(shareUrl).toContain("/share/");

    // Extract share key from URL and track for cleanup
    const shareKey = shareUrl.split("/share/")[1];
    console.log(`[TEST] Share key: ${shareKey}`);
    expect(shareKey).toBeTruthy();

    // Get share link ID for cleanup
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    console.log(`[TEST] Share link data:`, shareLinkData);
    expect(shareLinkData).toBeTruthy();
    expect(shareLinkData?.mode).toBe("PUBLIC");
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }

    // Close the share dialog
    await page.keyboard.press("Escape");

    // Open share link in a new incognito context (unauthenticated user)
    const incognitoContext = await context.browser()!.newContext();
    const incognitoPage = await incognitoContext.newPage();

    try {
      // Navigate to the share URL
      console.log(`[TEST] Navigating to share URL: ${shareUrl}`);
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Log current URL for debugging
      const currentUrl = incognitoPage.url();
      console.log(`[TEST] Current URL after navigation: ${currentUrl}`);

      // Take a screenshot for debugging
      await incognitoPage.screenshot({ path: `/tmp/share-test-${timestamp}.png` });

      // Verify the shared report viewer is displayed
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });

      // Verify the report title is displayed
      const reportTitle = incognitoPage.getByTestId("shared-report-title");
      await expect(reportTitle).toBeVisible({ timeout: 5000 });
      await expect(reportTitle).toContainText(`Public Test Report ${timestamp}`);

      // Verify the report content is displayed (table should be visible)
      const reportTable = incognitoPage.locator("table").first();
      await expect(reportTable).toBeVisible({ timeout: 10000 });

      // Verify test cases are in the report
      await expect(incognitoPage.locator(`text=Test Case 1 ${timestamp}`).first()).toBeVisible({
        timeout: 5000,
      });
      await expect(incognitoPage.locator(`text=Test Case 2 ${timestamp}`).first()).toBeVisible({
        timeout: 5000,
      });

      // Verify no authentication UI elements are present
      // (No nav bar, no project menu, etc.)
      const navBar = incognitoPage.locator('nav[role="navigation"]');
      await expect(navBar).not.toBeVisible();
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Public share link increments view count", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`View Count Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a public share
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const publicModeRadio = page.getByTestId("share-mode-public");
    await publicModeRadio.click();

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Get the share URL
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });
    const shareUrl = await shareUrlInput.inputValue();
    const shareKey = shareUrl.split("/share/")[1];

    // Get initial share link data
    let shareLinkData = await api.getShareLinkByKey(shareKey);
    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
      expect(shareLinkData.viewCount).toBe(0);
    }

    // Close dialog
    await page.keyboard.press("Escape");

    // Access the share link in incognito mode
    const incognitoContext = await context.browser()!.newContext();
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Wait for report to load
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });

      // Wait a moment for the view count API call to complete
      await incognitoPage.waitForTimeout(2000);

      // Check updated view count
      shareLinkData = await api.getShareLinkByKey(shareKey);
      expect(shareLinkData).toBeTruthy();
      if (shareLinkData) {
        expect(shareLinkData.viewCount).toBe(1);
      }
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Public share link works without authentication", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`No Auth Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a public share
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const publicModeRadio = page.getByTestId("share-mode-public");
    await publicModeRadio.click();

    const titleInput = page.getByTestId("share-title-input");
    await titleInput.fill(`No Auth Report ${timestamp}`);

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

    // Close dialog
    await page.keyboard.press("Escape");

    // Create a completely new browser context (no cookies, no session)
    const freshContext = await context.browser()!.newContext({
      storageState: undefined, // No stored auth
    });
    const freshPage = await freshContext.newPage();

    try {
      // Navigate directly to share URL
      await freshPage.goto(shareUrl);
      await freshPage.waitForLoadState("networkidle");

      // Should see the report immediately without any auth redirect
      const sharedReportViewer = freshPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });

      // Verify the report title
      const reportTitle = freshPage.getByTestId("shared-report-title");
      await expect(reportTitle).toContainText(`No Auth Report ${timestamp}`);

      // Should NOT be redirected to login
      await expect(freshPage).not.toHaveURL(/sign-in/);
      await expect(freshPage).toHaveURL(new RegExp(shareUrl));
    } finally {
      await freshPage.close();
      await freshContext.close();
    }
  });

  test("Copy share URL to clipboard", async ({
    api,
    page,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Copy URL Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a public share
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const publicModeRadio = page.getByTestId("share-mode-public");
    await publicModeRadio.click();

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Wait for share creation success screen
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });
    const shareUrl = await shareUrlInput.inputValue();

    // Track for cleanup
    const shareKey = shareUrl.split("/share/")[1];
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }

    // Click the copy button
    const copyButton = page.getByTestId("share-copy-button");
    await expect(copyButton).toBeVisible({ timeout: 5000 });
    await copyButton.click();

    // Verify the button text changes to indicate success
    await expect(copyButton).toContainText(/copied/i, { timeout: 3000 });

    // Note: Actually verifying clipboard content is not reliable in headless browsers
    // The important thing is that the copy action completes without error
  });

  test("Public share with expiration date", async ({
    api,
    page,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Expiration Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a public share with expiration
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const publicModeRadio = page.getByTestId("share-mode-public");
    await publicModeRadio.click();

    const titleInput = page.getByTestId("share-title-input");
    await titleInput.fill(`Expiring Share ${timestamp}`);

    // Set expiration date (next month)
    const expirationButton = page.locator('button:has-text("No expiration")');
    if (await expirationButton.isVisible({ timeout: 3000 })) {
      await expirationButton.click();

      // Click next month button in calendar
      const nextMonthButton = page.locator('button[name="next-month"]');
      await nextMonthButton.click();

      // Click on day 15 of next month
      const day15 = page.locator('button[name="day"]:has-text("15")').first();
      await day15.click();
    }

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Verify share was created
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });

    // Track for cleanup
    const shareUrl = await shareUrlInput.inputValue();
    const shareKey = shareUrl.split("/share/")[1];
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }

    // Verify expiration warning is shown
    const expirationWarning = page.locator('text=/expires/i');
    await expect(expirationWarning.first()).toBeVisible({ timeout: 5000 });
  });
});
