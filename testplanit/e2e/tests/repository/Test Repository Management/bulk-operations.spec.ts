import { expect, test } from "../../../fixtures";
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
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
  }

  test("Bulk Edit Selected Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Bulk Edit Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `Bulk Edit 1 ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, folderId, `Bulk Edit 2 ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Bulk Edit 3 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Select multiple test cases using their row checkboxes
    // Rows have data-row-id attribute, checkboxes are button[role="checkbox"]
    const row1 = page.locator(`[data-row-id="${case1Id}"]`).first();
    const row2 = page.locator(`[data-row-id="${case2Id}"]`).first();

    const checkbox1 = row1.locator('button[role="checkbox"]').first();
    const checkbox2 = row2.locator('button[role="checkbox"]').first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();

    // Open bulk edit modal
    const bulkEditButton = page.locator('[data-testid="bulk-edit-button"]').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Verify bulk edit modal opens (Dialog component)
    const bulkEditModal = page.getByRole('dialog', { name: /Bulk Edit/i });
    await expect(bulkEditModal).toBeVisible({ timeout: 5000 });

    // Verify it shows count of selected items in the title or content
    // The modal should indicate 2 items are selected
    await expect(bulkEditModal).toContainText(/2/);
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
    const row1 = page.locator(`[data-row-id="${case1Id}"]`).first();
    const row2 = page.locator(`[data-row-id="${case2Id}"]`).first();

    const checkbox1 = row1.locator('button[role="checkbox"]').first();
    const checkbox2 = row2.locator('button[role="checkbox"]').first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();

    // Open bulk edit modal
    const bulkEditButton = page.locator('[data-testid="bulk-edit-button"]').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Wait for modal to open
    const bulkEditModal = page.getByRole('dialog', { name: /Bulk Edit/i });
    await expect(bulkEditModal).toBeVisible({ timeout: 5000 });

    // Enable editing of the "state" field by clicking its checkbox
    // The checkbox has id="edit-state"
    const stateCheckbox = bulkEditModal.locator('#edit-state').first();
    await expect(stateCheckbox).toBeVisible({ timeout: 5000 });
    await stateCheckbox.click();

    // A dropdown or select should now be available to change the state
    // Look for a combobox/dropdown for workflow selection
    const stateDropdown = bulkEditModal.locator('[role="combobox"]').first();
    await expect(stateDropdown).toBeVisible({ timeout: 5000 });
    await stateDropdown.click();

    // Select a state option
    const stateOption = page.locator('[role="option"]').first();
    await expect(stateOption).toBeVisible({ timeout: 3000 });
    await stateOption.click();

    // Save changes
    const saveButton = bulkEditModal.locator('button:has-text("Save")').first();
    await expect(saveButton).toBeVisible({ timeout: 3000 });
    await saveButton.click();

    // Wait for modal to close
    await expect(bulkEditModal).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");
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

    // Wait for test case rows to be visible
    const row1 = page.locator(`[data-row-id="${case1Id}"]`).first();
    const row2 = page.locator(`[data-row-id="${case2Id}"]`).first();
    await expect(row1).toBeVisible({ timeout: 10000 });
    await expect(row2).toBeVisible({ timeout: 10000 });

    // Select test cases
    const checkbox1 = row1.locator('button[role="checkbox"]').first();
    const checkbox2 = row2.locator('button[role="checkbox"]').first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await expect(checkbox2).toBeVisible({ timeout: 5000 });
    await checkbox2.click();

    // Open bulk edit modal (delete is inside the modal)
    const bulkEditButton = page.locator('[data-testid="bulk-edit-button"]').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Wait for modal to open - use a more specific selector for the bulk edit modal
    const bulkEditModal = page.getByRole('dialog', { name: /Bulk Edit/i });
    await expect(bulkEditModal).toBeVisible({ timeout: 5000 });

    // Click delete button in the modal footer (has Trash2 icon and destructive variant)
    const deleteButton = bulkEditModal.locator('button:has(svg.lucide-trash-2)').first();
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Wait for the popover to appear (it renders in a portal outside the dialog)
    const popoverContent = page.locator('[data-radix-popper-content-wrapper]');
    await expect(popoverContent).toBeVisible({ timeout: 5000 });

    // The confirm delete button is inside the popover and has destructive variant with Trash2 icon
    const confirmDeleteButton = popoverContent.locator('button:has(svg.lucide-trash-2)').first();
    await expect(confirmDeleteButton).toBeVisible({ timeout: 5000 });
    await confirmDeleteButton.click();

    // Wait for the bulk edit modal to close (the popover may still be animating out)
    await expect(bulkEditModal).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify test cases are deleted (no longer visible)
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
    const row1 = page.locator(`[data-row-id="${case1Id}"]`).first();
    const row2 = page.locator(`[data-row-id="${case2Id}"]`).first();
    const row3 = page.locator(`[data-row-id="${case3Id}"]`).first();

    const checkbox1 = row1.locator('button[role="checkbox"]').first();
    const checkbox2 = row2.locator('button[role="checkbox"]').first();
    const checkbox3 = row3.locator('button[role="checkbox"]').first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();
    await checkbox3.click();

    // Open bulk edit modal
    const bulkEditButton = page.locator('[data-testid="bulk-edit-button"]').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Wait for modal to open
    const bulkEditModal = page.getByRole('dialog', { name: /Bulk Edit/i });
    await expect(bulkEditModal).toBeVisible({ timeout: 5000 });

    // Click delete button
    const deleteButton = bulkEditModal.locator('button:has(svg.lucide-trash-2)').first();
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Verify confirmation popover shows count (3 cases)
    const popoverContent = page.locator('[data-radix-popper-content-wrapper]');
    await expect(popoverContent).toBeVisible({ timeout: 5000 });
    await expect(popoverContent).toContainText(/3/);

    // Cancel to not actually delete
    const cancelButton = popoverContent.locator('button:has-text("Cancel")').first();
    await cancelButton.click();

    // Popover should close
    await expect(popoverContent).not.toBeVisible({ timeout: 5000 });
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
    const row1 = page.locator(`[data-row-id="${case1Id}"]`).first();
    const row2 = page.locator(`[data-row-id="${case2Id}"]`).first();

    const checkbox1 = row1.locator('button[role="checkbox"]').first();
    const checkbox2 = row2.locator('button[role="checkbox"]').first();

    await expect(checkbox1).toBeVisible({ timeout: 5000 });
    await checkbox1.click();
    await checkbox2.click();

    // Open bulk edit modal
    const bulkEditButton = page.locator('[data-testid="bulk-edit-button"]').first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
    await bulkEditButton.click();

    // Wait for modal to open
    const bulkEditModal = page.getByRole('dialog', { name: /Bulk Edit/i });
    await expect(bulkEditModal).toBeVisible({ timeout: 5000 });

    // Click delete button to open confirmation
    const deleteButton = bulkEditModal.locator('button:has(svg.lucide-trash-2)').first();
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Verify popover shows
    const popoverContent = page.locator('[data-radix-popper-content-wrapper]');
    await expect(popoverContent).toBeVisible({ timeout: 5000 });

    // Cancel
    const cancelButton = popoverContent.locator('button:has-text("Cancel")').first();
    await cancelButton.click();

    // Popover should close
    await expect(popoverContent).not.toBeVisible({ timeout: 5000 });

    // Close modal without saving
    const closeButton = bulkEditModal.locator('button[aria-label="Close"], button:has(svg.lucide-x)').first();
    await closeButton.click();

    // Modal should close
    await expect(bulkEditModal).not.toBeVisible({ timeout: 5000 });

    // Test cases should still exist
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({ timeout: 5000 });
  });

  test("Move Test Cases to Different Folder via Detail Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create source and target folders via API
    const uniqueId = Date.now();
    const sourceFolderName = `Source Folder ${uniqueId}`;
    const targetFolderName = `Target Folder ${uniqueId}`;
    const sourceFolderId = await api.createFolder(projectId, sourceFolderName);
    const targetFolderId = await api.createFolder(projectId, targetFolderName);

    // Create a test case in the source folder via API
    const caseName = `Move Case ${uniqueId}`;
    const caseId = await api.createTestCase(projectId, sourceFolderId, caseName);

    // Navigate to the case detail page
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("networkidle");

    // Verify we are on the detail page
    await expect(page).toHaveURL(
      new RegExp(`/projects/repository/${projectId}/${caseId}`)
    );

    // Click Edit to enter edit mode
    const editButton = page.getByTestId("edit-test-case-button");
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();
    await page.waitForLoadState("networkidle");

    // The FolderSelect (a Radix Select) should be visible in the card title area
    // It renders as a SelectTrigger with role="combobox", showing the current folder name
    // We need to find the one that shows the source folder name (not the project selector)
    const folderSelect = page.locator('[role="combobox"]').filter({
      hasText: sourceFolderName
    }).first();
    await expect(folderSelect).toBeVisible({ timeout: 10000 });
    await folderSelect.click();

    // Wait for select options to appear and click the target folder
    const targetFolderOption = page.locator(`[role="option"]:has-text("${targetFolderName}")`).first();
    await expect(targetFolderOption).toBeVisible({ timeout: 5000 });
    await targetFolderOption.click();

    // Save the changes
    const saveButton = page.locator('button[type="submit"]').first();
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Wait for save to complete — edit button reappears
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // Navigate to the repository page and verify the case appears in the target folder
    const repositoryPage2 = new RepositoryPage(page);
    await repositoryPage2.goto(projectId);
    await repositoryPage2.selectFolder(targetFolderId);
    await page.waitForLoadState("networkidle");

    // The case should now be in the target folder
    await expect(page.locator(`[data-row-id="${caseId}"]`).first()).toBeVisible({ timeout: 10000 });

    // Navigate to the source folder and verify the case is no longer there
    await repositoryPage2.selectFolder(sourceFolderId);
    await page.waitForLoadState("networkidle");

    // The case should NOT be in the source folder anymore
    await expect(page.locator(`[data-row-id="${caseId}"]`)).not.toBeVisible({ timeout: 5000 });
  });

  test("Select All Checkbox in Table Header", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with multiple test cases
    const folderName = `Select All Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(
      projectId,
      folderId,
      `Select All Case 1 ${Date.now()}`
    );
    await api.createTestCase(
      projectId,
      folderId,
      `Select All Case 2 ${Date.now()}`
    );
    await api.createTestCase(
      projectId,
      folderId,
      `Select All Case 3 ${Date.now()}`
    );

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Wait for test cases to be visible in the table before trying to select
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
    const tbody = table.locator("tbody");
    await expect(tbody.locator("tr")).toHaveCount(3, { timeout: 10000 });

    // Find the "Select All" checkbox in the table header
    // The checkbox can be a native input[type="checkbox"] or a Radix checkbox (button[role="checkbox"])
    const headerRow = page.locator("thead tr").first();
    const selectAllCheckbox = headerRow
      .locator('[role="checkbox"], input[type="checkbox"]')
      .first();
    await expect(selectAllCheckbox).toBeVisible({ timeout: 10000 });

    // Click to select all
    await selectAllCheckbox.click();
    await page.waitForLoadState("networkidle");

    // Verify that some rows are now selected by checking if any row checkbox is checked
    // The checkboxes should have aria-checked="true" after selection
    await expect(async () => {
      const checkedCheckboxes = page.locator('tbody [role="checkbox"][aria-checked="true"], tbody input[type="checkbox"]:checked');
      const count = await checkedCheckboxes.count();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // Verify bulk action button appears (indicates items are selected)
    // Either bulk-edit-button or create-test-run-button should appear when items are selected
    await expect(async () => {
      const bulkEditButton = page.locator('[data-testid="bulk-edit-button"]');
      const createRunButton = page.locator('[data-testid="create-test-run-button"]');
      const eitherButtonVisible = await bulkEditButton.isVisible() || await createRunButton.isVisible();
      expect(eitherButtonVisible).toBe(true);
    }).toPass({ timeout: 10000 });
  });
});
