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

  test("Keyboard Shortcut to Add New Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Focus on the folder tree area
    const folderTree = repositoryPage.leftPanel;
    await folderTree.click();

    // Try keyboard shortcut (common shortcuts: Ctrl+N, Ctrl+Shift+N, etc.)
    await page.keyboard.press("Control+Shift+n");

    // Check if add folder modal opened
    const addFolderModal = page.locator('[data-testid="add-folder-modal"], [role="dialog"]:has-text("folder")');
    await expect(addFolderModal).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Escape");
  });
});
