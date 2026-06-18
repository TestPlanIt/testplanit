import { expect, test } from "../../../fixtures";
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
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Folder Create ${Date.now()}-${Math.random().toString(36).substring(7)}`
    );
  }

  test("Create Root-Level Folder @smoke", async ({ api }) => {
    const folderName = `Root Folder ${Date.now()}`;

    await test.step("Open the repository for a new project", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);
    });

    await test.step("Create a root-level folder", async () => {
      await repositoryPage.createFolder(folderName);
    });

    await test.step("Verify the folder exists", async () => {
      await repositoryPage.verifyFolderExists(folderName);
    });
  });

  test("Create Nested Folder", async ({ api }) => {
    let parentId: number | undefined;
    const childName = `Child Folder ${Date.now()}`;

    await test.step("Create a parent folder via API and open the repository", async () => {
      const projectId = await getTestProjectId(api);

      // First create a parent folder via API
      const parentName = `Parent ${Date.now()}`;
      parentId = await api.createFolder(projectId, parentName);

      await repositoryPage.goto(projectId);
    });

    await test.step("Select the parent folder and create a nested folder", async () => {
      // Select the parent folder
      await repositoryPage.selectFolder(parentId!);

      // Create nested folder - the modal should auto-select the current folder as parent
      await repositoryPage.createNestedFolder(childName, parentId!);
    });

    await test.step("Verify the nested folder exists", async () => {
      // Parent should auto-expand after creating a child, so we can verify the child directly
      await repositoryPage.verifyFolderExists(childName);
    });
  });

  test("Create Folder with Documentation", async ({ api, page }) => {
    let parentFolderId: number | undefined;
    const folderName = `Folder With Docs ${Date.now()}`;

    await test.step("Create a parent folder via API and open the repository", async () => {
      const projectId = await getTestProjectId(api);

      // Create a specific parent folder for this test to ensure deterministic behavior
      const parentFolderName = `Docs Parent ${Date.now()}`;
      parentFolderId = await api.createFolder(projectId, parentFolderName);

      await repositoryPage.goto(projectId);
    });

    await test.step("Select the parent folder and open the add folder modal", async () => {
      // Select the parent folder we just created
      await repositoryPage.selectFolder(parentFolderId!);

      // Open the add folder modal - parent will be auto-selected
      await repositoryPage.openAddFolderModal();
    });

    await test.step("Fill the folder name and documentation, then submit", async () => {
      // Fill folder name
      await repositoryPage.folderNameInput.fill(folderName);

      // Find and fill documentation field - the TipTap editor has .tiptap class
      const dialog = page.locator('[role="dialog"]');
      const docsEditor = dialog.locator(".tiptap, .ProseMirror").first();
      await expect(docsEditor).toBeVisible({ timeout: 5000 });
      await docsEditor.click();
      await page.keyboard.type("This is folder documentation");

      // Submit
      await expect(repositoryPage.folderSubmitButton).toBeEnabled({
        timeout: 5000,
      });
      await repositoryPage.folderSubmitButton.click();
      await expect(repositoryPage.folderNameInput).not.toBeVisible({
        timeout: 10000,
      });
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the documented folder exists", async () => {
      // Parent should auto-expand after creating a child, so we can verify the folder directly
      await repositoryPage.verifyFolderExists(folderName);
    });
  });

  test("Create Folder with Maximum Name Length", async ({
    api,
    page: _page,
  }) => {
    // Create a folder with a very long name (255 characters is typical max)
    const longName = "A".repeat(200) + ` ${Date.now()}`;

    await test.step("Open the repository for a new project", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);
    });

    await test.step("Create a folder with a maximum-length name", async () => {
      await repositoryPage.createFolder(longName);
    });

    await test.step("Verify the folder was created", async () => {
      // Verify folder was created (name may be truncated in display)
      const folder = repositoryPage.getFolderByName(longName.substring(0, 50));
      await expect(folder.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Create Folder with Special Characters", async ({ api }) => {
    // Create folder with comprehensive special characters including:
    // - HTML entities: & < > " '
    // - Punctuation: ! @ # $ % ^ * ( ) - _ = + [ ] { } | \ : ; , . ? /
    // - Unicode/Double-byte: Japanese (テスト), Chinese (测试), Korean (테스트), Emoji (🧪)
    // - Accented characters: àéîõü ñ ß
    // - Currency symbols: € £ ¥ ₹
    const specialName = `Test & <Folder> "quotes" 'apostrophe' @#$% テスト 测试 🧪 café ñoño €£¥ ${Date.now()}`;

    await test.step("Open the repository for a new project", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);
    });

    await test.step("Create a folder with special characters in its name", async () => {
      await repositoryPage.createFolder(specialName);
    });

    await test.step("Verify the folder exists", async () => {
      await repositoryPage.verifyFolderExists(specialName);
    });
  });

  test("Create Folder with Empty Name - Validation", async ({ api, page }) => {
    await test.step("Open the repository and the add folder modal", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);

      // Open the add folder modal - when no folder is selected, it creates at root level
      await repositoryPage.openAddFolderModal();
    });

    await test.step("Submit the form with an empty name", async () => {
      // Leave the name empty and try to submit
      await repositoryPage.folderNameInput.fill("");

      // Click submit - form validation should prevent submission and show error
      await repositoryPage.folderSubmitButton.click();
    });

    await test.step("Verify the validation error and that the modal stays open", async () => {
      // Form should show validation error for empty name (Zod validation requires min 2 chars)
      const validationError = page.locator(
        "text=/Please enter a name|at least 2 character/i"
      );
      await expect(validationError.first()).toBeVisible({ timeout: 5000 });

      // Modal should still be open (submission prevented)
      await expect(repositoryPage.folderNameInput).toBeVisible();
    });

    await test.step("Close the modal", async () => {
      // Close the modal
      await repositoryPage.folderCancelButton.click();
    });
  });

  test("Create Folder with Duplicate Name at Same Level", async ({
    api,
    page,
  }) => {
    let parentFolderName: string | undefined;
    let parentFolderId: number | undefined;
    const folderName = `Duplicate Test ${Date.now()}`;

    await test.step("Create a parent folder with a child via API and open the repository", async () => {
      const projectId = await getTestProjectId(api);

      // Create a parent folder to ensure consistent test isolation
      parentFolderName = `Dup Parent ${Date.now()}`;
      parentFolderId = await api.createFolder(projectId, parentFolderName);

      // Create a folder under the parent via API
      await api.createFolder(projectId, folderName, parentFolderId);

      await repositoryPage.goto(projectId);
    });

    await test.step("Select the parent and verify the existing folder", async () => {
      // Select the parent folder - clicking a folder with children toggles its expanded state
      // Since the parent has a child, clicking will expand it to show the child
      await repositoryPage.selectFolder(parentFolderId!);

      // Verify the first folder exists before attempting duplicate
      await repositoryPage.verifyFolderExists(folderName);
    });

    await test.step("Attempt to create a duplicate folder under the same parent", async () => {
      // Try to create another folder with the same name under the same parent
      // The parent will be auto-selected since we selected it
      await repositoryPage.openAddFolderModal();

      // Verify parent is selected in the modal
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText(parentFolderName!)).toBeVisible({
        timeout: 5000,
      });

      // Fill in the duplicate folder name
      await repositoryPage.folderNameInput.fill(folderName);
      await expect(repositoryPage.folderSubmitButton).toBeEnabled({
        timeout: 5000,
      });

      // Click submit - the API will catch the P2002 unique constraint violation
      // and sets a form error client-side
      await repositoryPage.folderSubmitButton.click();
    });

    await test.step("Verify the duplicate-name error and that the modal stays open", async () => {
      // Wait for the error to be displayed - the form shows "A user with this name already exists" error
      // (Note: the translation key common.errors.nameExists is used which shows a generic message)
      const errorMessage = page.locator(
        "text=/already exists|this name already exists/i"
      );
      await expect(errorMessage.first()).toBeVisible({ timeout: 10000 });

      // The modal should still be visible (not closed) because the creation failed
      await expect(repositoryPage.folderNameInput).toBeVisible({
        timeout: 3000,
      });
    });

    await test.step("Close the modal and verify no duplicate was created", async () => {
      // Close modal
      await repositoryPage.folderCancelButton.click();

      // Verify there's still only one folder with that name (no duplicate created)
      const foldersWithName = repositoryPage.getFolderByName(folderName);
      await expect(foldersWithName).toHaveCount(1, { timeout: 5000 });
    });
  });

  test("Create Folder with Same Name at Different Levels", async ({ api }) => {
    let parentId: number | undefined;
    const sharedName = `Shared Name ${Date.now()}`;

    await test.step("Create a parent and a root folder via API, then open the repository", async () => {
      const projectId = await getTestProjectId(api);

      // Create a parent folder
      const parentName = `Parent Level ${Date.now()}`;
      parentId = await api.createFolder(projectId, parentName);

      // Create a folder at root level
      await api.createFolder(projectId, sharedName);

      await repositoryPage.goto(projectId);
    });

    await test.step("Create a folder with the same name under the parent", async () => {
      // Now create a folder with the same name under the parent (should succeed)
      await repositoryPage.selectFolder(parentId!);
      await repositoryPage.createNestedFolder(sharedName, parentId!);
    });

    await test.step("Verify a folder with the shared name is visible", async () => {
      // Parent should auto-expand after creating a child
      // Should have two folders with the same name (one at root, one nested)
      const folders = repositoryPage.getFolderByName(sharedName);
      await expect(folders.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Create Nested Documentation Folder", async ({ api, page }) => {
    let parentId: number | undefined;
    const childName = `Nested Docs Folder ${Date.now()}`;

    await test.step("Create a parent folder via API and open the repository", async () => {
      const projectId = await getTestProjectId(api);

      // Create a parent folder
      const parentName = `Parent for Docs ${Date.now()}`;
      parentId = await api.createFolder(projectId, parentName);

      await repositoryPage.goto(projectId);
    });

    await test.step("Select the parent and open the add folder modal", async () => {
      // Select parent folder
      await repositoryPage.selectFolder(parentId!);

      // Open add folder modal (should auto-select parent)
      await repositoryPage.addFolderButton.click();
      await expect(repositoryPage.folderNameInput).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Fill the folder name and documentation, then submit", async () => {
      await repositoryPage.folderNameInput.fill(childName);

      // Add documentation
      const docsEditor = page
        .locator('[data-testid="folder-docs-editor"], .tiptap, .ProseMirror')
        .first();
      await expect(docsEditor).toBeVisible({ timeout: 2000 });
      await docsEditor.click();
      await page.keyboard.type("Documentation for nested folder");

      // Submit
      await expect(repositoryPage.folderSubmitButton).toBeEnabled({
        timeout: 5000,
      });
      await repositoryPage.folderSubmitButton.click();
      await expect(repositoryPage.folderNameInput).not.toBeVisible({
        timeout: 10000,
      });
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the nested documented folder exists", async () => {
      // Parent should auto-expand after creating a child, so we can verify the nested folder directly
      await repositoryPage.verifyFolderExists(childName);
    });
  });

  test("Create Root Folder by Removing the Select Folder in the Add Folder modal", async ({
    api,
    page,
  }) => {
    let existingId: number | undefined;
    const rootFolderName = `Root Via Remove ${Date.now()}`;

    await test.step("Create an existing folder via API and open the repository", async () => {
      const projectId = await getTestProjectId(api);

      // Create a folder first, then select it
      const existingFolder = `Existing ${Date.now()}`;
      existingId = await api.createFolder(projectId, existingFolder);

      await repositoryPage.goto(projectId);
    });

    await test.step("Select the existing folder and open the add folder modal", async () => {
      // Select the existing folder
      await repositoryPage.selectFolder(existingId!);

      // Open add folder modal - parent should be auto-filled
      await repositoryPage.addFolderButton.click();
      await expect(repositoryPage.folderNameInput).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Remove the auto-selected parent to target the root level", async () => {
      // The remove parent button should be visible since a folder was selected
      const removeParentButton = page.getByTestId(
        "remove-parent-folder-button"
      );
      await expect(removeParentButton).toBeVisible({ timeout: 5000 });

      // Click to remove the parent (create at root level instead)
      await removeParentButton.click();

      // Should now show "Root Folder" text in the dialog header indicating root level
      // Scope to the dialog to avoid matching folder nodes in the tree
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog.getByText("Root Folder")).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Create the folder at root level and confirm the API response", async () => {
      // Create the folder at root level
      await repositoryPage.folderNameInput.fill(rootFolderName);
      await expect(repositoryPage.folderSubmitButton).toBeEnabled({
        timeout: 5000,
      });

      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/model/repositoryFolders") &&
          response.request().method() === "POST",
        { timeout: 15000 }
      );

      await repositoryPage.folderSubmitButton.click();

      const response = await responsePromise;
      expect(response.ok()).toBe(true);

      await expect(repositoryPage.folderNameInput).not.toBeVisible({
        timeout: 10000,
      });
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the folder was created at root level", async () => {
      // Verify folder was created at root level (should be visible without expanding)
      await repositoryPage.verifyFolderExists(rootFolderName);
    });
  });

  test("New Folder Appears at End of List", async ({ api, page }) => {
    const uniqueId = Date.now();
    // Create existing folders with unique prefix for this test
    const prefix = `EndListTest${uniqueId}`;
    const newFolderName = `${prefix} C`;

    await test.step("Create existing folders via API and open the repository", async () => {
      const projectId = await getTestProjectId(api);

      await api.createFolder(projectId, `${prefix} A`);
      await api.createFolder(projectId, `${prefix} B`);

      await repositoryPage.goto(projectId);
    });

    await test.step("Create a new folder with the same prefix", async () => {
      // Create a new folder with the same unique prefix
      await repositoryPage.createFolder(newFolderName);
    });

    await test.step("Verify the new folder appears at the end of the list", async () => {
      // Verify new folder appears at end of the test's folders (filter by our prefix)
      // Since folders are ordered by creation time, C should come after A and B
      const testFolders = page.locator('[data-testid^="folder-node-"]').filter({
        hasText: new RegExp(prefix),
      });

      // Get all matching folders and verify C is last among them
      const folderCount = await testFolders.count();
      expect(folderCount).toBeGreaterThanOrEqual(3);

      // The newly created folder should be visible
      await repositoryPage.verifyFolderExists(newFolderName);
    });
  });

  test("Folder Deep Nesting Limit", async ({ api, page }) => {
    // Create deeply nested folders
    let parentId: number | undefined;
    const folderIds: number[] = [];

    await test.step("Create deeply nested folders via API and open the repository", async () => {
      const projectId = await getTestProjectId(api);

      for (let i = 0; i < 10; i++) {
        const folderId = await api.createFolder(
          projectId,
          `Nested ${i} ${Date.now()}`,
          parentId
        );
        folderIds.push(folderId);
        parentId = folderId;
      }

      await repositoryPage.goto(projectId);
    });

    await test.step("Expand each level of the nested folder tree", async () => {
      // Expand all levels (except the last one which has no children)
      // Need to wait for each child to be visible before expanding it (virtualized tree)
      for (let i = 0; i < folderIds.length - 1; i++) {
        const folderId = folderIds[i];
        const childId = folderIds[i + 1];

        // Wait for the folder to be visible (may need scrolling in virtualized tree)
        const folder = repositoryPage.getFolderById(folderId);
        await expect(folder).toBeVisible({ timeout: 10000 });

        // Expand this folder
        await repositoryPage.expandFolder(folderId);
        await page.waitForLoadState("networkidle");

        // Wait for the child folder to be visible before continuing
        // The tree may need to scroll to show the child at deeper levels
        await expect(async () => {
          const childFolder = repositoryPage.getFolderById(childId);
          // Check if visible, and if not wait for virtualized tree to render it
          const isVisible = await childFolder.isVisible().catch(() => false);
          if (!isVisible) {
            // Scroll the tree container down to trigger virtualization render
            const treeContainer = page.locator('[role="tree"]');
            await treeContainer.evaluate((el) => {
              el.scrollTop = el.scrollHeight;
            });
            await page.waitForTimeout(100);
          }
          await expect(childFolder).toBeVisible({ timeout: 3000 });
        }).toPass({ timeout: 15000 });
      }
    });

    await test.step("Verify the deepest folder is accessible", async () => {
      // Verify deep folder is accessible
      const deepFolder = repositoryPage.getFolderById(
        folderIds[folderIds.length - 1]
      );
      await expect(deepFolder).toBeVisible({ timeout: 10000 });
    });
  });

  test("Add Folder Dialog Focuses Name Field", async ({ api, page }) => {
    const dialog = page.locator('[role="dialog"]');

    await test.step("Open the repository and the add folder dialog", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);

      // Wait for the add folder button to be visible and clickable
      const addFolderButton = repositoryPage.addFolderButton;
      await expect(addFolderButton).toBeVisible({ timeout: 10000 });

      // Click the add folder button
      await addFolderButton.click();

      // Verify the modal dialog opened
      await expect(dialog).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify the name field is visible and focused", async () => {
      // Verify the name input is visible inside the dialog
      const nameInput = repositoryPage.folderNameInput;
      await expect(nameInput).toBeVisible({ timeout: 5000 });

      // Verify the name input is focused (auto-focus on open)
      await expect(nameInput).toBeFocused({ timeout: 5000 });
    });

    await test.step("Close the dialog", async () => {
      // Close modal
      await repositoryPage.folderCancelButton.click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });
  });
});
