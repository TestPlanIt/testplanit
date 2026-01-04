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

    // Verify breadcrumbs are visible - uses aria-label="breadcrumb" (lowercase)
    const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');
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

    // Verify breadcrumbs are visible
    const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');
    await expect(breadcrumbs).toBeVisible({ timeout: 5000 });

    // Click on parent in breadcrumb to navigate back
    const parentLink = breadcrumbs.locator(`a:has-text("${parentName}")`).first();
    await expect(parentLink).toBeVisible({ timeout: 3000 });
    await parentLink.click();
    await page.waitForLoadState("networkidle");

    // Verify we navigated to parent folder - URL should contain node=parentId
    await expect(page).toHaveURL(new RegExp(`node=${parentId}`), { timeout: 5000 });
  });

  test("Deep Nested Breadcrumbs", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create 3-level nested folders
    const grandparentName = `Grandparent ${Date.now()}`;
    const grandparentId = await api.createFolder(projectId, grandparentName);
    const parentName = `Parent ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName, grandparentId);
    const childName = `Child ${Date.now()}`;
    const childId = await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Navigate to deepest folder
    await repositoryPage.expandFolder(grandparentId);
    await repositoryPage.expandFolder(parentId);
    await repositoryPage.selectFolder(childId);
    await page.waitForLoadState("networkidle");

    // Verify breadcrumbs show full path
    const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');
    await expect(breadcrumbs).toBeVisible({ timeout: 5000 });
    await expect(breadcrumbs).toContainText(grandparentName);
    await expect(breadcrumbs).toContainText(parentName);
    await expect(breadcrumbs).toContainText(childName);
  });
});
