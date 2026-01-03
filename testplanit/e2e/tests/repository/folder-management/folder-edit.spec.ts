import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Folder Edit Tests
 *
 * Test cases for editing folders in the repository.
 */
test.describe("Folder Edit", () => {
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

  test("Rename Existing Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder to rename
    const originalName = `Folder To Rename ${Date.now()}`;
    const folderId = await api.createFolder(projectId, originalName);

    await repositoryPage.goto(projectId);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(folderId);

    // Click edit option
    await repositoryPage.clickFolderMenuItem("Edit");

    // Wait for edit modal to appear and find the name input
    const editDialog = page.locator('[role="dialog"]');
    await expect(editDialog).toBeVisible({ timeout: 5000 });

    // Find the name input inside the dialog - it's after the "Name" label
    const editInput = editDialog.locator('input').first();
    await expect(editInput).toBeVisible({ timeout: 5000 });

    // Clear and enter new name
    const newName = `Renamed Folder ${Date.now()}`;
    await editInput.clear();
    await editInput.fill(newName);

    // Submit the change - look for Submit button in the dialog
    const saveButton = editDialog.locator('button[type="submit"], button:has-text("Submit")').first();
    await saveButton.click();

    // Wait for modal to close
    await expect(editDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify the folder was renamed
    await repositoryPage.verifyFolderExists(newName);
    await repositoryPage.verifyFolderNotExists(originalName);
  });

  test("Edit Folder Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder to edit
    const folderName = `Folder With Docs ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(folderId);

    // Click edit option
    await repositoryPage.clickFolderMenuItem("Edit");

    // Wait for edit modal to appear
    const editDialog = page.locator('[role="dialog"]');
    await expect(editDialog).toBeVisible({ timeout: 5000 });

    // Find and update documentation - the TipTap editor uses .ProseMirror class
    const docsEditor = editDialog.locator('.tiptap, .ProseMirror').first();
    await expect(docsEditor).toBeVisible({ timeout: 3000 });
    await docsEditor.click();
    await page.keyboard.type("Updated documentation content");

    // Submit the change - look for Submit button in the dialog
    const saveButton = editDialog.locator('button[type="submit"], button:has-text("Submit")').first();
    await saveButton.click();

    // Wait for modal to close
    await expect(editDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify folder still exists
    await repositoryPage.verifyFolderExists(folderName);
  });

  test("Edit Folder Option Available with Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder
    const folderName = `Folder Edit Perm ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Open folder context menu (hover to show menu button, then click it)
    await repositoryPage.openFolderContextMenu(folderId);

    // Verify edit option is visible (admin user has permissions)
    const editOption = page.locator('[role="menuitem"]').filter({ hasText: "Edit" }).first();
    await expect(editOption).toBeVisible({ timeout: 5000 });

    // Close the menu
    await page.keyboard.press("Escape");
  });

});
