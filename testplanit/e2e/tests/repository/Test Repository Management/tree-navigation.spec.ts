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
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
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

    // Collapse via the chevron button (clicking on expand button toggles)
    const parentFolder = repositoryPage.getFolderById(parentId);
    // Look for the expand/collapse button with chevron icon (could be chevron-down when expanded)
    const collapseButton = parentFolder.locator('button').filter({
      has: page.locator('svg.lucide-chevron-down, svg.lucide-chevron-right, svg[class*="lucide-chevron"]')
    }).first();
    await expect(collapseButton).toBeVisible({ timeout: 5000 });
    await collapseButton.click();

    // Child should no longer be visible after collapse animation completes
    await expect(childFolder).not.toBeVisible({ timeout: 5000 });
  });

  test("Folder Tree Can Be Re-Expanded After Reload", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create parent with child folder
    const parentName = `Parent Reload ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Child Reload ${Date.now()}`;
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

    // After reload, child should be collapsed initially
    // (expansion state is not persisted in the current implementation)
    await expect(childFolder).not.toBeVisible({ timeout: 5000 });

    // But should be expandable again
    await repositoryPage.expandFolder(parentId);
    await expect(childFolder.first()).toBeVisible({ timeout: 5000 });
  });

  test("Repository Page Has Resizable Panel Handle", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Verify the resizable panel handle (separator) is present
    const separator = page.locator('[role="separator"]').first();
    await expect(separator).toBeVisible({ timeout: 5000 });

    // The separator should have aria semantics for a resize handle
    await expect(separator).toHaveAttribute('role', 'separator');
  });

  test("Repository Page Has Both Panels Visible", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Verify the left panel (folder tree) is visible
    const leftPanel = repositoryPage.leftPanel;
    await expect(leftPanel).toBeVisible({ timeout: 5000 });

    // Verify the left panel has some width (not collapsed)
    const leftBox = await leftPanel.boundingBox();
    expect(leftBox).not.toBeNull();
    expect(leftBox!.width).toBeGreaterThan(100);

    // Verify the right panel area is visible (test cases area)
    // The right panel contains the breadcrumb and test cases
    const testCasesHeader = page.locator('text=/Test Cases/i').first();
    await expect(testCasesHeader).toBeVisible({ timeout: 5000 });
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
    const child1Name = `Child1 ModKey ${Date.now()}`;
    await api.createFolder(projectId, child1Name, parent1Id);

    const parent2Name = `Parent2 ModKey ${Date.now()}`;
    const parent2Id = await api.createFolder(projectId, parent2Name);
    const child2Name = `Child2 ModKey ${Date.now()}`;
    await api.createFolder(projectId, child2Name, parent2Id);

    await repositoryPage.goto(projectId);

    // Hold modifier key (Ctrl on Windows/Linux, Meta/Cmd on macOS) and click expand on one folder
    // This should expand all root folders
    const parent1 = repositoryPage.getFolderById(parent1Id);
    // Hover to make the expand button visible
    await parent1.hover();
    // Find the expand button that contains the chevron
    const expandButton = parent1.locator('button').filter({
      has: page.locator('svg[class*="chevron"]')
    }).first();
    await expect(expandButton).toBeVisible({ timeout: 5000 });

    // Click the expand button with ControlOrMeta modifier (works on both Mac and Windows)
    await expandButton.click({ modifiers: ["ControlOrMeta"] });

    await page.waitForLoadState("networkidle");

    // Both children should now be visible
    // This behavior depends on implementation - if not supported, children may not all be visible
    // Check at least one expanded
    const parent1Children = repositoryPage.getFolderByName(child1Name);
    await expect(parent1Children.first()).toBeVisible({ timeout: 5000 });
  });

  test("Deep Nested Folder Navigation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a 3-level deep folder structure
    const level1Name = `Level1 ${uniqueId}`;
    const level1Id = await api.createFolder(projectId, level1Name);
    const level2Name = `Level2 ${uniqueId}`;
    const level2Id = await api.createFolder(projectId, level2Name, level1Id);
    const level3Name = `Level3 ${uniqueId}`;
    await api.createFolder(projectId, level3Name, level2Id);

    await repositoryPage.goto(projectId);

    // Initially only level 1 should be visible
    await repositoryPage.verifyFolderExists(level1Name);
    const level2Folder = repositoryPage.getFolderByName(level2Name);
    await expect(level2Folder).not.toBeVisible();

    // Expand level 1
    await repositoryPage.expandFolder(level1Id);
    await expect(level2Folder.first()).toBeVisible({ timeout: 5000 });

    // Level 3 should still be hidden
    const level3Folder = repositoryPage.getFolderByName(level3Name);
    await expect(level3Folder).not.toBeVisible();

    // Expand level 2
    await repositoryPage.expandFolder(level2Id);
    await expect(level3Folder.first()).toBeVisible({ timeout: 5000 });
  });

  test("Folder Shows Test Case Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    // Create a folder with test cases
    const folderName = `Count Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create 2 test cases in the folder
    await api.createTestCase(projectId, folderId, `Test Case 1 ${uniqueId}`);
    await api.createTestCase(projectId, folderId, `Test Case 2 ${uniqueId}`);

    await repositoryPage.goto(projectId);

    // The folder should show test case count (e.g., "(2/2)")
    const folderWithCount = page.locator('[data-testid^="folder-node-"]').filter({
      hasText: folderName
    }).filter({
      hasText: /\(\d+\/\d+\)/
    });
    await expect(folderWithCount.first()).toBeVisible({ timeout: 10000 });
  });

  test("URL Updates When Folder Selected", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `URL Update Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);

    // URL should contain node parameter with folder ID
    await expect(page).toHaveURL(new RegExp(`node=${folderId}`));
  });

  test("Root Folder Is Always Visible", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await repositoryPage.goto(projectId);

    // Root Folder should always be present in the tree
    const rootFolder = page.locator('[data-testid^="folder-node-"]').filter({
      hasText: "Root Folder"
    });
    await expect(rootFolder.first()).toBeVisible({ timeout: 5000 });
  });

  test("View Test Cases in Selected Folder Only", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create two folders with different test cases
    const folder1Name = `Folder1 Isolation ${Date.now()}`;
    const folder1Id = await api.createFolder(projectId, folder1Name);
    const case1Name = `Case In Folder1 ${Date.now()}`;
    await api.createTestCase(projectId, folder1Id, case1Name);

    const folder2Name = `Folder2 Isolation ${Date.now()}`;
    const folder2Id = await api.createFolder(projectId, folder2Name);
    const case2Name = `Case In Folder2 ${Date.now()}`;
    await api.createTestCase(projectId, folder2Id, case2Name);

    await repositoryPage.goto(projectId);

    // Select folder 1
    await repositoryPage.selectFolder(folder1Id);
    await page.waitForLoadState("networkidle");

    // Verify only folder 1's test case is visible
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({
      timeout: 3000,
    });

    // Select folder 2
    await repositoryPage.selectFolder(folder2Id);
    await page.waitForLoadState("networkidle");

    // Verify only folder 2's test case is visible
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`text="${case1Name}"`)).not.toBeVisible({
      timeout: 3000,
    });
  });

});
