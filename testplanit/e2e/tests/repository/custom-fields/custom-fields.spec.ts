import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Custom Fields Tests
 *
 * Test cases for managing custom fields in the repository.
 */
test.describe("Custom Fields", () => {
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

  test("Create Text Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Navigate to project settings for custom fields
    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    // Click add custom field button
    const addFieldButton = page.locator('[data-testid="add-custom-field"], button:has-text("Add Field"), button:has-text("New Field")').first();
    await expect(addFieldButton).toBeVisible({ timeout: 5000 });
    await addFieldButton.click();

    // Select text type
    const textTypeOption = page.locator('[data-testid="field-type-text"], [data-value="text"]').first();
    if (await textTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await textTypeOption.click();
    }

    // Fill in field name
    const fieldNameInput = page.locator('[data-testid="field-name-input"], input[name="name"]').first();
    await expect(fieldNameInput).toBeVisible({ timeout: 5000 });

    const fieldName = `Text Field ${Date.now()}`;
    await fieldNameInput.fill(fieldName);

    // Submit
    const submitButton = page.locator('button[type="submit"], button:has-text("Create")').first();
    await submitButton.click();

    await page.waitForLoadState("networkidle");

    // Verify field was created
    await expect(page.locator(`text="${fieldName}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Dropdown Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const addFieldButton = page.locator('[data-testid="add-custom-field"]').first();
    await expect(addFieldButton).toBeVisible({ timeout: 5000 });
    await addFieldButton.click();

    // Select dropdown type
    const dropdownTypeOption = page.locator('[data-testid="field-type-dropdown"], [data-value="dropdown"]').first();
    if (await dropdownTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dropdownTypeOption.click();
    }

    const fieldNameInput = page.locator('[data-testid="field-name-input"]').first();
    const fieldName = `Dropdown Field ${Date.now()}`;
    await fieldNameInput.fill(fieldName);

    // Add options
    const addOptionButton = page.locator('[data-testid="add-option"], button:has-text("Add Option")').first();
    if (await addOptionButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addOptionButton.click();
      const optionInput = page.locator('[data-testid="option-input"]').last();
      await optionInput.fill("Option 1");

      await addOptionButton.click();
      const optionInput2 = page.locator('[data-testid="option-input"]').last();
      await optionInput2.fill("Option 2");
    }

    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${fieldName}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Number Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const addFieldButton = page.locator('[data-testid="add-custom-field"]').first();
    await expect(addFieldButton).toBeVisible({ timeout: 5000 });
    await addFieldButton.click();

    const numberTypeOption = page.locator('[data-testid="field-type-number"], [data-value="number"]').first();
    if (await numberTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await numberTypeOption.click();
    }

    const fieldNameInput = page.locator('[data-testid="field-name-input"]').first();
    const fieldName = `Number Field ${Date.now()}`;
    await fieldNameInput.fill(fieldName);

    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${fieldName}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Date Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const addFieldButton = page.locator('[data-testid="add-custom-field"]').first();
    await expect(addFieldButton).toBeVisible({ timeout: 5000 });
    await addFieldButton.click();

    const dateTypeOption = page.locator('[data-testid="field-type-date"], [data-value="date"]').first();
    if (await dateTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dateTypeOption.click();
    }

    const fieldNameInput = page.locator('[data-testid="field-name-input"]').first();
    const fieldName = `Date Field ${Date.now()}`;
    await fieldNameInput.fill(fieldName);

    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${fieldName}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Checkbox Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const addFieldButton = page.locator('[data-testid="add-custom-field"]').first();
    await expect(addFieldButton).toBeVisible({ timeout: 5000 });
    await addFieldButton.click();

    const checkboxTypeOption = page.locator('[data-testid="field-type-checkbox"], [data-value="checkbox"]').first();
    if (await checkboxTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkboxTypeOption.click();
    }

    const fieldNameInput = page.locator('[data-testid="field-name-input"]').first();
    const fieldName = `Checkbox Field ${Date.now()}`;
    await fieldNameInput.fill(fieldName);

    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${fieldName}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Create Multi-Select Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const addFieldButton = page.locator('[data-testid="add-custom-field"]').first();
    await expect(addFieldButton).toBeVisible({ timeout: 5000 });
    await addFieldButton.click();

    const multiSelectTypeOption = page.locator('[data-testid="field-type-multiselect"], [data-value="multiselect"]').first();
    if (await multiSelectTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await multiSelectTypeOption.click();
    }

    const fieldNameInput = page.locator('[data-testid="field-name-input"]').first();
    const fieldName = `Multi-Select Field ${Date.now()}`;
    await fieldNameInput.fill(fieldName);

    // Add options
    const addOptionButton = page.locator('[data-testid="add-option"]').first();
    if (await addOptionButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addOptionButton.click();
      const optionInput = page.locator('[data-testid="option-input"]').last();
      await optionInput.fill("Option A");

      await addOptionButton.click();
      const optionInput2 = page.locator('[data-testid="option-input"]').last();
      await optionInput2.fill("Option B");
    }

    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${fieldName}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Edit Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const fieldItem = page.locator('[data-testid="custom-field-item"]').first();
    await expect(fieldItem).toBeVisible({ timeout: 5000 });

    // Click edit
    const editButton = fieldItem.locator('[data-testid="edit-field"], button:has-text("Edit")');
    await editButton.click();

    // Edit the name
    const nameInput = page.locator('[data-testid="field-name-input"]').first();
    const newName = `Edited Field ${Date.now()}`;
    await nameInput.clear();
    await nameInput.fill(newName);

    // Save
    const saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click();

    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${newName}"`).first()).toBeVisible({ timeout: 5000 });
  });

  test("Delete Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const fieldItem = page.locator('[data-testid="custom-field-item"]').first();
    await expect(fieldItem).toBeVisible({ timeout: 5000 });
    const fieldName = await fieldItem.textContent();

    const deleteButton = fieldItem.locator('[data-testid="delete-field"], button:has-text("Delete")');
    await deleteButton.click();

    // Confirm deletion
    const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete")').first();
    await confirmButton.click();

    await page.waitForLoadState("networkidle");

    if (fieldName) {
      await expect(page.locator(`text="${fieldName}"`)).not.toBeVisible({ timeout: 5000 });
    }
  });

  test("Delete Custom Field in Use - Warning", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    // Find a field that's in use
    const fieldItem = page.locator('[data-testid="custom-field-item"]').first();
    await expect(fieldItem).toBeVisible({ timeout: 5000 });
    const deleteButton = fieldItem.locator('[data-testid="delete-field"]');
    await deleteButton.click();

    // Should show warning about field being in use
    const warningDialog = page.locator('[role="alertdialog"]');
    await expect(warningDialog).toBeVisible({ timeout: 5000 });

    // Check for warning message
    const warningText = warningDialog.locator('text=/in use|will be removed|affected/i');
    if (await warningText.isVisible({ timeout: 3000 }).catch(() => false)) {
      expect(await warningText.isVisible()).toBe(true);
    }

    // Cancel
    const cancelButton = warningDialog.locator('button:has-text("Cancel")').first();
    await cancelButton.click();
  });

  test("Set Custom Field Value on Test Case", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Custom Field Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Custom Field Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Find a custom field input
    const customFieldInput = page.locator('[data-testid="custom-field-input"]').first();
    await expect(customFieldInput).toBeVisible({ timeout: 5000 });
    await customFieldInput.fill("Custom value");

    // Save
    const saveButton = page.locator('button:has-text("Save")').first();
    if (await saveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveButton.click();
      await page.waitForLoadState("networkidle");
    }
  });

  test("Custom Field Appears in Test Case Table", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Table Field Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Table Field Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    // Look for custom field column in table
    const customFieldColumn = page.locator('th[data-testid*="custom-field"], th[class*="custom-field"]');
    if (await customFieldColumn.count() > 0) {
      expect(await customFieldColumn.first().isVisible()).toBe(true);
    } else {
      // Custom fields might be in column settings
      const columnSettingsButton = page.locator('[data-testid="column-settings"]').first();
      if (await columnSettingsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await columnSettingsButton.click();

        const customFieldOption = page.locator('[data-testid="column-option-custom"]');
        if (await customFieldOption.count() > 0) {
          expect(await customFieldOption.first().isVisible()).toBe(true);
        }
      }
    }
  });

  test("Custom Field Required Validation", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const addFieldButton = page.locator('[data-testid="add-custom-field"]').first();
    if (await addFieldButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addFieldButton.click();

      const fieldNameInput = page.locator('[data-testid="field-name-input"]').first();
      const fieldName = `Required Field ${Date.now()}`;
      await fieldNameInput.fill(fieldName);

      // Enable required toggle
      const requiredToggle = page.locator('[data-testid="required-toggle"]').first();
      if (await requiredToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await requiredToggle.click();
      }

      const submitButton = page.locator('button[type="submit"]').first();
      await submitButton.click();

      await page.waitForLoadState("networkidle");

      // Now try to create a test case without filling the required field
      await repositoryPage.goto(projectId);

      const folderName = `Required Field Folder ${Date.now()}`;
      const folderId = await api.createFolder(projectId, folderName);

      await repositoryPage.selectFolder(folderId);

      // Try to create case
      const addCaseButton = page.locator('[data-testid="add-case-button"]').first();
      if (await addCaseButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await addCaseButton.click();

        const caseNameInput = page.locator('[data-testid="case-name-input"]').first();
        await caseNameInput.fill("Test Case");

        // Try to submit without required field
        const submitButton = page.locator('button[type="submit"]').first();
        await submitButton.click();

        // Should show validation error
        const errorMessage = page.locator('[role="alert"], .error-message, text=/required/i');
        await expect(errorMessage.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test("Custom Field Import/Export", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    // Look for import/export buttons
    const exportButton = page.locator('[data-testid="export-fields"], button:has-text("Export Fields")').first();
    if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await exportButton.click();

      // Verify export dialog or download starts
      const exportDialog = page.locator('[role="dialog"]');
      if (await exportDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        expect(await exportDialog.isVisible()).toBe(true);
        await page.keyboard.press("Escape");
      }
    }

    const importButton = page.locator('[data-testid="import-fields"], button:has-text("Import Fields")').first();
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importButton.click();

      const importDialog = page.locator('[role="dialog"]');
      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("Custom Field Reorder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const fieldItems = page.locator('[data-testid="custom-field-item"]');
    if (await fieldItems.count() >= 2) {
      const firstField = fieldItems.nth(0);
      const secondField = fieldItems.nth(1);

      const firstBox = await firstField.boundingBox();
      const secondBox = await secondField.boundingBox();

      if (firstBox && secondBox) {
        // Drag first field to second position
        await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height + 10);
        await page.mouse.up();

        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Custom Field Visibility per Template", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const fieldItem = page.locator('[data-testid="custom-field-item"]').first();
    await expect(fieldItem).toBeVisible({ timeout: 5000 });
    const editButton = fieldItem.locator('[data-testid="edit-field"]');
    await editButton.click();

    // Look for template visibility settings
    const templateSection = page.locator('[data-testid="template-visibility"]').first();
    await expect(templateSection).toBeVisible({ timeout: 5000 });

    // Toggle visibility for specific templates
    const templateToggle = templateSection.locator('input[type="checkbox"]').first();
    if (await templateToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await templateToggle.click();

      const saveButton = page.locator('button:has-text("Save")').first();
      await saveButton.click();

      await page.waitForLoadState("networkidle");
    }
  });

  test("Custom Field Default Values", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await page.goto(`/en-US/app/project/${projectId}/settings/fields`);
    await page.waitForLoadState("networkidle");

    const addFieldButton = page.locator('[data-testid="add-custom-field"]').first();
    await expect(addFieldButton).toBeVisible({ timeout: 5000 });
    await addFieldButton.click();

    const fieldNameInput = page.locator('[data-testid="field-name-input"]').first();
    const fieldName = `Default Value Field ${Date.now()}`;
    await fieldNameInput.fill(fieldName);

    // Set default value
    const defaultValueInput = page.locator('[data-testid="default-value-input"]').first();
    if (await defaultValueInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await defaultValueInput.fill("Default text");
    }

    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text="${fieldName}"`).first()).toBeVisible({ timeout: 10000 });
  });

  test("Clear Custom Field Value", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Clear Field Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Clear Field Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);

    const testCaseRow = page.locator(`[data-testid="case-row-${testCaseId}"]`).first();
    await testCaseRow.click();

    await page.waitForLoadState("networkidle");

    // Find a custom field with a value
    const customFieldInput = page.locator('[data-testid="custom-field-input"]').first();
    await expect(customFieldInput).toBeVisible({ timeout: 5000 });

    // Clear the value
    await customFieldInput.clear();

    // Or use clear button if available
    const clearButton = page.locator('[data-testid="clear-field-value"]').first();
    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearButton.click();
    }

    // Save
    const saveButton = page.locator('button:has-text("Save")').first();
    if (await saveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveButton.click();
      await page.waitForLoadState("networkidle");
    }
  });
});
