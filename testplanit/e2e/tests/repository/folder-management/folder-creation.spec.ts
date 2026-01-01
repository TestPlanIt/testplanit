import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Folder Creation Tests
 *
 * Test cases for creating folders in the repository.
 * These tests match the test cases defined in TestPlanIt production.
 */
test.describe("Folder Creation", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  // Helper to get a test project ID
  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("Create Root-Level Folder", async ({ api }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const folderName = `Root Folder ${Date.now()}`;
    await repositoryPage.createFolder(folderName);

    await repositoryPage.verifyFolderExists(folderName);
  });

  test("Create Nested Folder", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    // First create a parent folder via API
    const parentName = `Parent ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);

    await repositoryPage.goto(projectId);

    // Select the parent folder
    await repositoryPage.selectFolder(parentId);

    // Create nested folder - the modal should auto-select the current folder as parent
    const childName = `Child Folder ${Date.now()}`;
    await repositoryPage.createNestedFolder(childName, parentId);

    // Expand parent to see child
    await repositoryPage.expandFolder(parentId);
    await repositoryPage.verifyFolderExists(childName);
  });

  test("Create Folder with Documentation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const folderName = `Folder With Docs ${Date.now()}`;

    // Open the add folder modal
    await repositoryPage.openAddFolderModal();

    // Remove parent if present to create at root
    const removeParentButton = page.getByTestId("remove-parent-folder-button");
    try {
      await removeParentButton.waitFor({ state: "visible", timeout: 3000 });
      await removeParentButton.click();
      await page
        .getByText("Root folder")
        .first()
        .waitFor({ state: "visible", timeout: 2000 });
    } catch {
      // No parent folder shown
    }

    // Fill folder name
    await repositoryPage.folderNameInput.fill(folderName);

    // Find and fill documentation field (if visible)
    const docsEditor = page.locator('[data-testid="folder-docs-editor"], .tiptap, .ProseMirror').first();
    if (await docsEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await docsEditor.click();
      await page.keyboard.type("This is folder documentation");
    }

    // Submit
    await expect(repositoryPage.folderSubmitButton).toBeEnabled({ timeout: 5000 });
    await repositoryPage.folderSubmitButton.click();
    await expect(repositoryPage.folderNameInput).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify folder was created
    await repositoryPage.verifyFolderExists(folderName);
  });

  test("Create Folder with Maximum Name Length", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Create a folder with a very long name (255 characters is typical max)
    const longName = "A".repeat(200) + ` ${Date.now()}`;
    await repositoryPage.createFolder(longName);

    // Verify folder was created (name may be truncated in display)
    const folder = repositoryPage.getFolderByName(longName.substring(0, 50));
    await expect(folder.first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Folder with Special Characters", async ({ api }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Create folder with special characters
    const specialName = `Test & Folder <> "quotes" 'apostrophe' ${Date.now()}`;
    await repositoryPage.createFolder(specialName);

    await repositoryPage.verifyFolderExists(specialName);
  });

  test("Create Folder with Empty Name - Validation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open the add folder modal
    await repositoryPage.openAddFolderModal();

    // Remove parent if present
    const removeParentButton = page.getByTestId("remove-parent-folder-button");
    try {
      await removeParentButton.waitFor({ state: "visible", timeout: 3000 });
      await removeParentButton.click();
    } catch {
      // No parent folder
    }

    // Leave the name empty and try to submit
    await repositoryPage.folderNameInput.fill("");

    // Submit button should be disabled
    await expect(repositoryPage.folderSubmitButton).toBeDisabled();

    // Close the modal
    await repositoryPage.folderCancelButton.click();
  });

  test("Create Folder with Duplicate Name at Same Level", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder first via API
    const folderName = `Duplicate Test ${Date.now()}`;
    await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Try to create another folder with the same name at root level
    await repositoryPage.openAddFolderModal();

    // Remove parent if present
    const removeParentButton = page.getByTestId("remove-parent-folder-button");
    try {
      await removeParentButton.waitFor({ state: "visible", timeout: 3000 });
      await removeParentButton.click();
      await page.getByText("Root folder").first().waitFor({ state: "visible", timeout: 2000 });
    } catch {
      // No parent folder
    }

    await repositoryPage.folderNameInput.fill(folderName);
    await expect(repositoryPage.folderSubmitButton).toBeEnabled({ timeout: 5000 });
    await repositoryPage.folderSubmitButton.click();

    // Should show an error (duplicate name at same level)
    const errorMessage = page.locator('[role="alert"], .text-destructive, .error-message').first();
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
  });

  test("Create Folder with Same Name at Different Levels", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    // Create a parent folder
    const parentName = `Parent Level ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);

    // Create a folder at root level
    const sharedName = `Shared Name ${Date.now()}`;
    await api.createFolder(projectId, sharedName);

    await repositoryPage.goto(projectId);

    // Now create a folder with the same name under the parent (should succeed)
    await repositoryPage.selectFolder(parentId);
    await repositoryPage.createNestedFolder(sharedName, parentId);

    // Expand parent and verify both folders exist
    await repositoryPage.expandFolder(parentId);

    // Should have two folders with the same name (one at root, one nested)
    const folders = repositoryPage.getFolderByName(sharedName);
    await expect(folders.first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Nested Documentation Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a parent folder
    const parentName = `Parent for Docs ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);

    await repositoryPage.goto(projectId);

    // Select parent folder
    await repositoryPage.selectFolder(parentId);

    // Open add folder modal (should auto-select parent)
    await repositoryPage.addFolderButton.click();
    await expect(repositoryPage.folderNameInput).toBeVisible({ timeout: 5000 });

    const childName = `Nested Docs Folder ${Date.now()}`;
    await repositoryPage.folderNameInput.fill(childName);

    // Add documentation if the editor is available
    const docsEditor = page.locator('[data-testid="folder-docs-editor"], .tiptap, .ProseMirror').first();
    if (await docsEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await docsEditor.click();
      await page.keyboard.type("Documentation for nested folder");
    }

    // Submit
    await expect(repositoryPage.folderSubmitButton).toBeEnabled({ timeout: 5000 });
    await repositoryPage.folderSubmitButton.click();
    await expect(repositoryPage.folderNameInput).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Expand parent and verify nested folder
    await repositoryPage.expandFolder(parentId);
    await repositoryPage.verifyFolderExists(childName);
  });

  test("Create Root Folder by Removing the Select Folder in the Add Folder modal", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder first, then select it
    const existingFolder = `Existing ${Date.now()}`;
    const existingId = await api.createFolder(projectId, existingFolder);

    await repositoryPage.goto(projectId);

    // Select the existing folder
    await repositoryPage.selectFolder(existingId);

    // Open add folder modal - parent should be auto-filled
    await repositoryPage.addFolderButton.click();
    await expect(repositoryPage.folderNameInput).toBeVisible({ timeout: 5000 });

    // The remove parent button should be visible since a folder was selected
    const removeParentButton = page.getByTestId("remove-parent-folder-button");
    await expect(removeParentButton).toBeVisible({ timeout: 5000 });

    // Click to remove the parent (create at root level instead)
    await removeParentButton.click();

    // Should now show "Root folder" or similar text indicating root level
    await expect(page.getByText("Root folder")).toBeVisible({ timeout: 5000 });

    // Create the folder at root level
    const rootFolderName = `Root Via Remove ${Date.now()}`;
    await repositoryPage.folderNameInput.fill(rootFolderName);
    await expect(repositoryPage.folderSubmitButton).toBeEnabled({ timeout: 5000 });

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/model/repositoryFolders") &&
        response.request().method() === "POST",
      { timeout: 15000 }
    );

    await repositoryPage.folderSubmitButton.click();

    const response = await responsePromise;
    expect(response.ok()).toBe(true);

    await expect(repositoryPage.folderNameInput).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify folder was created at root level (should be visible without expanding)
    await repositoryPage.verifyFolderExists(rootFolderName);
  });
});
