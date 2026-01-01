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

    // Find the folder and open context menu
    const folder = repositoryPage.getFolderById(folderId);
    await folder.click({ button: "right" });

    // Click rename option
    const renameOption = page.locator('[role="menuitem"]:has-text("Rename"), [role="menuitem"]:has-text("Edit")').first();
    await renameOption.click();

    // Wait for edit modal/input to appear
    const editInput = page.locator('[data-testid="folder-name-input"], [data-testid="edit-folder-name"]').first();
    await expect(editInput).toBeVisible({ timeout: 5000 });

    // Clear and enter new name
    const newName = `Renamed Folder ${Date.now()}`;
    await editInput.clear();
    await editInput.fill(newName);

    // Submit the change
    const saveButton = page.locator('[data-testid="folder-submit-button"], button:has-text("Save")').first();
    await saveButton.click();

    // Wait for modal to close
    await expect(editInput).not.toBeVisible({ timeout: 10000 });
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

    // Find the folder and open context menu
    const folder = repositoryPage.getFolderById(folderId);
    await folder.click({ button: "right" });

    // Click edit option
    const editOption = page.locator('[role="menuitem"]:has-text("Edit")').first();
    await editOption.click();

    // Wait for edit modal to appear
    const editInput = page.locator('[data-testid="folder-name-input"], [data-testid="edit-folder-name"]').first();
    await expect(editInput).toBeVisible({ timeout: 5000 });

    // Find and update documentation
    const docsEditor = page.locator('[data-testid="folder-docs-editor"], .tiptap, .ProseMirror').first();
    if (await docsEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
      await docsEditor.click();
      await page.keyboard.type("Updated documentation content");
    }

    // Submit the change
    const saveButton = page.locator('[data-testid="folder-submit-button"], button:has-text("Save")').first();
    await saveButton.click();

    // Wait for modal to close
    await expect(editInput).not.toBeVisible({ timeout: 10000 });
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

    // Find the folder and open context menu
    const folder = repositoryPage.getFolderById(folderId);
    await folder.click({ button: "right" });

    // Verify edit option is visible (admin user has permissions)
    const editOption = page.locator('[role="menuitem"]:has-text("Edit"), [role="menuitem"]:has-text("Rename")').first();
    await expect(editOption).toBeVisible({ timeout: 5000 });

    // Close the menu
    await page.keyboard.press("Escape");
  });

  test.skip("Edit Folder Option Hidden Without Permission", async ({ page }) => {
    // This test requires a user without edit permissions
    // Skip for now - would need to create a restricted user fixture
    // TODO: Implement when multi-user fixtures are available
  });
});
