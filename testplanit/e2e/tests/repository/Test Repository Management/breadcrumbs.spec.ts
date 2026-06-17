import { expect, test } from "../../../fixtures";
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
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("View Folder Breadcrumbs", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Breadcrumb Parent ${Date.now()}`;
    const childName = `Breadcrumb Child ${Date.now()}`;
    let parentId: number | undefined;
    let childId: number | undefined;

    await test.step("Create nested parent and child folders", async () => {
      parentId = await api.createFolder(projectId, parentName);
      childId = await api.createFolder(projectId, childName, parentId);
    });

    await test.step("Open repository and select the child folder", async () => {
      await repositoryPage.goto(projectId);

      // Expand parent and select child folder
      await repositoryPage.expandFolder(parentId!);
      await repositoryPage.selectFolder(childId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify breadcrumbs show parent and child", async () => {
      // Verify breadcrumbs are visible - uses aria-label="breadcrumb" (lowercase)
      const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');
      await expect(breadcrumbs.first()).toBeVisible({ timeout: 5000 });

      // Breadcrumbs should show parent > child
      await expect(breadcrumbs.first()).toContainText(parentName);
      await expect(breadcrumbs.first()).toContainText(childName);
    });
  });

  test("Navigate via Breadcrumbs", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Nav Parent ${Date.now()}`;
    const childName = `Nav Child ${Date.now()}`;
    let parentId: number | undefined;
    let childId: number | undefined;

    await test.step("Create nested parent and child folders", async () => {
      parentId = await api.createFolder(projectId, parentName);
      childId = await api.createFolder(projectId, childName, parentId);
    });

    await test.step("Open repository and select the child folder", async () => {
      await repositoryPage.goto(projectId);

      // Navigate to child folder
      await repositoryPage.expandFolder(parentId!);

      // Click on the child folder and ensure it's selected
      const childTreeItem = page.getByTestId(`folder-node-${childId}`);
      await expect(childTreeItem).toBeVisible({ timeout: 5000 });
      await childTreeItem.click();
      await page.waitForLoadState("networkidle");

      // Verify URL contains a node parameter (folder selection)
      await expect(page).toHaveURL(/node=\d+/, { timeout: 5000 });
    });

    const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');

    await test.step("Verify breadcrumbs show both parent and child", async () => {
      // Verify breadcrumbs show both parent and child (proving we're in child folder)
      await expect(breadcrumbs).toBeVisible({ timeout: 5000 });
      await expect(breadcrumbs).toContainText(parentName);
      await expect(breadcrumbs).toContainText(childName);
    });

    await test.step("Click parent breadcrumb to navigate back", async () => {
      // Click on parent in breadcrumb to navigate back
      // BreadcrumbComponent renders clickable items as <Link> (anchor) elements.
      const parentBreadcrumb = breadcrumbs
        .getByRole("link", { name: parentName })
        .first();
      await expect(parentBreadcrumb).toBeVisible({ timeout: 5000 });
      await parentBreadcrumb.click();
      await page.waitForLoadState("networkidle");

      // Verify we navigated to parent folder - URL should contain a node parameter
      await expect(page).toHaveURL(/node=\d+/, { timeout: 5000 });
    });
  });

  test("Deep Nested Breadcrumbs", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const grandparentName = `Grandparent ${Date.now()}`;
    const parentName = `Parent ${Date.now()}`;
    const childName = `Child ${Date.now()}`;
    let grandparentId: number | undefined;
    let parentId: number | undefined;
    let childId: number | undefined;

    await test.step("Create 3-level nested folders", async () => {
      // Create 3-level nested folders
      grandparentId = await api.createFolder(projectId, grandparentName);
      parentId = await api.createFolder(projectId, parentName, grandparentId);
      childId = await api.createFolder(projectId, childName, parentId);
    });

    await test.step("Open repository and navigate to the deepest folder", async () => {
      await repositoryPage.goto(projectId);

      // Navigate to deepest folder - expand each level and wait for children to appear
      await repositoryPage.expandFolder(grandparentId!);
      // Wait for parent folder to be visible before expanding it
      await expect(repositoryPage.getFolderById(parentId!)).toBeVisible({
        timeout: 10000,
      });

      await repositoryPage.expandFolder(parentId!);
      // Wait for child folder to be visible before selecting it
      await expect(repositoryPage.getFolderById(childId!)).toBeVisible({
        timeout: 10000,
      });

      await repositoryPage.selectFolder(childId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify breadcrumbs show the full path", async () => {
      // Verify breadcrumbs show full path
      const breadcrumbs = page.locator('nav[aria-label="breadcrumb"]');
      await expect(breadcrumbs).toBeVisible({ timeout: 5000 });
      await expect(breadcrumbs).toContainText(grandparentName, {
        timeout: 10000,
      });
      await expect(breadcrumbs).toContainText(parentName, { timeout: 10000 });
      await expect(breadcrumbs).toContainText(childName, { timeout: 10000 });
    });
  });
});
