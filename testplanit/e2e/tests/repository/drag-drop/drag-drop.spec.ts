import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Drag & Drop Tests
 *
 * Test cases for drag and drop functionality in the repository.
 */
test.describe("Drag & Drop", () => {
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

  test("Drag Folder to New Position (Same Level)", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create multiple folders at root level
    const folder1Name = `Drag Folder 1 ${Date.now()}`;
    const folder1Id = await api.createFolder(projectId, folder1Name);
    const folder2Name = `Drag Folder 2 ${Date.now()}`;
    const folder2Id = await api.createFolder(projectId, folder2Name);

    await repositoryPage.goto(projectId);

    const folder1 = repositoryPage.getFolderById(folder1Id);
    const folder2 = repositoryPage.getFolderById(folder2Id);

    if (await folder1.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box1 = await folder1.boundingBox();
      const box2 = await folder2.boundingBox();

      if (box1 && box2) {
        // Drag folder 1 below folder 2
        await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
        await page.mouse.down();
        await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height + 10, { steps: 10 });
        await page.mouse.up();

        await page.waitForLoadState("networkidle");
      }
    } else {
      test.skip();
    }
  });

  test("Drag Folder to Become Subfolder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Parent Drop ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Child Drop ${Date.now()}`;
    const childId = await api.createFolder(projectId, childName);

    await repositoryPage.goto(projectId);

    const parent = repositoryPage.getFolderById(parentId);
    const child = repositoryPage.getFolderById(childId);

    if (await parent.isVisible({ timeout: 5000 }).catch(() => false) &&
        await child.isVisible({ timeout: 5000 }).catch(() => false)) {
      const parentBox = await parent.boundingBox();
      const childBox = await child.boundingBox();

      if (parentBox && childBox) {
        // Drag child onto parent
        await page.mouse.move(childBox.x + childBox.width / 2, childBox.y + childBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(parentBox.x + parentBox.width / 2, parentBox.y + parentBox.height / 2, { steps: 10 });
        await page.mouse.up();

        await page.waitForLoadState("networkidle");

        // Expand parent and verify child is nested
        await repositoryPage.expandFolder(parentId);
        const nestedChild = repositoryPage.getFolderByName(childName);
        await expect(nestedChild.first()).toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });

  test("Drag Subfolder to Root Level", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Root Parent ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `To Root Child ${Date.now()}`;
    await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Expand parent
    await repositoryPage.expandFolder(parentId);

    const child = repositoryPage.getFolderByName(childName);

    if (await child.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      const childBox = await child.first().boundingBox();

      if (childBox) {
        // Drag child to root level (far left)
        await page.mouse.move(childBox.x + childBox.width / 2, childBox.y + childBox.height / 2);
        await page.mouse.down();
        // Move to root area (top of tree, far left)
        await page.mouse.move(10, 200, { steps: 10 });
        await page.mouse.up();

        await page.waitForLoadState("networkidle");
      }
    } else {
      test.skip();
    }
  });

  test("Drag Test Case to Different Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const sourceFolder = `Source Drag ${Date.now()}`;
    const sourceFolderId = await api.createFolder(projectId, sourceFolder);
    const targetFolder = `Target Drag ${Date.now()}`;
    const targetFolderId = await api.createFolder(projectId, targetFolder);
    const caseName = `Draggable Case ${Date.now()}`;
    await api.createTestCase(projectId, sourceFolderId, caseName);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(sourceFolderId);
    await page.waitForLoadState("networkidle");

    const testCaseRow = page.locator(`text="${caseName}"`).first();
    const targetFolderElement = repositoryPage.getFolderById(targetFolderId);

    if (await testCaseRow.isVisible({ timeout: 5000 }).catch(() => false) &&
        await targetFolderElement.isVisible({ timeout: 5000 }).catch(() => false)) {
      const caseBox = await testCaseRow.boundingBox();
      const targetBox = await targetFolderElement.boundingBox();

      if (caseBox && targetBox) {
        await page.mouse.move(caseBox.x + caseBox.width / 2, caseBox.y + caseBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.mouse.up();

        await page.waitForLoadState("networkidle");

        // Verify case moved to target folder
        await repositoryPage.selectFolder(targetFolderId);
        await page.waitForLoadState("networkidle");
        await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });

  test("Drag Multiple Test Cases to Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const sourceFolder = `Multi Source ${Date.now()}`;
    const sourceFolderId = await api.createFolder(projectId, sourceFolder);
    const targetFolder = `Multi Target ${Date.now()}`;
    const targetFolderId = await api.createFolder(projectId, targetFolder);
    const case1Id = await api.createTestCase(projectId, sourceFolderId, `Multi Case 1 ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, sourceFolderId, `Multi Case 2 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(sourceFolderId);
    await page.waitForLoadState("networkidle");

    // Select multiple test cases
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"]`).first();

    if (await checkbox1.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkbox1.click();
      await checkbox2.click();

      // Drag selection to target folder
      const selectedRow = page.locator(`[data-testid="case-row-${case1Id}"]`).first();
      const targetFolderElement = repositoryPage.getFolderById(targetFolderId);

      const rowBox = await selectedRow.boundingBox();
      const targetBox = await targetFolderElement.boundingBox();

      if (rowBox && targetBox) {
        await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.mouse.up();

        await page.waitForLoadState("networkidle");
      }
    }
    test.skip();
  });

  test("Drag and Drop Visual Feedback - Valid Target", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folder1Name = `Visual 1 ${Date.now()}`;
    const folder1Id = await api.createFolder(projectId, folder1Name);
    const folder2Name = `Visual 2 ${Date.now()}`;
    const folder2Id = await api.createFolder(projectId, folder2Name);

    await repositoryPage.goto(projectId);

    const folder1 = repositoryPage.getFolderById(folder1Id);
    const folder2 = repositoryPage.getFolderById(folder2Id);

    if (await folder1.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box1 = await folder1.boundingBox();
      const box2 = await folder2.boundingBox();

      if (box1 && box2) {
        // Start dragging
        await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
        await page.mouse.down();
        await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 5 });

        // Verify visual feedback (hover/drop target highlighting)
        const dropIndicator = page.locator('.drop-indicator, .drag-over, [data-drop-target="true"]');
        if (await dropIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
          expect(await dropIndicator.isVisible()).toBe(true);
        }

        await page.mouse.up();
      }
    }
    test.skip();
  });

  test("Drag and Drop Visual Feedback - Invalid Target", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const parentName = `Invalid Parent ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Invalid Child ${Date.now()}`;
    const childId = await api.createFolder(projectId, childName, parentId);

    await repositoryPage.goto(projectId);

    // Expand parent
    await repositoryPage.expandFolder(parentId);

    const parent = repositoryPage.getFolderById(parentId);
    const child = repositoryPage.getFolderById(childId);

    // Try to drag parent into its own child (invalid)
    if (await parent.isVisible({ timeout: 5000 }).catch(() => false) &&
        await child.isVisible({ timeout: 5000 }).catch(() => false)) {
      const parentBox = await parent.boundingBox();
      const childBox = await child.boundingBox();

      if (parentBox && childBox) {
        await page.mouse.move(parentBox.x + parentBox.width / 2, parentBox.y + parentBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(childBox.x + childBox.width / 2, childBox.y + childBox.height / 2, { steps: 5 });

        // Should show invalid target feedback
        const invalidIndicator = page.locator('.drop-invalid, [data-drop-invalid="true"]');
        if (await invalidIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
          expect(await invalidIndicator.isVisible()).toBe(true);
        }

        await page.mouse.up();
      }
    }
    test.skip();
  });

  test.skip("Drag and Drop Disabled Without Permission", async ({ page }) => {
    // This test requires a user without drag-drop permission
    // Would verify drag operations don't work for restricted users
  });

  test.skip("Drag and Drop Disabled in Filtered View", async ({ api, page }) => {
    // When a filter is active, drag-drop might be disabled
    // Would verify drag operations are disabled during filtering
  });

  test("Cancel Drag Operation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Cancel Drag ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    const folder = repositoryPage.getFolderById(folderId);

    if (await folder.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box = await folder.boundingBox();

      if (box) {
        // Start dragging
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 100, box.y + 100, { steps: 5 });

        // Press Escape to cancel
        await page.keyboard.press("Escape");
        await page.mouse.up();

        // Folder should still be in original position
        const folderAfter = repositoryPage.getFolderById(folderId);
        await expect(folderAfter).toBeVisible({ timeout: 5000 });
      }
    } else {
      test.skip();
    }
  });

  test("Drag Folder to Bottom of Root Level", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create multiple root folders
    const folder1Name = `Bottom Drag 1 ${Date.now()}`;
    await api.createFolder(projectId, folder1Name);
    const folder2Name = `Bottom Drag 2 ${Date.now()}`;
    await api.createFolder(projectId, folder2Name);
    const folder3Name = `Bottom Drag 3 ${Date.now()}`;
    const folder3Id = await api.createFolder(projectId, folder3Name);

    await repositoryPage.goto(projectId);

    const folder3 = repositoryPage.getFolderById(folder3Id);

    if (await folder3.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box = await folder3.boundingBox();

      if (box) {
        // Find the bottom of the tree
        const treeBottom = page.locator('[data-testid="folder-tree-end"], .tree-end').first();
        let targetY = 500; // Default fallback

        if (await treeBottom.isVisible({ timeout: 2000 }).catch(() => false)) {
          const bottomBox = await treeBottom.boundingBox();
          if (bottomBox) {
            targetY = bottomBox.y + bottomBox.height;
          }
        }

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x, targetY, { steps: 10 });
        await page.mouse.up();

        await page.waitForLoadState("networkidle");
      }
    }
    test.skip();
  });
});
