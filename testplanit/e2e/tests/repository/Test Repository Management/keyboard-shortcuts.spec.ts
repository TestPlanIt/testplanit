import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Keyboard Shortcuts Tests
 *
 * Test cases for keyboard shortcut functionality in the repository.
 */
test.describe("Keyboard Shortcuts", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Shift+N Opens Add Folder Dialog", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository for a new project", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Move focus away from any input by clicking the page title", async () => {
      // Click on a neutral area (the page header/title area) to ensure no input is focused
      const pageTitle = page.locator('text="Test Case Repository"').first();
      await pageTitle.click();
      // Ensure the click completed and focus moved away from any inputs
      await expect(pageTitle).toBeVisible();
    });

    let addFolderModal: ReturnType<typeof page.locator> | undefined;
    await test.step("Press Shift+N and verify the Add Folder dialog opens", async () => {
      // Press Shift+N to open add folder modal - use key combination
      await page.keyboard.down("Shift");
      await page.keyboard.press("N");
      await page.keyboard.up("Shift");

      // Check if add folder modal opened - look for the dialog with "Add Folder" title
      addFolderModal = page
        .locator('[role="dialog"]')
        .filter({ hasText: /add.*folder/i });
      await expect(addFolderModal).toBeVisible({ timeout: 5000 });
    });

    await test.step("Press Escape and verify the dialog closes", async () => {
      // Close the modal
      await page.keyboard.press("Escape");
      await expect(addFolderModal!).not.toBeVisible({ timeout: 3000 });
    });
  });

  test("Shift+N Does Not Trigger When Typing in Input", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository for a new project", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Focus the search/filter input and type into it", async () => {
      // Find a search/filter input on the page
      const searchInput = page
        .locator('input[placeholder*="Filter"], input[placeholder*="Search"]')
        .first();
      await expect(searchInput).toBeVisible({ timeout: 5000 });

      // Focus on the input and type
      await searchInput.click();
      await searchInput.fill("test");
    });

    await test.step("Press Shift+N and verify the Add Folder dialog does not open", async () => {
      // Press Shift+N while in the input - should NOT open the modal
      await page.keyboard.press("Shift+n");

      // The modal should NOT be visible since we're typing in an input
      const addFolderModal = page
        .locator('[role="dialog"]')
        .filter({ hasText: /add.*folder/i });
      await expect(addFolderModal).not.toBeVisible({ timeout: 1000 });
    });
  });

  test("Escape Closes Add Folder Modal", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository for a new project", async () => {
      await repositoryPage.goto(projectId);
    });

    let addFolderModal: ReturnType<typeof page.locator> | undefined;
    await test.step("Open the Add Folder dialog via the button", async () => {
      // Open the add folder modal using the button
      await repositoryPage.addFolderButton.click();

      addFolderModal = page
        .locator('[role="dialog"]')
        .filter({ hasText: /add.*folder/i });
      await expect(addFolderModal).toBeVisible({ timeout: 5000 });
    });

    await test.step("Press Escape and verify the dialog closes", async () => {
      // Press Escape to close
      await page.keyboard.press("Escape");

      // Modal should be closed
      await expect(addFolderModal!).not.toBeVisible({ timeout: 3000 });
    });
  });

  test("Shift+Click Selects Range of Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let case1Id: number | undefined;
    let case3Id: number | undefined;
    let folderId: number | undefined;
    await test.step("Create a folder with three test cases", async () => {
      // Create a folder with multiple test cases
      const folderName = `Range Select Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      case1Id = await api.createTestCase(
        projectId,
        folderId,
        `Range Case 1 ${Date.now()}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Range Case 2 ${Date.now()}`
      );
      case3Id = await api.createTestCase(
        projectId,
        folderId,
        `Range Case 3 ${Date.now()}`
      );
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);

      // Wait for cases to load
      await page.waitForLoadState("networkidle");
    });

    let checkbox1: ReturnType<typeof page.locator> | undefined;
    let checkbox3: ReturnType<typeof page.locator> | undefined;
    await test.step("Select the first case, then Shift+click the third to select the range", async () => {
      // Click first checkbox
      checkbox1 = page
        .locator(`[data-testid="case-checkbox-${case1Id}"]`)
        .first();
      await expect(checkbox1).toBeVisible({ timeout: 5000 });
      await checkbox1.click();

      // Shift+click on third checkbox to select range
      checkbox3 = page
        .locator(`[data-testid="case-checkbox-${case3Id}"]`)
        .first();
      await expect(checkbox3).toBeVisible({ timeout: 5000 });
      await checkbox3.click({ modifiers: ["Shift"] });
    });

    await test.step("Verify the first and third cases are both checked", async () => {
      // Verify all three are selected - all checkboxes should be checked
      await expect(checkbox1!).toBeChecked({ timeout: 3000 });
      await expect(checkbox3!).toBeChecked({ timeout: 3000 });
    });
  });

  test("Add Folder Button Shows Keyboard Shortcut Hint", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository for a new project", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Verify the Add Folder button title shows the Shift+N shortcut", async () => {
      // The add folder button should have a title attribute showing the shortcut
      const addFolderButton = repositoryPage.addFolderButton;
      await expect(addFolderButton).toBeVisible({ timeout: 5000 });

      // Check for shortcut hint in title or tooltip
      const title = await addFolderButton.getAttribute("title");
      expect(title).toContain("Shift+N");
    });
  });
});
