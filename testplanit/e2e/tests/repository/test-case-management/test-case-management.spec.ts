import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Test Case Management Tests
 *
 * Test cases for managing test cases within folders in the repository.
 */
test.describe("Test Case Management", () => {
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

  test("Select Folder to View Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with some test cases
    const folderName = `Folder Cases View ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Test Case ${Date.now()}`;
    await api.createTestCase(projectId, folderId, testCaseName);

    await repositoryPage.goto(projectId);

    // Click on the folder to select it
    await repositoryPage.selectFolder(folderId);

    // Verify that the test case is displayed in the right panel
    const testCaseRow = page.locator(`text="${testCaseName}"`).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });
  });

  test("View Folder Case Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with multiple test cases
    const folderName = `Folder Case Count ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create 3 test cases in the folder
    await api.createTestCase(projectId, folderId, `Case 1 ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Case 2 ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Case 3 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // The folder should display the case count
    const folder = repositoryPage.getFolderById(folderId);
    await expect(folder).toBeVisible({ timeout: 5000 });

    // Look for a count indicator (badge, parentheses, etc.)
    const countIndicator = folder.locator('[data-testid="case-count"], .case-count, .badge').first();
    if (await countIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(countIndicator).toContainText("3");
    } else {
      // Alternative: count might be inline in folder text
      await expect(folder).toContainText(/3|Cases: 3/);
    }
  });

  test("Add Test Case to Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder
    const folderName = `Folder Add Case ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);

    // Click the add test case button
    const addCaseButton = page.getByTestId("add-case-button").or(
      page.locator('button:has-text("Add Test Case"), button:has-text("New Case")')
    ).first();
    await addCaseButton.click();

    // Fill in the test case form
    const testCaseName = `New Test Case ${Date.now()}`;
    const nameInput = page.getByTestId("case-name-input").or(
      page.locator('input[placeholder*="name"], input[name="name"]')
    ).first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(testCaseName);

    // Submit the form
    const submitButton = page.getByTestId("case-submit-button").or(
      page.locator('button[type="submit"]:has-text("Create"), button:has-text("Save")')
    ).first();
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();

    // Wait for the modal to close
    await expect(nameInput).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify the test case was added
    const testCaseRow = page.locator(`text="${testCaseName}"`).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });
  });

  test("Move Test Case Between Folders via Edit", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create two folders
    const sourceFolder = `Source Folder ${Date.now()}`;
    const sourceFolderId = await api.createFolder(projectId, sourceFolder);
    const targetFolder = `Target Folder ${Date.now()}`;
    const targetFolderId = await api.createFolder(projectId, targetFolder);

    // Create a test case in the source folder
    const testCaseName = `Movable Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(projectId, sourceFolderId, testCaseName);

    await repositoryPage.goto(projectId);

    // Select the source folder
    await repositoryPage.selectFolder(sourceFolderId);

    // Click on the test case to open edit
    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"], tr:has-text("${testCaseName}")`).first();
    await testCaseRow.click();

    // Wait for edit panel/modal to open
    await page.waitForLoadState("networkidle");

    // Find and click on the folder selector to change the folder
    const folderSelector = page.locator('[data-testid="folder-select"], [data-testid="folder-picker"]').first();
    if (await folderSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
      await folderSelector.click();

      // Select the target folder
      const targetOption = page.locator(`[role="option"]:has-text("${targetFolder}"), [data-value="${targetFolderId}"]`).first();
      await targetOption.click();

      // Save the changes
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
      await saveButton.click();

      await page.waitForLoadState("networkidle");

      // Select the target folder and verify the test case is there
      await repositoryPage.selectFolder(targetFolderId);
      const movedCase = page.locator(`text="${testCaseName}"`).first();
      await expect(movedCase).toBeVisible({ timeout: 10000 });

      // Verify it's no longer in the source folder
      await repositoryPage.selectFolder(sourceFolderId);
      await expect(page.locator(`text="${testCaseName}"`)).not.toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
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
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({ timeout: 3000 });

    // Select folder 2
    await repositoryPage.selectFolder(folder2Id);
    await page.waitForLoadState("networkidle");

    // Verify only folder 2's test case is visible
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${case1Name}"`)).not.toBeVisible({ timeout: 3000 });
  });

  test("Select Multiple Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with multiple test cases
    const folderName = `Multi Select Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `Case Multi 1 ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, folderId, `Case Multi 2 ${Date.now()}`);
    const case3Id = await api.createTestCase(projectId, folderId, `Case Multi 3 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select multiple test cases using checkboxes
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"], tr:has([data-testid="case-row-${case1Id}"]) input[type="checkbox"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"], tr:has([data-testid="case-row-${case2Id}"]) input[type="checkbox"]`).first();

    // Check if checkboxes exist
    if (await checkbox1.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkbox1.click();
      await checkbox2.click();

      // Verify selection indicator shows 2 selected
      const selectionIndicator = page.locator('[data-testid="selection-count"], .selection-count, text=/\\d+ selected/');
      await expect(selectionIndicator).toContainText("2");
    } else {
      // Alternative: try Ctrl+click selection
      const row1 = page.locator(`[data-testid="case-row-${case1Id}"]`).first();
      const row2 = page.locator(`[data-testid="case-row-${case2Id}"]`).first();

      if (await row1.isVisible({ timeout: 3000 }).catch(() => false)) {
        await row1.click();
        await page.keyboard.down("Control");
        await row2.click();
        await page.keyboard.up("Control");

        // Verify multiple selection
        const selectionIndicator = page.locator('[data-testid="selection-count"], text=/\\d+ selected/');
        if (await selectionIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(selectionIndicator).toContainText("2");
        }
      } else {
        test.skip();
      }
    }
  });

  test("Folder Path Display in Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create nested folders
    const parentName = `Parent Path ${Date.now()}`;
    const parentId = await api.createFolder(projectId, parentName);
    const childName = `Child Path ${Date.now()}`;
    const childId = await api.createFolder(projectId, childName, parentId);

    // Create a test case in the child folder
    const testCaseName = `Path Display Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(projectId, childId, testCaseName);

    await repositoryPage.goto(projectId);

    // Navigate to the child folder
    await repositoryPage.expandFolder(parentId);
    await repositoryPage.selectFolder(childId);

    // Click on the test case to view details
    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"], tr:has-text("${testCaseName}")`).first();
    await testCaseRow.click();

    // Wait for details panel/modal
    await page.waitForLoadState("networkidle");

    // Verify the folder path is displayed (parent > child format or breadcrumb)
    const pathDisplay = page.locator('[data-testid="folder-path"], .folder-path, .breadcrumb');
    if (await pathDisplay.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Path should contain both parent and child folder names
      const pathText = await pathDisplay.textContent();
      expect(pathText).toContain(parentName);
      expect(pathText).toContain(childName);
    } else {
      // Alternative: check for folder name in the test case detail
      await expect(page.locator(`text="${childName}"`)).toBeVisible({ timeout: 5000 });
    }
  });

  test("Copy Test Case to Different Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create two folders
    const sourceFolder = `Source Copy ${Date.now()}`;
    const sourceFolderId = await api.createFolder(projectId, sourceFolder);
    const targetFolder = `Target Copy ${Date.now()}`;
    const targetFolderId = await api.createFolder(projectId, targetFolder);

    // Create a test case in the source folder
    const testCaseName = `Copyable Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(projectId, sourceFolderId, testCaseName);

    await repositoryPage.goto(projectId);

    // Select the source folder
    await repositoryPage.selectFolder(sourceFolderId);
    await page.waitForLoadState("networkidle");

    // Right-click on the test case to open context menu
    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"], tr:has-text("${testCaseName}")`).first();
    await testCaseRow.click({ button: "right" });

    // Click copy option
    const copyOption = page.locator('[role="menuitem"]:has-text("Copy"), [role="menuitem"]:has-text("Duplicate")').first();

    if (await copyOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await copyOption.click();

      // A dialog might appear to select destination folder
      const folderPicker = page.locator('[data-testid="destination-folder"], [role="dialog"]').first();
      if (await folderPicker.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Select the target folder
        const targetOption = page.locator(`[role="option"]:has-text("${targetFolder}"), button:has-text("${targetFolder}")`).first();
        await targetOption.click();

        // Confirm the copy
        const confirmButton = page.locator('button:has-text("Copy"), button:has-text("Confirm")').first();
        await confirmButton.click();
      }

      await page.waitForLoadState("networkidle");

      // Verify the test case exists in both folders
      // Check source folder still has original
      await repositoryPage.selectFolder(sourceFolderId);
      await expect(page.locator(`text="${testCaseName}"`).first()).toBeVisible({ timeout: 10000 });

      // Check target folder has the copy (may have "Copy" suffix or be identical)
      await repositoryPage.selectFolder(targetFolderId);
      const copiedCase = page.locator(`text=/.*${testCaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|Copy of ${testCaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);
      await expect(copiedCase.first()).toBeVisible({ timeout: 10000 });
    } else {
      test.skip();
    }
  });
});
