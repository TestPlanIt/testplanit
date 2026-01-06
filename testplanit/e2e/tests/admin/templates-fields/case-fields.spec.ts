import { test, expect } from "../../../fixtures";
import { TemplatesFieldsPage } from "../../../page-objects/admin/templates-fields.page";

/**
 * Case Fields CRUD Operations Tests
 *
 * Comprehensive tests for all 10 case field types:
 * - Text String
 * - Text Long
 * - Number
 * - Integer
 * - Checkbox
 * - Date
 * - Link
 * - Dropdown
 * - Multi-Select
 * - Steps
 */

test.describe("Case Fields - Table Display", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Case fields table displays correctly", async ({ page }) => {
    // Verify the case fields table is visible
    await expect(templatesPage.caseFieldsTable).toBeVisible();

    // Verify table headers exist
    const headers = templatesPage.caseFieldsTable.locator("th");
    await expect(headers.first()).toBeVisible();

    // Verify Add Case Field button is visible
    await expect(templatesPage.addCaseFieldButton).toBeVisible();
  });

  test("Toggle enabled via table switch", async ({ api }) => {
    // Create an enabled case field
    const fieldName = `E2E Toggle Enabled ${Date.now()}`;
    await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
      isEnabled: true,
    });

    // Reload
    await templatesPage.goto();

    // Toggle enabled state
    await templatesPage.toggleCaseFieldEnabledInTable(fieldName);

    // Wait for update
    await templatesPage.page.waitForLoadState("networkidle");
  });

  test("Toggle required via table switch", async ({ api }) => {
    // Create a case field
    const fieldName = `E2E Toggle Required ${Date.now()}`;
    await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
      isRequired: false,
    });

    // Reload
    await templatesPage.goto();

    // Toggle required state
    await templatesPage.toggleCaseFieldRequiredInTable(fieldName);

    // Wait for update
    await templatesPage.page.waitForLoadState("networkidle");
  });

  test("Toggle restricted via table switch", async ({ api }) => {
    // Create a case field
    const fieldName = `E2E Toggle Restricted ${Date.now()}`;
    await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
      isRestricted: false,
    });

    // Reload
    await templatesPage.goto();

    // Toggle restricted state
    await templatesPage.toggleCaseFieldRestrictedInTable(fieldName);

    // Wait for update
    await templatesPage.page.waitForLoadState("networkidle");
  });
});

test.describe("Case Fields - Text String Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Text String field - basic", async () => {
    const fieldName = `E2E Text String ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text String");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Text String field - with default value", async () => {
    const fieldName = `E2E Text Default ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text String");
    await templatesPage.setCaseFieldDefaultValue("Default text value");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Text String field - with hint", async () => {
    const fieldName = `E2E Text Hint ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text String");
    await templatesPage.fillCaseFieldHint("This is a helpful hint");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Text String field - required", async () => {
    const fieldName = `E2E Text Required ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text String");
    await templatesPage.toggleCaseFieldRequired(true);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Text String field - restricted", async () => {
    const fieldName = `E2E Text Restricted ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text String");
    await templatesPage.toggleCaseFieldRestricted(true);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Edit Text String field", async ({ api }) => {
    const fieldName = `E2E Edit Text ${Date.now()}`;
    await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
    });

    await templatesPage.goto();

    const newName = `E2E Text Updated ${Date.now()}`;
    await templatesPage.clickEditCaseField(fieldName);
    await templatesPage.fillCaseFieldDisplayName(newName);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(newName);
    await templatesPage.expectCaseFieldNotInTable(fieldName);
  });
});

test.describe("Case Fields - Text Long Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Text Long field - basic", async () => {
    const fieldName = `E2E Text Long ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text Long");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Text Long field - with initial height", async () => {
    const fieldName = `E2E Text Long Height ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text Long");
    await templatesPage.setCaseFieldInitialHeight(200);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Text Long field - max height validation", async () => {
    const fieldName = `E2E Text Long Max ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text Long");
    // Max height is 600px
    await templatesPage.setCaseFieldInitialHeight(600);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Case Fields - Number Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Number field - basic", async () => {
    const fieldName = `E2E Number ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Number");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Number field - with min value", async () => {
    const fieldName = `E2E Number Min ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Number");
    // Both min and max must be set together per validation rules
    await templatesPage.setCaseFieldMinValue(0);
    await templatesPage.setCaseFieldMaxValue(1000);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Number field - with max value", async () => {
    const fieldName = `E2E Number Max ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Number");
    // Both min and max must be set together per validation rules
    await templatesPage.setCaseFieldMinValue(-1000);
    await templatesPage.setCaseFieldMaxValue(100);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Number field - with min and max", async () => {
    const fieldName = `E2E Number Range ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Number");
    await templatesPage.setCaseFieldMinValue(0);
    await templatesPage.setCaseFieldMaxValue(100);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Number field min > max validation", async () => {
    const fieldName = `E2E Number Invalid ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Number");
    await templatesPage.setCaseFieldMinValue(100);
    await templatesPage.setCaseFieldMaxValue(0);
    await templatesPage.submitCaseField();

    // Should show validation error
    await templatesPage.expectFormError("min");
  });
});

test.describe("Case Fields - Integer Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Integer field - basic", async () => {
    const fieldName = `E2E Integer ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Integer");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Integer field - with min/max", async () => {
    const fieldName = `E2E Integer Range ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Integer");
    // Integer fields use the same minValue/maxValue keys as Number fields in the UI
    await templatesPage.setCaseFieldMinValue(1);
    await templatesPage.setCaseFieldMaxValue(10);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Integer field min > max validation", async () => {
    const fieldName = `E2E Integer Invalid ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Integer");
    // Integer fields use the same minValue/maxValue keys as Number fields in the UI
    await templatesPage.setCaseFieldMinValue(10);
    await templatesPage.setCaseFieldMaxValue(1);
    await templatesPage.submitCaseField();

    // Should show validation error
    await templatesPage.expectFormError("min");
  });
});

test.describe("Case Fields - Checkbox Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Checkbox field - unchecked default", async () => {
    const fieldName = `E2E Checkbox Unchecked ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Checkbox");
    await templatesPage.setCaseFieldDefaultChecked(false);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Checkbox field - checked default", async () => {
    const fieldName = `E2E Checkbox Checked ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Checkbox");
    await templatesPage.setCaseFieldDefaultChecked(true);
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Case Fields - Date Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Date field - basic", async () => {
    const fieldName = `E2E Date ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Date");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Case Fields - Link Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Link field - basic", async () => {
    const fieldName = `E2E Link ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Link");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  // Note: Link fields don't have a defaultValue option in the seed data
  test.skip("Add Link field - with default value", async () => {
    const fieldName = `E2E Link Default ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Link");
    await templatesPage.setCaseFieldDefaultValue("https://example.com");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Case Fields - Dropdown Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Dropdown field - basic with options", async () => {
    const fieldName = `E2E Dropdown ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Dropdown");
    await templatesPage.addDropdownOption("Option 1");
    await templatesPage.addDropdownOption("Option 2");
    await templatesPage.addDropdownOption("Option 3");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test("Add Dropdown field - with default option", async () => {
    const fieldName = `E2E Dropdown Default ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Dropdown");
    await templatesPage.addDropdownOption("Low");
    await templatesPage.addDropdownOption("Medium");
    await templatesPage.addDropdownOption("High");
    await templatesPage.setDropdownOptionDefault("Medium");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Add Dropdown field - with icons", async () => {
    const fieldName = `E2E Dropdown Icons ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Dropdown");
    await templatesPage.addDropdownOption("Critical");
    // Icon selection depends on UI implementation
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Add Dropdown field - with colors", async () => {
    const fieldName = `E2E Dropdown Colors ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Dropdown");
    await templatesPage.addDropdownOption("Red Item");
    // Color selection depends on UI implementation
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Case Fields - Multi-Select Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Multi-Select field - basic", async () => {
    const fieldName = `E2E MultiSelect ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Multi-Select");
    await templatesPage.addDropdownOption("Tag A");
    await templatesPage.addDropdownOption("Tag B");
    await templatesPage.addDropdownOption("Tag C");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });

  test.skip("Add Multi-Select field - with icons and colors", async () => {
    const fieldName = `E2E MultiSelect Styled ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Multi-Select");
    await templatesPage.addDropdownOption("Category 1");
    await templatesPage.addDropdownOption("Category 2");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Case Fields - Steps Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Steps field - basic", async () => {
    const fieldName = `E2E Steps ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Steps");
    await templatesPage.submitCaseField();

    await templatesPage.expectCaseFieldInTable(fieldName);
  });
});

test.describe("Case Fields - Validation", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("System name auto-generated", async ({ page }) => {
    const fieldName = `E2E Auto Name ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text String");

    // System name should be auto-generated
    const systemNameInput = templatesPage.dialog.locator('input[name="systemName"]').first();
    const systemName = await systemNameInput.inputValue();
    expect(systemName).toBeTruthy();
    expect(systemName.length).toBeGreaterThan(0);

    await templatesPage.cancelCaseField();
  });

  test.skip("System name format validation", async ({ page }) => {
    const fieldName = `E2E Format Test ${Date.now()}`;

    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(fieldName);
    await templatesPage.selectCaseFieldType("Text String");

    // Try to set an invalid system name (starts with number)
    await templatesPage.fillCaseFieldSystemName("123invalid");
    await templatesPage.submitCaseField();

    // Should show validation error or auto-correct
    // Behavior depends on UI implementation
  });

  test.skip("System name uniqueness", async ({ api }) => {
    // Create a field first
    const fieldName = `E2E Unique ${Date.now()}`;
    const systemName = `unique_${Date.now()}`;
    await api.createCaseField({
      displayName: fieldName,
      systemName: systemName,
      typeName: "Text String",
    });

    await templatesPage.goto();

    // Try to create another field with the same system name
    await templatesPage.clickAddCaseField();
    await templatesPage.fillCaseFieldDisplayName(`Another Field ${Date.now()}`);
    await templatesPage.selectCaseFieldType("Text String");
    await templatesPage.fillCaseFieldSystemName(systemName);
    await templatesPage.submitCaseField();

    // Should show uniqueness error
    await templatesPage.expectFormError("exists");
  });
});

test.describe("Case Fields - Delete Operations", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Delete case field", async ({ api }) => {
    const fieldName = `E2E Delete Field ${Date.now()}`;
    await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
    });

    await templatesPage.goto();

    // Verify field exists
    await templatesPage.expectCaseFieldInTable(fieldName);

    // Delete the field
    await templatesPage.clickDeleteCaseField(fieldName);
    await templatesPage.confirmDelete();

    // Verify field is gone
    await templatesPage.expectCaseFieldNotInTable(fieldName);
  });

  test.skip("Delete case field removes from templates", async ({ api }) => {
    // Create a field
    const fieldName = `E2E Field To Remove ${Date.now()}`;
    const fieldId = await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
    });

    // Create a template with that field
    const templateName = `E2E Template With Field ${Date.now()}`;
    await api.createTemplate({
      name: templateName,
      caseFieldIds: [fieldId],
    });

    await templatesPage.goto();

    // Verify template has the field
    let fieldCount = await templatesPage.getTemplateCaseFieldsCount(templateName);
    expect(fieldCount).toBe(1);

    // Delete the field
    await templatesPage.clickDeleteCaseField(fieldName);
    await templatesPage.confirmDelete();

    // Reload and verify template's field count decreased
    await templatesPage.goto();
    fieldCount = await templatesPage.getTemplateCaseFieldsCount(templateName);
    expect(fieldCount).toBe(0);
  });
});
