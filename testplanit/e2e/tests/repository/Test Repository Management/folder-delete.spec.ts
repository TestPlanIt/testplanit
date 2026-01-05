import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Folder Delete Tests
 *
 * Test cases for deleting folders in the repository.
 */
test.describe("Folder Delete", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
  }

  test("Delete Empty Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder to delete
    const folderName = `Empty Folder Delete ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Verify folder exists
    await repositoryPage.verifyFolderExists(folderName);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(folderId);

    // Click delete option
    await repositoryPage.clickFolderMenuItem("Delete");

    // Confirm deletion in dialog
    const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete"), button:has-text("Confirm")').first();
    await confirmButton.click();

    // Wait for deletion to complete
    await page.waitForLoadState("networkidle");

    // Verify folder no longer exists
    await repositoryPage.verifyFolderNotExists(folderName);
  });

  test("Delete Folder with Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with a test case
    const folderName = `Folder With Cases ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Test Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Verify folder exists
    await repositoryPage.verifyFolderExists(folderName);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(folderId);

    // Click delete option
    await repositoryPage.clickFolderMenuItem("Delete");

    // Should show a warning about contained test cases
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog might mention test cases or items that will be deleted
    // Confirm deletion
    const confirmButton = dialog.locator('button:has-text("Delete"), button:has-text("Confirm")').first();
    await confirmButton.click();

    // Wait for deletion to complete
    await page.waitForLoadState("networkidle");

    // Verify folder no longer exists
    await repositoryPage.verifyFolderNotExists(folderName);
  });

  test("Delete Folder with Nested Subfolders", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a parent folder with nested subfolders
    const parentName = `Parent To Delete ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Child Folder ${Date.now()}`;
    await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Expand parent to see children
    await repositoryPage.expandFolder(parentId);

    // Verify both folders exist
    await repositoryPage.verifyFolderExists(parentName);
    await repositoryPage.verifyFolderExists(childName);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(parentId);

    // Click delete option
    await repositoryPage.clickFolderMenuItem("Delete");

    // Should show a warning about nested folders
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Confirm deletion
    const confirmButton = dialog.locator('button:has-text("Delete"), button:has-text("Confirm")').first();
    await confirmButton.click();

    // Wait for deletion to complete
    await page.waitForLoadState("networkidle");

    // Verify both parent and child folders no longer exist
    await repositoryPage.verifyFolderNotExists(parentName);
    await repositoryPage.verifyFolderNotExists(childName);
  });

  test("Cancel Folder Deletion", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder
    const folderName = `Folder Cancel Delete ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Verify folder exists
    await repositoryPage.verifyFolderExists(folderName);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(folderId);

    // Click delete option
    await repositoryPage.clickFolderMenuItem("Delete");

    // Dialog should appear
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Cancel deletion
    const cancelButton = dialog.locator('button:has-text("Cancel"), button:has-text("No")').first();
    await cancelButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Folder should still exist
    await repositoryPage.verifyFolderExists(folderName);
  });

  test("Delete Folder Option Requires Delete Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder
    const folderName = `Folder Perm Check ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(folderId);

    // Verify delete option is visible (admin has permissions)
    const deleteOption = page.locator('[role="menuitem"]').filter({ hasText: "Delete" }).first();
    await expect(deleteOption).toBeVisible({ timeout: 5000 });

    // Close the menu
    await page.keyboard.press("Escape");
  });

  test("Soft Deleted Items Not Visible", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and delete it via API
    const folderName = `Soft Delete Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Verify folder exists
    await repositoryPage.verifyFolderExists(folderName);

    // Delete the folder via API (soft delete)
    await api.deleteFolder(folderId);

    // Reload and verify folder is not visible
    await page.reload();
    await repositoryPage.waitForRepositoryLoad();

    await repositoryPage.verifyFolderNotExists(folderName);
  });
});
