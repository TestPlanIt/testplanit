import { test, expect } from "../../fixtures";

/**
 * Admin Share Management E2E Tests
 *
 * Tests admin-level share functionality:
 * - Creating shares from cross-project reports (Admin > Reports)
 * - Managing all shares across projects (Admin > Manage Shares)
 */
test.describe("Admin Share Management", () => {
  /**
   * Helper to navigate to admin reports page with report configuration
   */
  async function navigateToAdminReportsWithConfig(page: import("@playwright/test").Page) {
    // Navigate with URL parameters to pre-configure the report builder
    const params = new URLSearchParams({
      reportType: "cross-project-repository-stats",
      dimensions: "testCase",
      metrics: "testCaseCount",
    });
    await page.goto(`/en-US/admin/reports?${params.toString()}`);
    await page.waitForLoadState("networkidle");

    // Wait for page to load
    const pageTitle = page.locator('h1:has-text("Cross-Project Reports"), [data-testid="adminreports-page-title"]');
    await expect(pageTitle.first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Helper to run a cross-project report
   */
  async function runCrossProjectReport(page: import("@playwright/test").Page) {
    // Report should already be configured via URL params, just run it
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await expect(runButton).toBeEnabled({ timeout: 10000 });
    await runButton.click();
    await page.waitForLoadState("networkidle");

    // Wait for results
    const resultsCard = page.locator('text=/Results/i');
    await expect(resultsCard.first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Helper to create a share from Report Builder
   */
  async function createShare(
    page: import("@playwright/test").Page,
    title: string
  ): Promise<string> {
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    // Wait for dialog
    const shareDialog = page.locator('[role="dialog"]');
    await expect(shareDialog).toBeVisible({ timeout: 5000 });

    // Click Create tab if needed
    const createTab = page.getByTestId("share-tab-create");
    if (await createTab.isVisible({ timeout: 2000 })) {
      await createTab.click();
      await page.waitForTimeout(500);
    }

    // Select PUBLIC mode
    const publicModeRadio = page.getByTestId("share-mode-public");
    await publicModeRadio.click();

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

    // Close dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    return shareUrl.split("/share/")[1];
  }

  test("Admin can create share from cross-project report @smoke", async ({ api, page }) => {
    const timestamp = Date.now();

    // Create two projects with test data
    const project1Id = await api.createProject(`Admin Share Project 1 ${timestamp}`);
    const project2Id = await api.createProject(`Admin Share Project 2 ${timestamp}`);

    const rootFolder1 = await api.getRootFolderId(project1Id);
    const rootFolder2 = await api.getRootFolderId(project2Id);

    await api.createTestCase(project1Id, rootFolder1, `Test Case P1 ${timestamp}`);
    await api.createTestCase(project2Id, rootFolder2, `Test Case P2 ${timestamp}`);

    // Navigate to admin reports with pre-configured report
    await navigateToAdminReportsWithConfig(page);

    // Run a cross-project report
    await runCrossProjectReport(page);

    // Create a share
    const shareKey = await createShare(page, `Admin Cross-Project Report ${timestamp}`);
    const shareLinkData = await api.getShareLinkByKey(shareKey);

    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
      expect(shareLinkData.mode).toBe("PUBLIC");
      expect(shareLinkData.title).toContain(`Admin Cross-Project Report ${timestamp}`);
    }

    // Verify share works by accessing it in incognito
    const shareUrl = `http://localhost:3002/share/${shareKey}`;
    const incognitoContext = await page.context().browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Verify shared report viewer is displayed
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Admin can view all shares across all projects", async ({ api, page }) => {
    const timestamp = Date.now();

    // Create two projects
    const project1Id = await api.createProject(`Admin View Project 1 ${timestamp}`);
    const project2Id = await api.createProject(`Admin View Project 2 ${timestamp}`);

    // Create test data for both projects
    const rootFolder1 = await api.getRootFolderId(project1Id);
    const rootFolder2 = await api.getRootFolderId(project2Id);

    await api.createTestCase(project1Id, rootFolder1, `Test Case ${timestamp}`);
    await api.createTestCase(project2Id, rootFolder2, `Test Case ${timestamp}`);

    // Create a share for project 1
    await page.goto(`/en-US/projects/reports/${project1Id}?tab=builder&reportType=repository-stats&dimensions=testCase&metrics=testCaseCount`);
    await page.waitForLoadState("networkidle");

    const runButton1 = page.locator('[data-testid="run-report-button"]');
    await expect(runButton1).toBeVisible({ timeout: 5000 });
    await runButton1.click();
    await page.waitForLoadState("networkidle");

    const shareKey1 = await createShare(page, `Project 1 Share ${timestamp}`);
    const share1Data = await api.getShareLinkByKey(shareKey1);
    if (share1Data) {
      api.trackShareLink(share1Data.id);
    }

    // Create a share for project 2
    await page.goto(`/en-US/projects/reports/${project2Id}?tab=builder&reportType=repository-stats&dimensions=testCase&metrics=testCaseCount`);
    await page.waitForLoadState("networkidle");

    const runButton2 = page.locator('[data-testid="run-report-button"]');
    await expect(runButton2).toBeVisible({ timeout: 5000 });
    await runButton2.click();
    await page.waitForLoadState("networkidle");

    const shareKey2 = await createShare(page, `Project 2 Share ${timestamp}`);
    const share2Data = await api.getShareLinkByKey(shareKey2);
    if (share2Data) {
      api.trackShareLink(share2Data.id);
    }

    // Navigate to admin shares management
    await page.goto("/en-US/admin/shares");
    await page.waitForLoadState("networkidle");

    // Verify page title
    const pageTitle = page.locator('h1:has-text("Manage All Shares")');
    await expect(pageTitle).toBeVisible({ timeout: 5000 });

    // Verify both shares are listed
    await expect(page.locator(`text=Project 1 Share ${timestamp}`)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(`text=Project 2 Share ${timestamp}`)).toBeVisible({
      timeout: 5000,
    });

    // Verify project column is displayed
    await expect(page.locator('th:has-text("Project")')).toBeVisible();
  });

  test("Admin can manage shares from any project", async ({ api, page }) => {
    const timestamp = Date.now();

    // Create a project
    const projectId = await api.createProject(`Admin Manage Project ${timestamp}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Create a share
    await page.goto(`/en-US/projects/reports/${projectId}?tab=builder&reportType=repository-stats&dimensions=testCase&metrics=testCaseCount`);
    await page.waitForLoadState("networkidle");

    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await runButton.click();
    await page.waitForLoadState("networkidle");

    const shareKey = await createShare(page, `Admin Manage Share ${timestamp}`);
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }
    const shareId = shareLinkData!.id;

    // Navigate to admin shares management
    await page.goto("/en-US/admin/shares");
    await page.waitForLoadState("networkidle");

    // Find the share and revoke it
    const shareRow = page.getByTestId(`share-row-${shareId}`);
    await expect(shareRow).toBeVisible({ timeout: 5000 });

    const actionsButton = page.getByTestId(`share-actions-${shareId}`);
    await actionsButton.click();

    const revokeButton = page.getByTestId(`share-revoke-${shareId}`);
    await revokeButton.click();

    // Confirm revocation
    const confirmRevokeButton = page.locator('[role="alertdialog"] button:has-text("Revoke Link")');
    await expect(confirmRevokeButton).toBeVisible({ timeout: 5000 });
    await confirmRevokeButton.click();

    await page.waitForTimeout(1000);

    // Verify revoked badge appears
    await expect(shareRow.locator('text=/revoked/i')).toBeVisible({ timeout: 5000 });

    // Verify in database
    const updatedShareData = await api.getShareLinkByKey(shareKey);
    expect(updatedShareData?.isRevoked).toBe(true);
  });

  test("Admin can delete shares from any project", async ({ api, page }) => {
    const timestamp = Date.now();

    // Create a project
    const projectId = await api.createProject(`Admin Delete Project ${timestamp}`);
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Create a share
    await page.goto(`/en-US/projects/reports/${projectId}?tab=builder&reportType=repository-stats&dimensions=testCase&metrics=testCaseCount`);
    await page.waitForLoadState("networkidle");

    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeVisible({ timeout: 5000 });
    await runButton.click();
    await page.waitForLoadState("networkidle");

    const shareKey = await createShare(page, `Admin Delete Share ${timestamp}`);
    const shareLinkData = await api.getShareLinkByKey(shareKey);
    expect(shareLinkData).toBeTruthy();
    if (shareLinkData) {
      api.trackShareLink(shareLinkData.id);
    }
    const shareId = shareLinkData!.id;

    // Navigate to admin shares management
    await page.goto("/en-US/admin/shares");
    await page.waitForLoadState("networkidle");

    // Find the share and delete it
    const shareRow = page.getByTestId(`share-row-${shareId}`);
    await expect(shareRow).toBeVisible({ timeout: 5000 });

    const actionsButton = page.getByTestId(`share-actions-${shareId}`);
    await actionsButton.click();

    const deleteButton = page.getByTestId(`share-delete-${shareId}`);
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete Link")');
    await expect(confirmButton).toBeVisible({ timeout: 5000 });
    await confirmButton.click();

    await page.waitForTimeout(1000);

    // Share should no longer be in the list
    await expect(shareRow).not.toBeVisible({ timeout: 5000 });

    // Verify in database
    const deletedShareData = await api.getShareLinkByKey(shareKey);
    expect(deletedShareData).toBeNull();
  });
});
