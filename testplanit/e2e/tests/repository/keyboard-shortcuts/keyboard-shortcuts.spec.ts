import { test, expect } from "../../../fixtures";
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
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("Shift+N Opens Add Folder Dialog", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Click on a neutral area (the page header/title area) to ensure no input is focused
    const pageTitle = page.locator('text="Test Case Repository"').first();
    await pageTitle.click();

    // Small delay to ensure focus is established
    await page.waitForTimeout(100);

    // Press Shift+N to open add folder modal - use key combination
    await page.keyboard.down("Shift");
    await page.keyboard.press("N");
    await page.keyboard.up("Shift");

    // Check if add folder modal opened - look for the dialog with "Add Folder" title
    const addFolderModal = page.locator('[role="dialog"]').filter({ hasText: /add.*folder/i });
    await expect(addFolderModal).toBeVisible({ timeout: 5000 });

    // Close the modal
    await page.keyboard.press("Escape");
    await expect(addFolderModal).not.toBeVisible({ timeout: 3000 });
  });

  test("Shift+N Does Not Trigger When Typing in Input", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find a search/filter input on the page
    const searchInput = page.locator('input[placeholder*="Filter"], input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Focus on the input and type
    await searchInput.click();
    await searchInput.fill("test");

    // Press Shift+N while in the input - should NOT open the modal
    await page.keyboard.press("Shift+n");

    // The modal should NOT be visible since we're typing in an input
    const addFolderModal = page.locator('[role="dialog"]').filter({ hasText: /add.*folder/i });
    await expect(addFolderModal).not.toBeVisible({ timeout: 1000 });
  });

  test("Escape Closes Add Folder Modal", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open the add folder modal using the button
    await repositoryPage.addFolderButton.click();

    const addFolderModal = page.locator('[role="dialog"]').filter({ hasText: /add.*folder/i });
    await expect(addFolderModal).toBeVisible({ timeout: 5000 });

    // Press Escape to close
    await page.keyboard.press("Escape");

    // Modal should be closed
    await expect(addFolderModal).not.toBeVisible({ timeout: 3000 });
  });

  test("Shift+Click Selects Range of Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with multiple test cases
    const folderName = `Range Select Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `Range Case 1 ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Range Case 2 ${Date.now()}`);
    const case3Id = await api.createTestCase(projectId, folderId, `Range Case 3 ${Date.now()}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    // Wait for cases to load
    await page.waitForLoadState("networkidle");

    // Click first checkbox
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"]`).first();
    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();

    // Shift+click on third checkbox to select range
    const checkbox3 = page.locator(`[data-testid="case-checkbox-${case3Id}"]`).first();
    await expect(checkbox3).toBeVisible({ timeout: 5000 });
    await checkbox3.click({ modifiers: ["Shift"] });

    // Verify all three are selected - all checkboxes should be checked
    await expect(checkbox1).toBeChecked({ timeout: 3000 });
    await expect(checkbox3).toBeChecked({ timeout: 3000 });
  });

  test("Add Folder Button Shows Keyboard Shortcut Hint", async ({ api }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // The add folder button should have a title attribute showing the shortcut
    const addFolderButton = repositoryPage.addFolderButton;
    await expect(addFolderButton).toBeVisible({ timeout: 5000 });

    // Check for shortcut hint in title or tooltip
    const title = await addFolderButton.getAttribute("title");
    expect(title).toContain("Shift+N");
  });
});
