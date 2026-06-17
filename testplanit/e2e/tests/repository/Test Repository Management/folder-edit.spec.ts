import { expect, test } from "../../../fixtures";
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
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Folder Edit ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Rename Existing Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const originalName = `Folder To Rename ${Date.now()}`;
    const newName = `Renamed Folder ${Date.now()}`;

    let folderId: number | undefined;
    let editDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create a folder to rename and open repository", async () => {
      folderId = await api.createFolder(projectId, originalName);

      await repositoryPage.goto(projectId);
    });

    await test.step("Open the folder's Edit dialog", async () => {
      // Open folder context menu (hover to show menu button, then click it)
      await repositoryPage.openFolderContextMenu(folderId!);

      // Click edit option
      await repositoryPage.clickFolderMenuItem("Edit");

      // Wait for edit modal to appear and find the name input
      editDialog = page.locator('[role="dialog"]');
      await expect(editDialog).toBeVisible({ timeout: 5000 });
    });

    await test.step("Enter the new folder name", async () => {
      // Find the name input inside the dialog - it's after the "Name" label
      const editInput = editDialog!.locator("input").first();
      await expect(editInput).toBeVisible({ timeout: 5000 });

      // Clear and enter new name
      await editInput.clear();
      await editInput.fill(newName);
    });

    await test.step("Submit the rename and confirm the API succeeds", async () => {
      // Submit the change - look for Submit button in the dialog
      const saveButton = editDialog!
        .locator('button[type="submit"], button:has-text("Submit")')
        .first();
      await expect(saveButton).toBeEnabled({ timeout: 3000 });

      // Wait for the API call to complete
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/model/repositoryFolders") &&
          (response.request().method() === "PUT" ||
            response.request().method() === "PATCH"),
        { timeout: 15000 }
      );

      await saveButton.click();

      // Wait for the API response
      const response = await responsePromise;
      expect(response.ok()).toBe(true);

      // Wait for modal to close
      await expect(editDialog).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the folder shows its new name", async () => {
      // Wait for the tree to refetch and re-render with the new folder name
      // The React Query cache invalidation may take a moment to trigger a refetch
      await expect(async () => {
        await repositoryPage.verifyFolderExists(newName);
      }).toPass({ timeout: 15000 });

      // Same retry envelope on the negative assertion — react-arborist can
      // briefly show both the old and new node during the cache swap.
      await expect(async () => {
        await repositoryPage.verifyFolderNotExists(originalName);
      }).toPass({ timeout: 10000 });
    });
  });

  test("Edit Folder Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Folder With Docs ${Date.now()}`;

    let folderId: number | undefined;
    let editDialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create a folder to edit and open repository", async () => {
      folderId = await api.createFolder(projectId, folderName);

      await repositoryPage.goto(projectId);
    });

    await test.step("Open the folder's Edit dialog", async () => {
      // Open folder context menu (hover to show menu button, then click it)
      await repositoryPage.openFolderContextMenu(folderId!);

      // Click edit option
      await repositoryPage.clickFolderMenuItem("Edit");

      // Wait for edit modal to appear
      editDialog = page.locator('[role="dialog"]');
      await expect(editDialog).toBeVisible({ timeout: 5000 });
    });

    await test.step("Update the folder documentation", async () => {
      // Find and update documentation - the TipTap editor uses .ProseMirror class
      const docsEditor = editDialog!.locator(".tiptap, .ProseMirror").first();
      await expect(docsEditor).toBeVisible({ timeout: 3000 });
      await docsEditor.click();
      await page.keyboard.type("Updated documentation content");
    });

    await test.step("Submit the change and close the dialog", async () => {
      // Submit the change - look for Submit button in the dialog
      const saveButton = editDialog!
        .locator('button[type="submit"], button:has-text("Submit")')
        .first();
      await saveButton.click();

      // Wait for modal to close
      await expect(editDialog).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the folder still exists", async () => {
      await repositoryPage.verifyFolderExists(folderName);
    });
  });

  test("Edit Folder Option Available with Permission", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Folder Edit Perm ${Date.now()}`;

    let folderId: number | undefined;

    await test.step("Create a folder and open repository", async () => {
      folderId = await api.createFolder(projectId, folderName);

      await repositoryPage.goto(projectId);
    });

    await test.step("Open the folder context menu", async () => {
      // Open folder context menu (hover to show menu button, then click it)
      await repositoryPage.openFolderContextMenu(folderId!);
    });

    await test.step("Verify the Edit option is available and close the menu", async () => {
      // Verify edit option is visible (admin user has permissions)
      const editOption = page
        .locator('[role="menuitem"]')
        .filter({ hasText: "Edit" })
        .first();
      await expect(editOption).toBeVisible({ timeout: 5000 });

      // Close the menu
      await page.keyboard.press("Escape");
    });
  });
});
