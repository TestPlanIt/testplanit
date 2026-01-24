import { test, expect } from "../../fixtures";

/**
 * Password-Protected Share Flow E2E Tests
 *
 * Tests the complete flow for creating and accessing password-protected share links.
 * Password-protected shares require entering a password before viewing content.
 */
test.describe("Password-Protected Share Flow", () => {
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

  test("Create and access password-protected share @smoke", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Password Share Test ${timestamp}`);
    const sharePassword = `TestPass123-${timestamp}`;

    // Create test cases
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case 1 ${timestamp}`);
    await api.createTestCase(projectId, rootFolderId, `Test Case 2 ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Create a password-protected share
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    // Select PASSWORD_PROTECTED mode
    const passwordModeRadio = page.getByTestId("share-mode-password");
    await expect(passwordModeRadio).toBeVisible({ timeout: 5000 });
    await passwordModeRadio.click();

    // Password fields should now be visible
    const passwordInput = page.getByTestId("share-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 3000 });

    // Enter password
    await passwordInput.fill(sharePassword);

    const confirmPasswordInput = page.getByTestId("share-confirm-password-input");
    await confirmPasswordInput.fill(sharePassword);

    // Add title
    const titleInput = page.getByTestId("share-title-input");
    await titleInput.fill(`Password Protected Report ${timestamp}`);

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
      expect(shareLinkData.mode).toBe("PASSWORD_PROTECTED");
    }

    // Close dialog
    await page.keyboard.press("Escape");

    // Access in incognito mode
    const incognitoContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Should see password gate, not the report
      const passwordGateInput = incognitoPage.getByTestId("password-gate-input");
      await expect(passwordGateInput).toBeVisible({ timeout: 10000 });

      // Verify report is NOT visible yet
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).not.toBeVisible();

      // Enter the correct password
      await passwordGateInput.fill(sharePassword);

      const submitButton = incognitoPage.getByTestId("password-gate-submit");
      await submitButton.click();

      // Wait for password verification
      await incognitoPage.waitForLoadState("networkidle");

      // Now the report should be visible
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });

      // Verify report content
      const reportTitle = incognitoPage.getByTestId("shared-report-title");
      await expect(reportTitle).toContainText(`Password Protected Report ${timestamp}`);

      // Verify test cases are shown
      const reportTable = incognitoPage.locator("table").first();
      await expect(reportTable).toBeVisible({ timeout: 10000 });
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Reject incorrect password", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Wrong Password Test ${timestamp}`);
    const correctPassword = `CorrectPass-${timestamp}`;
    const wrongPassword = `WrongPass-${timestamp}`;

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Create password-protected share
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const passwordModeRadio = page.getByTestId("share-mode-password");
    await passwordModeRadio.click();

    const passwordInput = page.getByTestId("share-password-input");
    await passwordInput.fill(correctPassword);

    const confirmPasswordInput = page.getByTestId("share-confirm-password-input");
    await confirmPasswordInput.fill(correctPassword);

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

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

    // Access in incognito mode
    const incognitoContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Enter wrong password
      const passwordGateInput = incognitoPage.getByTestId("password-gate-input");
      await expect(passwordGateInput).toBeVisible({ timeout: 10000 });
      await passwordGateInput.fill(wrongPassword);

      const submitButton = incognitoPage.getByTestId("password-gate-submit");
      await submitButton.click();

      // Wait for error response
      await incognitoPage.waitForTimeout(1000);

      // Should show error message
      const errorMessage = incognitoPage.locator('[role="alert"]');
      await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });

      // Report should NOT be visible
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).not.toBeVisible();

      // Password input should be cleared and ready for another attempt
      await expect(passwordGateInput).toBeVisible();
      const inputValue = await passwordGateInput.inputValue();
      expect(inputValue).toBe("");
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Rate limiting after 5 failed password attempts", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Rate Limit Test ${timestamp}`);
    const correctPassword = `CorrectPass-${timestamp}`;

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Create password-protected share
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const passwordModeRadio = page.getByTestId("share-mode-password");
    await passwordModeRadio.click();

    const passwordInput = page.getByTestId("share-password-input");
    await passwordInput.fill(correctPassword);

    const confirmPasswordInput = page.getByTestId("share-confirm-password-input");
    await confirmPasswordInput.fill(correctPassword);

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

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

    // Access in incognito mode
    const incognitoContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      const passwordGateInput = incognitoPage.getByTestId("password-gate-input");
      const submitButton = incognitoPage.getByTestId("password-gate-submit");

      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await expect(passwordGateInput).toBeVisible({ timeout: 5000 });
        await passwordGateInput.fill(`WrongPassword${i}`);
        await submitButton.click();
        await incognitoPage.waitForTimeout(500);
      }

      // 6th attempt should be blocked
      await expect(passwordGateInput).toBeVisible({ timeout: 5000 });
      await passwordGateInput.fill("AnotherWrongPassword");
      await submitButton.click();
      await incognitoPage.waitForTimeout(500);

      // Should see rate limit error
      const rateLimitError = incognitoPage.locator('text=/too many attempts|rate limit/i');
      await expect(rateLimitError.first()).toBeVisible({ timeout: 5000 });

      // Even the correct password should be blocked now
      await passwordGateInput.fill(correctPassword);
      await submitButton.click();
      await incognitoPage.waitForTimeout(500);

      // Still blocked
      await expect(rateLimitError.first()).toBeVisible({ timeout: 5000 });

      // Report should not be accessible
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).not.toBeVisible();
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Password mismatch shows validation error", async ({
    api,
    page,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Password Mismatch Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Open share dialog
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    // Select password-protected mode
    const passwordModeRadio = page.getByTestId("share-mode-password");
    await passwordModeRadio.click();

    // Enter mismatched passwords
    const passwordInput = page.getByTestId("share-password-input");
    await passwordInput.fill("Password123");

    const confirmPasswordInput = page.getByTestId("share-confirm-password-input");
    await confirmPasswordInput.fill("DifferentPassword456");

    // Try to create the share
    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Should see validation error
    const errorMessage = page.locator('text=/passwords do not match/i');
    await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });

    // Share should NOT be created
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).not.toBeVisible();
  });

  test("Password persists in session after verification", async ({
    api,
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Session Persist Test ${timestamp}`);
    const sharePassword = `SessionPass-${timestamp}`;

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Create password-protected share
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    const passwordModeRadio = page.getByTestId("share-mode-password");
    await passwordModeRadio.click();

    const passwordInput = page.getByTestId("share-password-input");
    await passwordInput.fill(sharePassword);

    const confirmPasswordInput = page.getByTestId("share-confirm-password-input");
    await confirmPasswordInput.fill(sharePassword);

    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

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

    // Access in incognito mode
    const incognitoContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const incognitoPage = await incognitoContext.newPage();

    try {
      await incognitoPage.goto(shareUrl);
      await incognitoPage.waitForLoadState("networkidle");

      // Enter password
      const passwordGateInput = incognitoPage.getByTestId("password-gate-input");
      await passwordGateInput.fill(sharePassword);

      const submitButton = incognitoPage.getByTestId("password-gate-submit");
      await submitButton.click();

      // Wait for report to load
      const sharedReportViewer = incognitoPage.getByTestId("shared-report-viewer");
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });

      // Reload the page
      await incognitoPage.reload();
      await incognitoPage.waitForLoadState("networkidle");

      // Report should be visible immediately without password prompt
      // (session storage preserves the JWT token)
      await expect(sharedReportViewer).toBeVisible({ timeout: 10000 });

      // Password gate should NOT be visible
      await expect(passwordGateInput).not.toBeVisible();
    } finally {
      await incognitoPage.close();
      await incognitoContext.close();
    }
  });

  test("Empty password shows validation error", async ({
    api,
    page,
  }) => {
    const timestamp = Date.now();
    const projectId = await api.createProject(`Empty Password Test ${timestamp}`);

    // Create test data
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Test Case ${timestamp}`);

    // Navigate to report builder and run report
    await navigateToRepositoryStatsReport(page, projectId);
    await runReport(page);

    // Open share dialog
    const shareButton = page.getByTestId("share-report-button");
    await shareButton.click();

    // Select password-protected mode
    const passwordModeRadio = page.getByTestId("share-mode-password");
    await passwordModeRadio.click();

    // Try to create with empty passwords
    const createButton = page.getByTestId("share-create-button");
    await createButton.click();

    // Wait a moment for any validation to occur
    await page.waitForTimeout(1000);

    // Share should NOT be created (success screen should not appear)
    const shareUrlInput = page.getByTestId("share-url-input");
    await expect(shareUrlInput).not.toBeVisible({ timeout: 2000 });
  });
});
