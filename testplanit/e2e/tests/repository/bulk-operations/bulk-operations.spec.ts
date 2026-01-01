import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Bulk Operations Tests
 *
 * Test cases for performing bulk operations on test cases.
 */
test.describe("Bulk Operations", () => {
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

  test("Bulk Edit Selected Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Bulk Edit Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `Bulk Edit 1 ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, folderId, `Bulk Edit 2 ${Date.now()}`);
    const case3Id = await api.createTestCase(projectId, folderId, `Bulk Edit 3 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select multiple test cases
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"], tr:has-text("Bulk Edit 1") input[type="checkbox"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"], tr:has-text("Bulk Edit 2") input[type="checkbox"]`).first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();

    // Open bulk edit menu
    const bulkEditButton = page.locator('[data-testid="bulk-edit"], button:has-text("Bulk Edit"), button:has-text("Edit Selected")').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Verify bulk edit panel opens
    const bulkEditPanel = page.locator('[data-testid="bulk-edit-panel"], [role="dialog"]');
    await expect(bulkEditPanel.first()).toBeVisible({ timeout: 5000 });

    // Verify it shows count of selected items
    const selectionCount = bulkEditPanel.locator('text=/2 (test cases?|items?|selected)/i');
    await expect(selectionCount.first()).toBeVisible({ timeout: 5000 });
  });

  test("Bulk Edit - Change State", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Bulk State Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `Bulk State 1 ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, folderId, `Bulk State 2 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select test cases
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"]`).first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();

    const bulkEditButton = page.locator('[data-testid="bulk-edit"]').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Select "Change State" option
    const stateOption = page.locator('[role="menuitem"]:has-text("State"), [data-testid="bulk-change-state"]').first();
    await expect(stateOption).toBeVisible({ timeout: 3000 });
    await stateOption.click();

    // Select new state
    const stateDropdown = page.locator('[data-testid="state-select"], [role="combobox"]').first();
    await expect(stateDropdown).toBeVisible({ timeout: 3000 });
    await stateDropdown.click();

    const stateChoice = page.locator('[role="option"]').first();
    const stateName = await stateChoice.textContent();
    await stateChoice.click();

    // Apply changes
    const applyButton = page.locator('button:has-text("Apply"), button:has-text("Save")').first();
    await applyButton.click();

    await page.waitForLoadState("networkidle");

    // Verify state was changed (check for success message or state badges)
    if (stateName) {
      const stateIndicator = page.locator(`[data-testid="case-state"]:has-text("${stateName}")`);
      expect(await stateIndicator.count()).toBeGreaterThanOrEqual(2);
    }
  });

  test("Bulk Delete Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Bulk Delete Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Name = `Bulk Delete 1 ${Date.now()}`;
    const case2Name = `Bulk Delete 2 ${Date.now()}`;
    const case1Id = await api.createTestCase(projectId, folderId, case1Name);
    const case2Id = await api.createTestCase(projectId, folderId, case2Name);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select test cases
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"]`).first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();

    // Click delete button
    const deleteButton = page.locator('[data-testid="bulk-delete"], button:has-text("Delete Selected")').first();
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Confirm deletion
    const confirmDialog = page.locator('[role="alertdialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    const confirmButton = confirmDialog.locator('button:has-text("Delete")').first();
    await confirmButton.click();

    await page.waitForLoadState("networkidle");

    // Verify test cases are deleted
    await expect(page.locator(`text="${case1Name}"`)).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({ timeout: 5000 });
  });

  test("Bulk Delete Confirmation Shows Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Bulk Count Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `Bulk Count 1 ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, folderId, `Bulk Count 2 ${Date.now()}`);
    const case3Id = await api.createTestCase(projectId, folderId, `Bulk Count 3 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select all three test cases
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"]`).first();
    const checkbox3 = page.locator(`[data-testid="case-checkbox-${case3Id}"]`).first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();
    await checkbox3.click();

    // Click delete button
    const deleteButton = page.locator('[data-testid="bulk-delete"]').first();
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Verify confirmation shows correct count
    const confirmDialog = page.locator('[role="alertdialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // Should mention 3 items
    const countMessage = confirmDialog.locator('text=/3 (test cases?|items?)/i');
    await expect(countMessage.first()).toBeVisible({ timeout: 5000 });

    // Cancel to not actually delete
    const cancelButton = confirmDialog.locator('button:has-text("Cancel")').first();
    await cancelButton.click();
  });

  test("Cancel Bulk Operation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Cancel Bulk Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Name = `Cancel Bulk 1 ${Date.now()}`;
    const case2Name = `Cancel Bulk 2 ${Date.now()}`;
    const case1Id = await api.createTestCase(projectId, folderId, case1Name);
    const case2Id = await api.createTestCase(projectId, folderId, case2Name);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select test cases
    const checkbox1 = page.locator(`[data-testid="case-checkbox-${case1Id}"]`).first();
    const checkbox2 = page.locator(`[data-testid="case-checkbox-${case2Id}"]`).first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();

    // Open delete dialog
    const deleteButton = page.locator('[data-testid="bulk-delete"]').first();
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    const confirmDialog = page.locator('[role="alertdialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // Cancel
    const cancelButton = confirmDialog.locator('button:has-text("Cancel"), button:has-text("No")').first();
    await cancelButton.click();

    // Dialog should close
    await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });

    // Test cases should still exist
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({ timeout: 5000 });
  });
});
