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
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
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

    // Click on the child folder and ensure it's selected
    const childTreeItem = page.getByTestId(`folder-node-${childId}`);
    await expect(childTreeItem).toBeVisible({ timeout: 5000 });
    await childTreeItem.click();
    await page.waitForLoadState("networkidle");

    // Verify URL contains the child folder node
    await expect(page).toHaveURL(new RegExp(`node=${childId}`), { timeout: 5000 });

    // Verify breadcrumbs show both parent and child (proving we're in child folder)
    const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');
    await expect(breadcrumbs).toBeVisible({ timeout: 5000 });
    await expect(breadcrumbs).toContainText(parentName);
    await expect(breadcrumbs).toContainText(childName);

    // Click on parent in breadcrumb to navigate back
    // The breadcrumb uses buttons inside links, so find the button with the parent name
    const parentBreadcrumb = breadcrumbs.getByRole('button', { name: parentName }).first();
    await expect(parentBreadcrumb).toBeVisible({ timeout: 5000 });
    await expect(parentBreadcrumb).toBeEnabled({ timeout: 5000 });
    // Use force click to handle potential DOM re-renders
    await parentBreadcrumb.click({ force: true });
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

    // Navigate to deepest folder - expand each level and wait for children to appear
    await repositoryPage.expandFolder(grandparentId);
    // Wait for parent folder to be visible before expanding it
    await expect(repositoryPage.getFolderById(parentId)).toBeVisible({ timeout: 10000 });

    await repositoryPage.expandFolder(parentId);
    // Wait for child folder to be visible before selecting it
    await expect(repositoryPage.getFolderById(childId)).toBeVisible({ timeout: 10000 });

    await repositoryPage.selectFolder(childId);
    await page.waitForLoadState("networkidle");

    // Verify breadcrumbs show full path
    const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');
    await expect(breadcrumbs).toBeVisible({ timeout: 5000 });
    await expect(breadcrumbs).toContainText(grandparentName, { timeout: 10000 });
    await expect(breadcrumbs).toContainText(parentName, { timeout: 10000 });
    await expect(breadcrumbs).toContainText(childName, { timeout: 10000 });
  });
});
