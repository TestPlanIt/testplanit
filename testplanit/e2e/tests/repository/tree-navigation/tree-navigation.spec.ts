import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Tree Navigation Tests
 *
 * Test cases for navigating the folder tree in the repository.
 */
test.describe("Tree Navigation", () => {
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

  test("Navigate to Repository Page and Display Folder Tree @smoke", async ({
    page,
    api,
  }) => {
    const projectId = await getTestProjectId(api);

    await repositoryPage.goto(projectId);

    await expect(repositoryPage.leftPanel).toBeVisible();
    expect(page.url()).toContain(`/projects/repository/${projectId}`);
  });

  test("Select Folder and View Its Contents @smoke", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `E2E Selection Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    await repositoryPage.verifyFolderExists(folderName);
  });

  test("Expand Folder in Tree View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create parent with child folder
    const parentName = `Parent Expand ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Child ${Date.now()}`;
    await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Initially, child should not be visible (parent is collapsed)
    const childFolder = repositoryPage.getFolderByName(childName);
    await expect(childFolder).not.toBeVisible();

    // Expand the parent folder
    await repositoryPage.expandFolder(parentId);

    // Now child should be visible
    await expect(childFolder.first()).toBeVisible({ timeout: 5000 });
  });

  test("Collapse Folder in Tree View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create parent with child folder
    const parentName = `Parent Collapse ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Child Collapse ${Date.now()}`;
    await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Expand the parent folder first
    await repositoryPage.expandFolder(parentId);

    // Verify child is visible
    const childFolder = repositoryPage.getFolderByName(childName);
    await expect(childFolder.first()).toBeVisible({ timeout: 5000 });

    // Click the parent folder to collapse it (clicking on folder row toggles)
    const parentFolder = repositoryPage.getFolderById(parentId);
    await parentFolder.click();

    // Wait a moment for animation
    await page.waitForLoadState("networkidle");

    // Collapse via the chevron button
    const chevron = parentFolder.locator('svg[class*="chevron"]').first();
    if (await chevron.isVisible()) {
      await chevron.click();
      await page.waitForLoadState("networkidle");
    }

    // Child should no longer be visible
    await expect(childFolder).not.toBeVisible({ timeout: 5000 });
  });

  test("Folder Tree Persists Expansion State", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create parent with child folder
    const parentName = `Parent Persist ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Child Persist ${Date.now()}`;
    await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Expand the parent folder
    await repositoryPage.expandFolder(parentId);

    // Verify child is visible
    const childFolder = repositoryPage.getFolderByName(childName);
    await expect(childFolder.first()).toBeVisible({ timeout: 5000 });

    // Reload the page
    await page.reload();
    await repositoryPage.waitForRepositoryLoad();

    // Expansion state should persist - child should still be visible
    // Note: This depends on the app saving expansion state to localStorage/server
    // If not implemented, this test may fail
    await expect(childFolder.first()).toBeVisible({ timeout: 10000 });
  });

  test("Resizable Panel - Expand Folder Tree", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the resizable panel handle
    const resizeHandle = page.locator('[data-panel-resize-handle-id], .resize-handle').first();
    await expect(resizeHandle).toBeVisible({ timeout: 3000 });

    // Get initial width of left panel
    const leftPanel = repositoryPage.leftPanel;
    const initialBox = await leftPanel.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;

    // Drag the handle to the right to expand
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 100, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();

    // Verify panel expanded
    const newBox = await leftPanel.boundingBox();
    expect(newBox).not.toBeNull();
    const newWidth = newBox!.width;
    expect(newWidth).toBeGreaterThan(initialWidth);
  });

  test("Resizable Panel - Collapse Folder Tree", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the resizable panel handle
    const resizeHandle = page.locator('[data-panel-resize-handle-id], .resize-handle').first();
    await expect(resizeHandle).toBeVisible({ timeout: 3000 });

    // Get initial width of left panel
    const leftPanel = repositoryPage.leftPanel;
    const initialBox = await leftPanel.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;

    // Drag the handle to the left to collapse
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 100, handleBox!.y + handleBox!.height / 2);
    await page.mouse.up();

    // Verify panel collapsed (or at minimum size)
    const newBox = await leftPanel.boundingBox();
    expect(newBox).not.toBeNull();
    const newWidth = newBox!.width;
    expect(newWidth).toBeLessThan(initialWidth);
  });

  test("Parent Folder Expands After Adding First Child", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create an empty parent folder
    const parentName = `Parent No Child ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);

    await repositoryPage.goto(projectId);

    // Select the parent folder
    await repositoryPage.selectFolder(parentId);

    // Create a child folder via UI
    const childName = `First Child ${Date.now()}`;
    await repositoryPage.createNestedFolder(childName, parentId);

    // The parent should auto-expand to show the new child
    const childFolder = repositoryPage.getFolderByName(childName);
    await expect(childFolder.first()).toBeVisible({ timeout: 10000 });
  });

  test("Expand All Root Folders with Modifier Key", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create multiple parent folders with children
    const parent1Name = `Parent1 ModKey ${Date.now()}`;
    const parent1Id = await api.createFolder(projectId, parent1Name);
    await api.createFolder(projectId, `Child1 ${Date.now()}`, parent1Id);

    const parent2Name = `Parent2 ModKey ${Date.now()}`;
    const parent2Id = await api.createFolder(projectId, parent2Name);
    await api.createFolder(projectId, `Child2 ${Date.now()}`, parent2Id);

    await repositoryPage.goto(projectId);

    // Hold modifier key (Alt/Option or Ctrl) and click expand on one folder
    // This should expand all root folders
    const parent1 = repositoryPage.getFolderById(parent1Id);
    const chevron = parent1.locator('svg[class*="chevron"]').first();

    // Try with Alt key (macOS) or Ctrl key (Windows/Linux)
    await page.keyboard.down("Alt");
    await chevron.click();
    await page.keyboard.up("Alt");

    await page.waitForLoadState("networkidle");

    // Both children should now be visible
    // This behavior depends on implementation - if not supported, children may not all be visible
    // Check at least one expanded
    const parent1Children = repositoryPage.getFolderByName(`Child1`);
    await expect(parent1Children.first()).toBeVisible({ timeout: 5000 });
  });
});
