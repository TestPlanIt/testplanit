import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Permissions Tests
 *
 * Test cases for verifying permission-based UI visibility and access control.
 */
test.describe("Permissions", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    // Add random suffix to prevent name collisions in parallel execution
    const random = Math.random().toString(36).substring(7);
    return await api.createProject(`E2E Test Project ${Date.now()}-${random}`);
  }

  test("Add Folder Button Visible with Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Admin user should see the Add Folder button
    const addFolderButton = page.getByTestId("add-folder-button");
    await expect(addFolderButton).toBeVisible({ timeout: 10000 });
  });

  test("Add Case Button Visible with Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder
    const folderName = `Permission Case Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Admin user should see the Add Case button
    const addCaseButton = page.locator('[data-testid="add-case-button"], button:has-text("Add Test Case"), button:has-text("New Case")').first();
    await expect(addCaseButton).toBeVisible({ timeout: 10000 });
  });

  test("Documentation Edit Button Visible with Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Navigate directly to documentation page
    await page.goto(`/en-US/projects/documentation/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Verify we're on the documentation page
    await expect(page).toHaveURL(new RegExp(`/projects/documentation/${projectId}`));

    // As admin, edit button should be visible
    const editButton = page.locator('button').filter({ hasText: /edit.*documentation/i }).first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
  });

  test("Bulk Edit Button Visible with Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Permission Bulk Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const caseId = await api.createTestCase(projectId, folderId, `Permission Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select a test case
    const row = page.locator(`[data-row-id="${caseId}"]`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    const checkbox = row.locator('button[role="checkbox"]').first();
    await checkbox.click();

    // Admin user should see the Bulk Edit button when items are selected
    const bulkEditButton = page.locator('[data-testid="bulk-edit-button"]').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
  });

  test("Folder Actions Menu Visible with Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder to test folder actions
    const folderName = `Actions Permission Folder ${Date.now()}`;
    await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Find the folder tree item using role and name
    const folderTreeItem = page.locator(`[role="treeitem"]`).filter({ hasText: folderName }).first();
    await expect(folderTreeItem).toBeVisible({ timeout: 10000 });

    // The TreeView has two buttons per folder row:
    // 1. Chevron button for expand/collapse (first button)
    // 2. DropdownMenuTrigger button with MoreVertical icon (second button, invisible until hover)
    // We need to find the second button which triggers the dropdown menu
    const moreButton = folderTreeItem.locator('button').nth(1);

    // Hover over the folder to make the more actions button visible
    await folderTreeItem.hover();
    // Wait for button to become visible after hover
    await expect(moreButton).toBeVisible({ timeout: 3000 });

    // Click the more actions button to open dropdown
    await moreButton.click();

    // Admin user should see the Edit and Delete options in the dropdown
    const editOption = page.locator('[role="menuitem"]').filter({ hasText: /edit/i }).first();
    await expect(editOption).toBeVisible({ timeout: 5000 });

    const deleteOption = page.locator('[role="menuitem"]').filter({ hasText: /delete/i }).first();
    await expect(deleteOption).toBeVisible({ timeout: 5000 });

    // Close the dropdown
    await page.keyboard.press('Escape');
  });
});
