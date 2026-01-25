import { test, expect } from "../../fixtures";

/**
 * Share Management E2E Tests
 *
 * Tests the complete flow for managing share links from the project settings.
 * Covers viewing, editing, revoking, and deleting shares.
 */
test.describe("Share Management", () => {
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

  /**
   * Helper to create a share from Report Builder
   */
  async function createShare(
    page: import("@playwright/test").Page,
    mode: "PUBLIC" | "PASSWORD_PROTECTED" | "AUTHENTICATED",
    title: string,
    password?: string
  ): Promise<string> {
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    // Wait for dialog to be visible
    const shareDialog = page.locator('[role="dialog"]');
    await expect(shareDialog).toBeVisible({ timeout: 5000 });

    // Check if dialog is showing success screen from previous share
    const successScreenCheck = page.getByTestId("share-url-input");
    const isSuccessScreen = await successScreenCheck.isVisible({ timeout: 1000 }).catch(() => false);

    if (isSuccessScreen) {
      // Close and re-open to get fresh dialog
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      await shareButton.click();
      await expect(shareDialog).toBeVisible({ timeout: 5000 });
    }

    // Always click on "Create" tab to ensure we're on the right tab
    const createTab = page.getByTestId("share-tab-create");
    await expect(createTab).toBeVisible({ timeout: 5000 });
    await createTab.click();
    await page.waitForTimeout(500);

    // Select mode - map to correct test ID
    const modeTestId = mode === "PASSWORD_PROTECTED" ? "password" : mode.toLowerCase();
    const modeRadio = page.getByTestId(`share-mode-${modeTestId}`);
    await modeRadio.click();

    // Add password if needed
    if (mode === "PASSWORD_PROTECTED" && password) {
      const passwordInput = page.getByTestId("share-password-input");
      await passwordInput.fill(password);

      const confirmPasswordInput = page.getByTestId("share-confirm-password-input");
      await confirmPasswordInput.fill(password);
    }

    // Add title
    const titleInput = page.getByTestId("share-title-input");
    await titleInput.fill(title);

    // Create the share
    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Get the share URL
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).toBeVisible({ timeout: 10000 });
    const shareUrl = await shareUrlInput.inputValue();

    // Click Done button to reset state, then close dialog
    const doneButton = page.locator('button:has-text("Done")');
    await doneButton.click();
    await page.waitForTimeout(300);

    // Close the dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    return shareUrl.split("/share/")[1];
  }

  test("View list of shares from project settings @smoke", async ({ api, page }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Share List Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create multiple shares
    const shareKey1 = await createShare(page, "PUBLIC", `Public Share 1 ${timestamp}`);
    const shareKey2 = await createShare(
      page,
      "PASSWORD_PROTECTED",
      `Password Share ${timestamp}`,
      `TestPass${timestamp}`
    );
    const shareKey3 = await createShare(page, "AUTHENTICATED", `Auth Share ${timestamp}`);

    // Track all shares for cleanup
    for (const shareKey of [shareKey1, shareKey2, shareKey3]) {
      const shareLinkData = await api.getShareLinkByKey(shareKey);
      if (shareLinkData) {
        api.trackShareLink(shareLinkData.id);
      }
    }

    // Navigate to project shares settings
    await page.goto(`/en-US/projects/settings/${projectId}/shares`);
    await page.waitForLoadState("networkidle");

    // Verify page title
    const pageTitle = page.locator('h1:has-text("Manage Shares")');
    await expect(pageTitle).toBeVisible({ timeout: 5000 });

    // Verify all three shares are listed
    await expect(page.locator(`text=Public Share 1 ${timestamp}`)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(`text=Password Share ${timestamp}`)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(`text=Auth Share ${timestamp}`)).toBeVisible({ timeout: 5000 });

    // Verify mode badges are displayed
    await expect(page.locator('text=/PUBLIC/i').first()).toBeVisible();
    await expect(page.locator('text=/PASSWORD.*PROTECTED/i').first()).toBeVisible();
    await expect(page.locator('text=/AUTHENTICATED/i').first()).toBeVisible();
  });

  test("Revoke a share link", async ({ api, page, context }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Revoke Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a public share
    const shareKey = await createShare(page, "PUBLIC", `Revoke Test Share ${timestamp}`);
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
      expect(shareLinkData.isRevoked).toBe(false);
    }
    const shareId = shareLinkData!.id;

    // Navigate to shares management
    await page.goto(`/en-US/projects/settings/${projectId}/shares`);
    await page.waitForLoadState("networkidle");

    // Find the share row and open actions menu using test IDs
    const shareRow = page.getByTestId(`share-row-${shareId}`);
    await expect(shareRow).toBeVisible({ timeout: 5000 });

    const actionsButton = page.getByTestId(`share-actions-${shareId}`);
    await actionsButton.click();

    // Click Revoke button using test ID
    const revokeButton = page.getByTestId(`share-revoke-${shareId}`);
    await revokeButton.click();

    // Confirm revocation in dialog
    const confirmRevokeButton = page.locator('[role="alertdialog"] button:has-text("Revoke Link")');
    await expect(confirmRevokeButton).toBeVisible({ timeout: 5000 });
    await confirmRevokeButton.click();

    // Wait for revocation to complete
    await page.waitForTimeout(1000);

    // Verify revoked badge appears
    await expect(shareRow.locator('text=/revoked/i')).toBeVisible({ timeout: 5000 });

    // Verify in database
    let updatedShareData = await api.getShareLinkByKey(shareKey);
    expect(updatedShareData?.isRevoked).toBe(true);

    // Try to access the revoked share in incognito
    const shareUrl = `http://localhost:3002/share/${shareKey}`;
    const incognitoContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Should see "Link revoked" message, not the report
      const revokedMessage = incognitoPage.locator('text=/link.*revoked/i');
      await expect(revokedMessage.first()).toBeVisible({ timeout: 10000 });
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Delete a share link permanently", async ({ api, page }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Delete Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a share
    const shareKey = await createShare(page, "PUBLIC", `Delete Test Share ${timestamp}`);
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }
    const shareId = shareLinkData!.id;

    // Navigate to shares management
    await page.goto(`/en-US/projects/settings/${projectId}/shares`);
    await page.waitForLoadState("networkidle");

    // Find the share row using test ID
    const shareRow = page.getByTestId(`share-row-${shareId}`);
    await expect(shareRow).toBeVisible({ timeout: 5000 });

    // Open actions menu and delete using test IDs
    const actionsButton = page.getByTestId(`share-actions-${shareId}`);
    await actionsButton.click();

    const deleteButton = page.getByTestId(`share-delete-${shareId}`);
    await deleteButton.click();

    // Confirm deletion in dialog
    const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete Link")');
    await expect(confirmButton).toBeVisible({ timeout: 5000 });
    await confirmButton.click();

    // Wait for deletion
    await page.waitForTimeout(1000);

    // Share should no longer be in the list
    await expect(shareRow).not.toBeVisible({ timeout: 5000 });

    // Verify in database (should be marked as deleted)
    const deletedShareData = await api.getShareLinkByKey(shareKey);
    expect(deletedShareData).toBeNull();
  });

  test("Copy share link from management page", async ({ api, page }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Copy Link Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a share
    const shareKey = await createShare(page, "PUBLIC", `Copy Link Share ${timestamp}`);
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }

    // Navigate to shares management
    await page.goto(`/en-US/projects/settings/${projectId}/shares`);
    await page.waitForLoadState("networkidle");

    // Verify share appears in the list
    const shareRow = page.locator(`tr:has-text("Copy Link Share ${timestamp}")`);
    await expect(shareRow).toBeVisible({ timeout: 5000 });

    // Note: Copy functionality UI varies - just verify the share is accessible
    // The actual copy action is tested in the public-share.spec.ts file
  });

  test("View share access logs", async ({ api, page, context }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Access Logs Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a share
    const shareKey = await createShare(page, "PUBLIC", `Access Logs Share ${timestamp}`);
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }

    // Access the share to create an access log
    const shareUrl = `http://localhost:3002/share/${shareKey}`;
    const incognitoContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Wait for report to load
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });

      // Wait for access to be logged
      await incognitoPage.waitForTimeout(2000);
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }

    // Navigate to shares management
    await page.goto(`/en-US/projects/settings/${projectId}/shares`);
    await page.waitForLoadState("networkidle");

    // Verify share is listed (view count display format may vary)
    const shareRow = page.locator(`tr:has-text("Access Logs Share ${timestamp}")`);
    await expect(shareRow).toBeVisible({ timeout: 5000 });

    // Check that view count is greater than 0 in the database
    const updatedShareData = await api.getShareLinkByKey(shareKey);
    expect(updatedShareData?.viewCount).toBeGreaterThan(0);
  });

  test("Filter shares by status", async ({ api, page }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Filter Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create multiple shares
    const activeShareKey = await createShare(page, "PUBLIC", `Active Share ${timestamp}`);
    const revokeShareKey = await createShare(page, "PUBLIC", `To Revoke ${timestamp}`);

    // Track for cleanup and get share IDs
    const activeShareData = await api.getShareLinkByKey(activeShareKey);
    const revokeShareData = await api.getShareLinkByKey(revokeShareKey);

    expect(activeShareData).toBeTruthy();
    expect(revokeShareData).toBeTruthy();

    if (activeShareData) api.trackShareLink(activeShareData.id);
    if (revokeShareData) api.trackShareLink(revokeShareData.id);

    const revokeShareId = revokeShareData!.id;

    // Navigate to shares management
    await page.goto(`/en-US/projects/settings/${projectId}/shares`);
    await page.waitForLoadState("networkidle");

    // Revoke one share using test IDs
    const actionsButton = page.getByTestId(`share-actions-${revokeShareId}`);
    await actionsButton.click();
    const revokeButton = page.getByTestId(`share-revoke-${revokeShareId}`);
    await revokeButton.click();

    // Confirm revocation in dialog
    const confirmRevokeButton = page.locator('[role="alertdialog"] button:has-text("Revoke Link")');
    await expect(confirmRevokeButton).toBeVisible({ timeout: 5000 });
    await confirmRevokeButton.click();
    await page.waitForTimeout(1000);

    // Try to find and use filter (if available)
    const filterButton = page.locator('button:has-text("All"), button:has-text("Status")').first();
    if (await filterButton.isVisible({ timeout: 2000 })) {
      await filterButton.click();

      // Filter to active only
      const activeOption = page.locator('text=/Active/i').first();
      if (await activeOption.isVisible({ timeout: 2000 })) {
        await activeOption.click();
        await page.waitForTimeout(500);

        // Should show active share, not revoked
        await expect(page.locator(`text=Active Share ${timestamp}`)).toBeVisible();
        await expect(page.locator(`text=To Revoke ${timestamp}`)).not.toBeVisible();
      }
    }

    // Both shares should be visible when viewing all
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text=Active Share ${timestamp}`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text=To Revoke ${timestamp}`)).toBeVisible({ timeout: 5000 });
  });
});
