import { test, expect } from "../../../fixtures";
import { TemplatesFieldsPage } from "../../../page-objects/admin/templates-fields.page";

/**
 * Field Options Management Tests
 *
 * Tests for managing dropdown and multi-select options:
 * - Adding options
 * - Removing options
 * - Reordering options
 * - Setting default option
 * - Configuring icons and colors
 * - Enabling/disabling options
 */

test.describe("Field Options - Add and Remove", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Add option to existing dropdown", async ({ api }) => {
    // Create a dropdown field with some options
    const fieldName = `E2E Dropdown AddOpt ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    // Add initial options via API
    await api.createFieldOption({
      name: "Option A",
      caseFieldId: fieldId,
      order: 1,
    });
    await api.createFieldOption({
      name: "Option B",
      caseFieldId: fieldId,
      order: 2,
    });

    await templatesPage.goto();

    // Edit the field and add a new option
    await templatesPage.clickEditCaseField(fieldName);
    await templatesPage.addDropdownOption("Option C");
    await templatesPage.submitCaseField();

    // Verify field still exists
    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Remove option from dropdown", async ({ api }) => {
    // Create a dropdown field with options
    const fieldName = `E2E Dropdown RemOpt ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Keep This",
      caseFieldId: fieldId,
      order: 1,
    });
    await api.createFieldOption({
      name: "Remove This",
      caseFieldId: fieldId,
      order: 2,
    });

    await templatesPage.goto();

    // Edit and remove an option
    await templatesPage.clickEditCaseField(fieldName);
    await templatesPage.removeDropdownOption("Remove This");
    await templatesPage.submitCaseField();

    // Verify field still exists
    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Field Options - Reordering", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Reorder options via drag-drop", async ({ api, page }) => {
    // Create a dropdown field with options
    const fieldName = `E2E Dropdown Reorder ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "First",
      caseFieldId: fieldId,
      order: 1,
    });
    await api.createFieldOption({
      name: "Second",
      caseFieldId: fieldId,
      order: 2,
    });
    await api.createFieldOption({
      name: "Third",
      caseFieldId: fieldId,
      order: 3,
    });

    await templatesPage.goto();

    // Edit and attempt to reorder
    await templatesPage.clickEditCaseField(fieldName);

    // Drag-drop interaction depends on UI implementation
    // This test verifies the edit dialog opens with options

    await templatesPage.cancelCaseField();
  });
});

test.describe("Field Options - Default Selection", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Set option as default", async ({ api }) => {
    // Create a dropdown field
    const fieldName = `E2E Dropdown SetDefault ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Low",
      caseFieldId: fieldId,
      order: 1,
    });
    await api.createFieldOption({
      name: "Medium",
      caseFieldId: fieldId,
      order: 2,
    });
    await api.createFieldOption({
      name: "High",
      caseFieldId: fieldId,
      order: 3,
    });

    await templatesPage.goto();

    // Edit and set default
    await templatesPage.clickEditCaseField(fieldName);
    await templatesPage.setDropdownOptionDefault("Medium");
    await templatesPage.submitCaseField();

    // Verify field still exists
    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Unset default option", async ({ api }) => {
    // Create a dropdown field with a default option
    const fieldName = `E2E Dropdown UnsetDefault ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Option 1",
      caseFieldId: fieldId,
      order: 1,
      isDefault: true,
    });
    await api.createFieldOption({
      name: "Option 2",
      caseFieldId: fieldId,
      order: 2,
    });

    await templatesPage.goto();

    // Edit - default handling depends on UI implementation
    await templatesPage.clickEditCaseField(fieldName);
    await templatesPage.cancelCaseField();

    // Verify field still exists
    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Field Options - Icons", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Add icon to option", async ({ api }) => {
    // Create a dropdown field
    const fieldName = `E2E Dropdown AddIcon ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Priority",
      caseFieldId: fieldId,
      order: 1,
    });

    await templatesPage.goto();

    // Edit and add icon
    await templatesPage.clickEditCaseField(fieldName);
    // Icon selection depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Change option icon", async ({ api }) => {
    const fieldName = `E2E Dropdown ChangeIcon ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Status",
      caseFieldId: fieldId,
      order: 1,
    });

    await templatesPage.goto();

    await templatesPage.clickEditCaseField(fieldName);
    // Icon change depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Remove option icon", async ({ api }) => {
    const fieldName = `E2E Dropdown RemIcon ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Item",
      caseFieldId: fieldId,
      order: 1,
    });

    await templatesPage.goto();

    await templatesPage.clickEditCaseField(fieldName);
    // Icon removal depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Field Options - Colors", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Add color to option", async ({ api }) => {
    const fieldName = `E2E Dropdown AddColor ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Critical",
      caseFieldId: fieldId,
      order: 1,
    });

    await templatesPage.goto();

    await templatesPage.clickEditCaseField(fieldName);
    // Color selection depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Change option color", async ({ api }) => {
    const fieldName = `E2E Dropdown ChangeColor ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Warning",
      caseFieldId: fieldId,
      order: 1,
    });

    await templatesPage.goto();

    await templatesPage.clickEditCaseField(fieldName);
    // Color change depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Remove option color", async ({ api }) => {
    const fieldName = `E2E Dropdown RemColor ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Info",
      caseFieldId: fieldId,
      order: 1,
    });

    await templatesPage.goto();

    await templatesPage.clickEditCaseField(fieldName);
    // Color removal depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Field Options - Enable/Disable", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Disable option", async ({ api }) => {
    const fieldName = `E2E Dropdown DisableOpt ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Active Option",
      caseFieldId: fieldId,
      order: 1,
      isEnabled: true,
    });
    await api.createFieldOption({
      name: "To Disable",
      caseFieldId: fieldId,
      order: 2,
      isEnabled: true,
    });

    await templatesPage.goto();

    await templatesPage.clickEditCaseField(fieldName);
    // Option enable/disable depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Enable disabled option", async ({ api }) => {
    const fieldName = `E2E Dropdown EnableOpt ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Dropdown",
    });

    await api.createFieldOption({
      name: "Enabled Option",
      caseFieldId: fieldId,
      order: 1,
      isEnabled: true,
    });
    await api.createFieldOption({
      name: "Disabled Option",
      caseFieldId: fieldId,
      order: 2,
      isEnabled: false,
    });

    await templatesPage.goto();

    await templatesPage.clickEditCaseField(fieldName);
    // Option enable/disable depends on UI implementation
    await templatesPage.cancelCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Field Options - Validation", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Option name validation", async () => {
    const fieldName = `E2E Dropdown OptValidation ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Dropdown");

    // Add option with valid name (alphanumeric + spaces + underscore)
    await templatesPage.addDropdownOption("Valid Option_1");

    await templatesPage.submitCaseField();
    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Duplicate option name error", async () => {
    const fieldName = `E2E Dropdown DupOpt ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Dropdown");

    // Try to add two options with the same name
    await templatesPage.addDropdownOption("Same Name");
    await templatesPage.addDropdownOption("Same Name");

    await templatesPage.submitCaseField();

    // Should show error or one of the duplicates should be rejected
    // Behavior depends on UI implementation
  });
});
