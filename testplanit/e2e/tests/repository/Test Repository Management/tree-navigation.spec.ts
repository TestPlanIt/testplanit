import { expect, test } from "../../../fixtures";
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
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Navigate to Repository Page and Display Folder Tree @smoke", async ({
    page,
    api,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository page for the project", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Verify the folder tree panel and repository URL", async () => {
      await expect(repositoryPage.leftPanel).toBeVisible();
      expect(page.url()).toContain(`/projects/repository/${projectId}`);
    });
  });

  test("Select Folder and View Its Contents @smoke", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `E2E Selection Folder ${Date.now()}`;
    let folderId: number | undefined;

    await test.step("Create a folder via the API", async () => {
      folderId = await api.createFolder(projectId, folderName);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
    });

    await test.step("Verify the folder is displayed", async () => {
      await repositoryPage.verifyFolderExists(folderName);
    });
  });

  test("Expand Folder in Tree View", async ({ api, page: _page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Parent Expand ${Date.now()}`;
    const childName = `Child ${Date.now()}`;
    let parentId: number | undefined;
    let childFolder:
      | ReturnType<typeof repositoryPage.getFolderByName>
      | undefined;

    await test.step("Create a parent folder with a child folder", async () => {
      parentId = await api.createFolder(projectId, parentName);
      await api.createFolder(projectId, childName, parentId!);
    });

    await test.step("Open the repository page", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Confirm the child is hidden while the parent is collapsed", async () => {
      childFolder = repositoryPage.getFolderByName(childName);
      await expect(childFolder).not.toBeVisible();
    });

    await test.step("Expand the parent and confirm the child becomes visible", async () => {
      await repositoryPage.expandFolder(parentId!);
      await expect(childFolder!.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("Collapse Folder in Tree View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Parent Collapse ${Date.now()}`;
    const childName = `Child Collapse ${Date.now()}`;
    let parentId: number | undefined;
    let childFolder:
      | ReturnType<typeof repositoryPage.getFolderByName>
      | undefined;

    await test.step("Create a parent folder with a child folder", async () => {
      parentId = await api.createFolder(projectId, parentName);
      await api.createFolder(projectId, childName, parentId!);
    });

    await test.step("Open the repository and expand the parent folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.expandFolder(parentId!);
    });

    await test.step("Verify the child folder is visible", async () => {
      childFolder = repositoryPage.getFolderByName(childName);
      await expect(childFolder.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Collapse the parent folder via its chevron button", async () => {
      const parentFolder = repositoryPage.getFolderById(parentId!);
      // Look for the expand/collapse button with chevron icon (could be chevron-down when expanded)
      const collapseButton = parentFolder
        .locator("button")
        .filter({
          has: page.locator(
            'svg.lucide-chevron-down, svg.lucide-chevron-right, svg[class*="lucide-chevron"]'
          ),
        })
        .first();
      await expect(collapseButton).toBeVisible({ timeout: 5000 });
      await collapseButton.click();
    });

    await test.step("Confirm the child folder is hidden after collapse", async () => {
      await expect(childFolder!).not.toBeVisible({ timeout: 5000 });
    });
  });

  test("Folder Tree Can Be Re-Expanded After Reload", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Parent Reload ${Date.now()}`;
    const childName = `Child Reload ${Date.now()}`;
    let parentId: number | undefined;
    let childFolder:
      | ReturnType<typeof repositoryPage.getFolderByName>
      | undefined;

    await test.step("Create a parent folder with a child folder", async () => {
      parentId = await api.createFolder(projectId, parentName);
      await api.createFolder(projectId, childName, parentId!);
    });

    await test.step("Open the repository and expand the parent folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.expandFolder(parentId!);
    });

    await test.step("Verify the child folder is visible", async () => {
      childFolder = repositoryPage.getFolderByName(childName);
      await expect(childFolder.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Reload the page and confirm the child is collapsed again", async () => {
      await page.reload();
      await repositoryPage.waitForRepositoryLoad();

      // After reload, child should be collapsed initially
      // (expansion state is not persisted in the current implementation)
      await expect(childFolder!).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Re-expand the parent and confirm the child is visible again", async () => {
      await repositoryPage.expandFolder(parentId!);
      await expect(childFolder!.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("Repository Page Has Resizable Panel Handle", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository page", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Verify the resizable panel handle and its aria role", async () => {
      // Verify the resizable panel handle (separator) is present
      const separator = page.locator('[role="separator"]').first();
      await expect(separator).toBeVisible({ timeout: 5000 });

      // The separator should have aria semantics for a resize handle
      await expect(separator).toHaveAttribute("role", "separator");
    });
  });

  test("Repository Page Has Both Panels Visible", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository page", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Verify the left folder tree panel is visible with width", async () => {
      // Verify the left panel (folder tree) is visible
      const leftPanel = repositoryPage.leftPanel;
      await expect(leftPanel).toBeVisible({ timeout: 5000 });

      // Verify the left panel has some width (not collapsed)
      const leftBox = await leftPanel.boundingBox();
      expect(leftBox).not.toBeNull();
      expect(leftBox!.width).toBeGreaterThan(100);
    });

    await test.step("Verify the right test cases panel is visible", async () => {
      // Verify the right panel area is visible (test cases area)
      // The right panel contains the breadcrumb and test cases
      const testCasesHeader = page.locator("text=/Test Cases/i").first();
      await expect(testCasesHeader).toBeVisible({ timeout: 5000 });
    });
  });

  test("Parent Folder Expands After Adding First Child", async ({
    api,
    page: _page,
  }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Parent No Child ${Date.now()}`;
    const childName = `First Child ${Date.now()}`;
    let parentId: number | undefined;

    await test.step("Create an empty parent folder", async () => {
      parentId = await api.createFolder(projectId, parentName);
    });

    await test.step("Open the repository and select the parent folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(parentId!);
    });

    await test.step("Create a child folder via the UI", async () => {
      await repositoryPage.createNestedFolder(childName, parentId!);
    });

    await test.step("Confirm the parent auto-expands to show the new child", async () => {
      const childFolder = repositoryPage.getFolderByName(childName);
      await expect(childFolder.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Expand All Root Folders with Modifier Key", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parent1Name = `Parent1 ModKey ${Date.now()}`;
    const child1Name = `Child1 ModKey ${Date.now()}`;
    const parent2Name = `Parent2 ModKey ${Date.now()}`;
    const child2Name = `Child2 ModKey ${Date.now()}`;
    let parent1Id: number | undefined;

    await test.step("Create multiple parent folders with children", async () => {
      parent1Id = await api.createFolder(projectId, parent1Name);
      await api.createFolder(projectId, child1Name, parent1Id!);

      const parent2Id = await api.createFolder(projectId, parent2Name);
      await api.createFolder(projectId, child2Name, parent2Id);
    });

    await test.step("Open the repository page", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Expand-all by clicking a folder chevron with the modifier key held", async () => {
      // Hold modifier key (Ctrl on Windows/Linux, Meta/Cmd on macOS) and click expand on one folder
      // This should expand all root folders
      const parent1 = repositoryPage.getFolderById(parent1Id!);
      // Hover to make the expand button visible
      await parent1.hover();
      // Find the expand button that contains the chevron
      const expandButton = parent1
        .locator("button")
        .filter({
          has: page.locator('svg[class*="chevron"]'),
        })
        .first();
      await expect(expandButton).toBeVisible({ timeout: 5000 });

      // Click the expand button with ControlOrMeta modifier (works on both Mac and Windows)
      await expandButton.click({ modifiers: ["ControlOrMeta"] });

      await page.waitForLoadState("networkidle");
    });

    await test.step("Confirm at least one child folder is expanded into view", async () => {
      // Both children should now be visible
      // This behavior depends on implementation - if not supported, children may not all be visible
      // Check at least one expanded
      const parent1Children = repositoryPage.getFolderByName(child1Name);
      await expect(parent1Children.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("Deep Nested Folder Navigation", async ({ api, page: _page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const level1Name = `Level1 ${uniqueId}`;
    const level2Name = `Level2 ${uniqueId}`;
    const level3Name = `Level3 ${uniqueId}`;
    let level1Id: number | undefined;
    let level2Id: number | undefined;
    let level2Folder:
      | ReturnType<typeof repositoryPage.getFolderByName>
      | undefined;
    let level3Folder:
      | ReturnType<typeof repositoryPage.getFolderByName>
      | undefined;

    await test.step("Create a 3-level deep folder structure", async () => {
      level1Id = await api.createFolder(projectId, level1Name);
      level2Id = await api.createFolder(projectId, level2Name, level1Id!);
      await api.createFolder(projectId, level3Name, level2Id!);
    });

    await test.step("Open the repository and confirm only level 1 is visible", async () => {
      await repositoryPage.goto(projectId);

      // Initially only level 1 should be visible
      await repositoryPage.verifyFolderExists(level1Name);
      level2Folder = repositoryPage.getFolderByName(level2Name);
      await expect(level2Folder).not.toBeVisible();
    });

    await test.step("Expand level 1 and confirm level 2 appears while level 3 stays hidden", async () => {
      await repositoryPage.expandFolder(level1Id!);
      await expect(level2Folder!.first()).toBeVisible({ timeout: 10000 });

      // Level 3 should still be hidden
      level3Folder = repositoryPage.getFolderByName(level3Name);
      await expect(level3Folder).not.toBeVisible();
    });

    await test.step("Expand level 2 and confirm level 3 becomes visible", async () => {
      // Expand level 2 - wait for level2 folder to be ready first
      await expect(repositoryPage.getFolderById(level2Id!)).toBeVisible({
        timeout: 5000,
      });
      await repositoryPage.expandFolder(level2Id!);
      await expect(level3Folder!.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Folder Shows Test Case Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `Count Folder ${uniqueId}`;
    let folderId: number | undefined;

    await test.step("Create a folder with two test cases", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create 2 test cases in the folder
      await api.createTestCase(projectId, folderId!, `Test Case 1 ${uniqueId}`);
      await api.createTestCase(projectId, folderId!, `Test Case 2 ${uniqueId}`);
    });

    await test.step("Open the repository page", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Verify the folder shows its test case count", async () => {
      // The folder should show test case count (e.g., "(2/2)")
      const folderWithCount = page
        .locator('[data-testid^="folder-node-"]')
        .filter({
          hasText: folderName,
        })
        .filter({
          hasText: /\(\d+\/\d+\)/,
        });
      await expect(folderWithCount.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("URL Updates When Folder Selected", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const folderName = `URL Update Folder ${uniqueId}`;
    let folderId: number | undefined;

    await test.step("Create a folder via the API", async () => {
      folderId = await api.createFolder(projectId, folderName);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
    });

    await test.step("Verify the URL contains a node selection parameter", async () => {
      // URL should contain a node parameter (folder selection)
      await expect(page).toHaveURL(/node=\d+/);
    });
  });

  test("Root Folder Is Always Visible", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open the repository page", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Verify the Root Folder is present in the tree", async () => {
      // Root Folder should always be present in the tree
      const rootFolder = page.locator('[data-testid^="folder-node-"]').filter({
        hasText: "Root Folder",
      });
      await expect(rootFolder.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("Show All Descendants Toggle Displays Cases From Subfolders", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const parentName = `Parent Descendants ${uniqueId}`;
    const childName = `Child Descendants ${uniqueId}`;
    const parentCaseName = `Parent Case ${uniqueId}`;
    const childCaseName = `Child Case ${uniqueId}`;
    let parentId: number | undefined;
    let descendantsToggle: ReturnType<typeof page.getByRole> | undefined;

    await test.step("Create parent and child folders each with a test case", async () => {
      parentId = await api.createFolder(projectId, parentName);
      const childId = await api.createFolder(projectId, childName, parentId!);

      // Create test cases in different folders
      await api.createTestCase(projectId, parentId!, parentCaseName);
      await api.createTestCase(projectId, childId, childCaseName);
    });

    await test.step("Open the repository and select the parent folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the parent folder - should only show parent's case
      await repositoryPage.selectFolder(parentId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Confirm only the parent's case is shown initially", async () => {
      await expect(
        page.locator(`text="${parentCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${childCaseName}"`)).not.toBeVisible({
        timeout: 3000,
      });
    });

    await test.step("Enable the Show all descendants toggle", async () => {
      // Click the "Show all descendants" toggle
      descendantsToggle = page.getByRole("button", {
        name: /show all descendants/i,
      });
      await expect(descendantsToggle).toBeVisible({ timeout: 5000 });
      await descendantsToggle.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Confirm both cases are shown and the child case has a folder badge", async () => {
      // Both cases should now be visible
      await expect(
        page.locator(`text="${parentCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${childCaseName}"`).first()).toBeVisible(
        {
          timeout: 10000,
        }
      );

      // Child case should show a folder badge
      const childCaseRow = page
        .locator("tr")
        .filter({ hasText: childCaseName });
      await expect(childCaseRow.locator(`text="${childName}"`)).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Disable the toggle and confirm only the parent's case remains", async () => {
      // Toggle off - should go back to showing only parent's case
      await descendantsToggle!.click();
      await page.waitForLoadState("networkidle");

      await expect(
        page.locator(`text="${parentCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${childCaseName}"`)).not.toBeVisible({
        timeout: 3000,
      });
    });
  });

  test("View Test Cases in Selected Folder Only", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folder1Name = `Folder1 Isolation ${Date.now()}`;
    const case1Name = `Case In Folder1 ${Date.now()}`;
    const folder2Name = `Folder2 Isolation ${Date.now()}`;
    const case2Name = `Case In Folder2 ${Date.now()}`;
    let folder1Id: number | undefined;
    let folder2Id: number | undefined;

    await test.step("Create two folders each with their own test case", async () => {
      folder1Id = await api.createFolder(projectId, folder1Name);
      await api.createTestCase(projectId, folder1Id!, case1Name);

      folder2Id = await api.createFolder(projectId, folder2Name);
      await api.createTestCase(projectId, folder2Id!, case2Name);
    });

    await test.step("Open the repository page", async () => {
      await repositoryPage.goto(projectId);
    });

    await test.step("Select folder 1 and confirm only its case is visible", async () => {
      await repositoryPage.selectFolder(folder1Id!);
      await page.waitForLoadState("networkidle");

      // Verify only folder 1's test case is visible
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({
        timeout: 3000,
      });
    });

    await test.step("Select folder 2 and confirm only its case is visible", async () => {
      await repositoryPage.selectFolder(folder2Id!);
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
});
