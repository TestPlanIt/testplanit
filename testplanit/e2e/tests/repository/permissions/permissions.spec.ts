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
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
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

  test("Documentation View-Only Permission", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Navigate to documentation
    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    await expect(docsNav).toBeVisible({ timeout: 5000 });
    await docsNav.click();
    await page.waitForLoadState("networkidle");

    // As admin, edit buttons should be visible
    const editButton = page.locator('[data-testid="edit-doc"], button:has-text("Edit")').first();
    await expect(editButton).toBeVisible({ timeout: 5000 });
    // For view-only user, these would be hidden
    // This test validates the admin can see edit options
  });
});
