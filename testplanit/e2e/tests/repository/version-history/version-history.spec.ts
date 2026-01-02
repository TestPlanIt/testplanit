import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Version History Tests
 *
 * Test cases for viewing and managing version history of test cases.
 */
test.describe("Version History", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("View Test Case Version History", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Version History Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Version Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Open version history tab/panel
    const historyTab = page.locator('[data-testid="history-tab"], button:has-text("History"), [aria-label="History"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    await page.waitForLoadState("networkidle");

    // Verify version history is displayed
    const historyPanel = page.locator('[data-testid="history-panel"], [data-testid="version-list"]');
    await expect(historyPanel.first()).toBeVisible({ timeout: 5000 });

    // Should have at least one version (creation)
    const versionItems = page.locator('[data-testid="version-item"]');
    expect(await versionItems.count()).toBeGreaterThanOrEqual(1);
  });

  test("Version Created on Test Case Creation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Creation Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Creation Version Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(projectId, folderId, testCaseName);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    // Verify first version exists and shows "Created" or similar
    const firstVersion = page.locator('[data-testid="version-item"]').first();
    await expect(firstVersion).toBeVisible({ timeout: 5000 });

    const versionLabel = firstVersion.locator('text=/created|initial|v1/i');
    await expect(versionLabel).toBeVisible({ timeout: 3000 });
  });

  test("Version Created on Each Edit", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Edit Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Edit Version Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Make an edit to the test case
    const nameInput = page.locator('[data-testid="case-name-input"], input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.clear();
    await nameInput.fill(`Updated Case Name ${Date.now()}`);

    const saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();

    await page.waitForLoadState("networkidle");

    // Check version history
    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    await page.waitForLoadState("networkidle");

    // Should now have 2 versions (creation + edit)
    const versionItems = page.locator('[data-testid="version-item"]');
    expect(await versionItems.count()).toBeGreaterThanOrEqual(2);
  });

  test("View Specific Version Details", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Specific Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Specific Version Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    const versionItem = page.locator('[data-testid="version-item"]').first();
    await expect(versionItem).toBeVisible({ timeout: 5000 });
    await versionItem.click();

    // Version details should be shown
    const versionDetails = page.locator('[data-testid="version-details"]');
    await expect(versionDetails.first()).toBeVisible({ timeout: 5000 });
  });

  test("Compare Two Versions Side by Side", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Compare Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Compare Version Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    // Select two versions for comparison
    const versionItems = page.locator('[data-testid="version-item"]');
    expect(await versionItems.count()).toBeGreaterThanOrEqual(2);

    // Select first version
    const checkbox1 = versionItems.nth(0).locator('input[type="checkbox"]');
    await expect(checkbox1).toBeVisible({ timeout: 3000 });
    await checkbox1.click();

    // Select second version
    const checkbox2 = versionItems.nth(1).locator('input[type="checkbox"]');
    await expect(checkbox2).toBeVisible({ timeout: 3000 });
    await checkbox2.click();

    // Click compare button
    const compareButton = page.locator('button:has-text("Compare")').first();
    await expect(compareButton).toBeVisible({ timeout: 3000 });
    await compareButton.click();

    // Verify comparison view
    const comparisonView = page.locator('[data-testid="version-comparison"], .diff-view');
    await expect(comparisonView.first()).toBeVisible({ timeout: 5000 });
  });

  test("Compare Current with Previous Version", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Compare Prev Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Compare Prev Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    // Look for "Compare with previous" button
    const comparePrevButton = page.locator('button:has-text("Compare with Previous"), [data-testid="compare-previous"]').first();
    await expect(comparePrevButton).toBeVisible({ timeout: 5000 });
    await comparePrevButton.click();

    const comparisonView = page.locator('[data-testid="version-comparison"]');
    await expect(comparisonView.first()).toBeVisible({ timeout: 5000 });
  });

  test("Compare Test Case Versions", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Compare TC Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Compare TC Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    // The version list should support comparison
    const compareAction = page.locator('[data-testid="compare-action"], button:has-text("Compare")');
    await expect(compareAction.first()).toBeVisible({ timeout: 5000 });
  });

  test("Restore Previous Version", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Restore Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const originalName = `Original Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(projectId, folderId, originalName);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Make an edit
    const nameInput = page.locator('[data-testid="case-name-input"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.clear();
    await nameInput.fill(`Modified Name ${Date.now()}`);

    const saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();

    await page.waitForLoadState("networkidle");

    // Open history and restore previous version
    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    // Select the older version
    const versionItems = page.locator('[data-testid="version-item"]');
    const olderVersion = versionItems.last();
    await expect(olderVersion).toBeVisible({ timeout: 5000 });
    await olderVersion.click();

    // Click restore
    const restoreButton = page.locator('button:has-text("Restore")').first();
    await expect(restoreButton).toBeVisible({ timeout: 5000 });
    await restoreButton.click();

    // Confirm
    const confirmButton = page.locator('[role="alertdialog"] button:has-text("Restore")').first();
    await expect(confirmButton).toBeVisible({ timeout: 3000 });
    await confirmButton.click();

    await page.waitForLoadState("networkidle");

    // Verify the original name is restored
    await expect(page.locator(`text="${originalName}"`).first()).toBeVisible({ timeout: 5000 });
  });

  test("Version History Shows Field Changes", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Field Changes Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Field Changes Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    const versionItem = page.locator('[data-testid="version-item"]').first();
    await expect(versionItem).toBeVisible({ timeout: 5000 });
    await versionItem.click();

    // Version details should show which fields changed
    const fieldChanges = page.locator('[data-testid="field-changes"], .change-list');
    await expect(fieldChanges).toBeVisible({ timeout: 5000 });
  });

  test("Version History Shows Editor Information", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Editor Info Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Editor Info Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    const versionItem = page.locator('[data-testid="version-item"]').first();
    await expect(versionItem).toBeVisible({ timeout: 5000 });

    // Version should show who made the change
    const editorInfo = versionItem.locator('[data-testid="editor-name"], .editor, .author');
    await expect(editorInfo.first()).toBeVisible({ timeout: 5000 });
  });

  test("Version History Timestamp Display", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Timestamp Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Timestamp Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    const versionItem = page.locator('[data-testid="version-item"]').first();
    await expect(versionItem).toBeVisible({ timeout: 5000 });

    // Version should show timestamp
    const timestamp = versionItem.locator('[data-testid="version-timestamp"], time, .timestamp');
    await expect(timestamp.first()).toBeVisible({ timeout: 5000 });
  });

  test("Version History Pagination", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Pagination Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Pagination Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    // Look for pagination controls if there are many versions
    const pagination = page.locator('[data-testid="history-pagination"], .pagination');
    await expect(pagination).toBeVisible({ timeout: 5000 });

    const nextPage = pagination.locator('button:has-text("Next"), [aria-label="Next page"]').first();
    await expect(nextPage).toBeEnabled();
    await nextPage.click();
    await page.waitForLoadState("networkidle");
  });

  test("Revert Specific Field to Previous Version", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Revert Field Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Revert Field Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    const versionItem = page.locator('[data-testid="version-item"]').first();
    await expect(versionItem).toBeVisible({ timeout: 5000 });
    await versionItem.click();

    // Look for field-level revert option
    const fieldRevert = page.locator('[data-testid="revert-field"], button:has-text("Revert this field")').first();
    await expect(fieldRevert).toBeVisible({ timeout: 5000 });
    await fieldRevert.click();

    // Confirm
    const confirmButton = page.locator('[role="alertdialog"] button:has-text("Revert")').first();
    await expect(confirmButton).toBeVisible({ timeout: 3000 });
    await confirmButton.click();
    await page.waitForLoadState("networkidle");
  });

  test("Version History Comment", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Comment Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Comment Version Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Make an edit with a comment
    const nameInput = page.locator('[data-testid="case-name-input"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.clear();
    await nameInput.fill(`Updated with comment ${Date.now()}`);

    // Add version comment
    const commentInput = page.locator('[data-testid="version-comment"], textarea[placeholder*="comment"]').first();
    await expect(commentInput).toBeVisible({ timeout: 3000 });
    await commentInput.fill("This is a version comment");

    const saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();

    await page.waitForLoadState("networkidle");

    // Verify comment in version history
    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    const versionItem = page.locator('[data-testid="version-item"]').first();
    const comment = versionItem.locator('text="This is a version comment"');
    await expect(comment).toBeVisible({ timeout: 3000 });
  });

  test("Version History Export", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Export Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Export Version Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    const historyTab = page.locator('[data-testid="history-tab"]').first();
    await expect(historyTab).toBeVisible({ timeout: 5000 });
    await historyTab.click();

    // Look for export history button
    const exportButton = page.locator('[data-testid="export-history"], button:has-text("Export History")').first();
    await expect(exportButton).toBeVisible({ timeout: 5000 });
    await exportButton.click();

    // Export dialog should appear
    const exportDialog = page.locator('[role="dialog"]');
    await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });
  });
});
