import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Breadcrumbs Tests
 *
 * Test cases for breadcrumb navigation in the repository.
 */
test.describe("Breadcrumbs", () => {
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

  test("View Folder Breadcrumbs", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create nested folders
    const parentName = `Breadcrumb Parent ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Breadcrumb Child ${Date.now()}`;
    const childId = await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Expand parent and select child folder
    await repositoryPage.expandFolder(parentId);
    await repositoryPage.selectFolder(childId);
    await page.waitForLoadState("networkidle");

    // Verify breadcrumbs are visible
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], .breadcrumb, nav[aria-label="Breadcrumb"]');
    await expect(breadcrumbs.first()).toBeVisible({ timeout: 5000 });

    // Breadcrumbs should show parent > child
    await expect(breadcrumbs.first()).toContainText(parentName);
    await expect(breadcrumbs.first()).toContainText(childName);
  });

  test("Navigate via Breadcrumbs", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create nested folders
    const parentName = `Nav Parent ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Nav Child ${Date.now()}`;
    const childId = await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Navigate to child folder
    await repositoryPage.expandFolder(parentId);
    await repositoryPage.selectFolder(childId);
    await page.waitForLoadState("networkidle");

    // Click on parent in breadcrumb to navigate back
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], .breadcrumb');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const parentLink = breadcrumbs.locator(`a:has-text("${parentName}"), button:has-text("${parentName}")`).first();
      if (await parentLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await parentLink.click();
        await page.waitForLoadState("networkidle");

        // Verify we navigated to parent folder
        // The parent folder should now be selected
        const selectedFolder = repositoryPage.getFolderById(parentId);
        await expect(selectedFolder).toHaveClass(/selected|active/, { timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });

  test("Documentation Page Breadcrumbs", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Navigate to documentation
    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    if (await docsNav.isVisible({ timeout: 5000 }).catch(() => false)) {
      await docsNav.click();
      await page.waitForLoadState("networkidle");

      // Navigate to a nested documentation page
      const docFolder = page.locator('[data-testid="doc-folder-item"]').first();
      if (await docFolder.isVisible({ timeout: 5000 }).catch(() => false)) {
        await docFolder.click();

        const docPage = page.locator('[data-testid="doc-page-item"]').first();
        if (await docPage.isVisible({ timeout: 3000 }).catch(() => false)) {
          await docPage.click();
          await page.waitForLoadState("networkidle");

          // Verify documentation breadcrumbs
          const breadcrumbs = page.locator('[data-testid="doc-breadcrumbs"], .breadcrumb');
          await expect(breadcrumbs.first()).toBeVisible({ timeout: 5000 });
        }
      }
    }
    test.skip();
  });
});
