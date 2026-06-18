import { expect, test } from "../../../fixtures";
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

  test("Case fields table displays correctly", async ({ page: _page }) => {
    await test.step("Verify the case fields table is visible", async () => {
      await expect(templatesPage.caseFieldsTable).toBeVisible();
    });

    await test.step("Verify table headers exist", async () => {
      const headers = templatesPage.caseFieldsTable.locator("th");
      await expect(headers.first()).toBeVisible();
    });

    await test.step("Verify Add Case Field button is visible", async () => {
      await expect(templatesPage.addCaseFieldButton).toBeVisible();
    });
  });

  test("Toggle enabled via table switch", async ({ api, page }) => {
    const fieldName = `E2E Toggle Enabled ${Date.now()}`;

    await test.step("Create an enabled case field", async () => {
      await api.createCaseField({
        displayName: fieldName,
        typeName: "Text String",
        isEnabled: true,
      });
    });

    await test.step("Reload the case fields page", async () => {
      await templatesPage.goto();
    });

    await test.step("Toggle enabled state and wait for update", async () => {
      await templatesPage.toggleCaseFieldEnabledInTable(fieldName);
      await page.waitForLoadState("networkidle");
    });
  });

  test("Toggle required via table switch", async ({ api, page }) => {
    const fieldName = `E2E Toggle Required ${Date.now()}`;

    await test.step("Create a case field", async () => {
      await api.createCaseField({
        displayName: fieldName,
        typeName: "Text String",
        isRequired: false,
      });
    });

    await test.step("Reload the case fields page", async () => {
      await templatesPage.goto();
    });

    await test.step("Toggle required state and wait for update", async () => {
      await templatesPage.toggleCaseFieldRequiredInTable(fieldName);
      await page.waitForLoadState("networkidle");
    });
  });

  test("Toggle restricted via table switch", async ({ api, page }) => {
    const fieldName = `E2E Toggle Restricted ${Date.now()}`;

    await test.step("Create a case field", async () => {
      await api.createCaseField({
        displayName: fieldName,
        typeName: "Text String",
        isRestricted: false,
      });
    });

    await test.step("Reload the case fields page", async () => {
      await templatesPage.goto();
    });

    await test.step("Toggle restricted state and wait for update", async () => {
      await templatesPage.toggleCaseFieldRestrictedInTable(fieldName);
      await page.waitForLoadState("networkidle");
    });
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

    await test.step("Create a Text String case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text String");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Text String field - with default value", async () => {
    const fieldName = `E2E Text Default ${Date.now()}`;

    await test.step("Create a Text String case field with a default value", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text String");
      await templatesPage.setCaseFieldDefaultValue("Default text value");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Text String field - with hint", async () => {
    const fieldName = `E2E Text Hint ${Date.now()}`;

    await test.step("Create a Text String case field with a hint", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text String");
      await templatesPage.fillCaseFieldHint("This is a helpful hint");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Text String field - required", async () => {
    const fieldName = `E2E Text Required ${Date.now()}`;

    await test.step("Create a required Text String case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text String");
      await templatesPage.toggleCaseFieldRequired(true);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Text String field - restricted", async () => {
    const fieldName = `E2E Text Restricted ${Date.now()}`;

    await test.step("Create a restricted Text String case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text String");
      await templatesPage.toggleCaseFieldRestricted(true);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Edit Text String field", async ({ api }) => {
    const fieldName = `E2E Edit Text ${Date.now()}`;
    const newName = `E2E Text Updated ${Date.now()}`;

    await test.step("Create a Text String case field via API", async () => {
      await api.createCaseField({
        displayName: fieldName,
        typeName: "Text String",
      });
    });

    await test.step("Reload the case fields page", async () => {
      await templatesPage.goto();
    });

    await test.step("Edit the field display name", async () => {
      await templatesPage.clickEditCaseField(fieldName);
      await templatesPage.fillCaseFieldDisplayName(newName);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the renamed field replaces the original", async () => {
      await templatesPage.expectCaseFieldInTable(newName);
      await templatesPage.expectCaseFieldNotInTable(fieldName);
    });
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

    await test.step("Create a Text Long case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text Long");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Text Long field - with initial height", async () => {
    const fieldName = `E2E Text Long Height ${Date.now()}`;

    await test.step("Create a Text Long case field with an initial height", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text Long");
      await templatesPage.setCaseFieldInitialHeight(200);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Text Long field - max height validation", async () => {
    const fieldName = `E2E Text Long Max ${Date.now()}`;

    await test.step("Create a Text Long case field at the maximum height", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text Long");
      // Max height is 600px
      await templatesPage.setCaseFieldInitialHeight(600);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
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

    await test.step("Create a Number case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Number");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Number field - with min value", async () => {
    const fieldName = `E2E Number Min ${Date.now()}`;

    await test.step("Create a Number case field with a min value", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Number");
      // Both min and max must be set together per validation rules
      await templatesPage.setCaseFieldMinValue(0);
      await templatesPage.setCaseFieldMaxValue(1000);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Number field - with max value", async () => {
    const fieldName = `E2E Number Max ${Date.now()}`;

    await test.step("Create a Number case field with a max value", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Number");
      // Both min and max must be set together per validation rules
      await templatesPage.setCaseFieldMinValue(-1000);
      await templatesPage.setCaseFieldMaxValue(100);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Number field - with min and max", async () => {
    const fieldName = `E2E Number Range ${Date.now()}`;

    await test.step("Create a Number case field with a min and max range", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Number");
      await templatesPage.setCaseFieldMinValue(0);
      await templatesPage.setCaseFieldMaxValue(100);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Number field min > max validation", async () => {
    const fieldName = `E2E Number Invalid ${Date.now()}`;

    await test.step("Submit a Number case field with min greater than max", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Number");
      await templatesPage.setCaseFieldMinValue(100);
      await templatesPage.setCaseFieldMaxValue(0);
      await templatesPage.clickSubmitCaseField();
    });

    await test.step("Verify the dialog stays open with a validation error and cancel", async () => {
      // Should show validation error - dialog should remain open
      await expect(templatesPage.dialog).toBeVisible({ timeout: 5000 });
      // Cancel to close the dialog
      await templatesPage.cancelCaseField();
    });
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

    await test.step("Create an Integer case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Integer");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Integer field - with min/max", async () => {
    const fieldName = `E2E Integer Range ${Date.now()}`;

    await test.step("Create an Integer case field with a min and max range", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Integer");
      // Integer fields use the same minValue/maxValue keys as Number fields in the UI
      await templatesPage.setCaseFieldMinValue(1);
      await templatesPage.setCaseFieldMaxValue(10);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Integer field min > max validation", async () => {
    const fieldName = `E2E Integer Invalid ${Date.now()}`;

    await test.step("Submit an Integer case field with min greater than max", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Integer");
      // Integer fields use the same minValue/maxValue keys as Number fields in the UI
      await templatesPage.setCaseFieldMinValue(10);
      await templatesPage.setCaseFieldMaxValue(1);
      await templatesPage.clickSubmitCaseField();
    });

    await test.step("Verify the dialog stays open with a validation error and cancel", async () => {
      // Should show validation error - dialog should remain open
      await expect(templatesPage.dialog).toBeVisible({ timeout: 5000 });
      // Cancel to close the dialog
      await templatesPage.cancelCaseField();
    });
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

    await test.step("Create a Checkbox case field defaulting to unchecked", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Checkbox");
      await templatesPage.setCaseFieldDefaultChecked(false);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Checkbox field - checked default", async () => {
    const fieldName = `E2E Checkbox Checked ${Date.now()}`;

    await test.step("Create a Checkbox case field defaulting to checked", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Checkbox");
      await templatesPage.setCaseFieldDefaultChecked(true);
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
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

    await test.step("Create a Date case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Date");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
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

    await test.step("Create a Link case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Link");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
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

    await test.step("Create a Dropdown case field with options", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Dropdown");
      await templatesPage.addDropdownOption("Option 1");
      await templatesPage.addDropdownOption("Option 2");
      await templatesPage.addDropdownOption("Option 3");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Dropdown field - with default option", async () => {
    const fieldName = `E2E Dropdown Default ${Date.now()}`;

    await test.step("Create a Dropdown case field with a default option", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Dropdown");
      await templatesPage.addDropdownOption("Low");
      await templatesPage.addDropdownOption("Medium");
      await templatesPage.addDropdownOption("High");
      await templatesPage.setDropdownOptionDefault("Medium");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Dropdown field - with icons", async () => {
    const fieldName = `E2E Dropdown Icons ${Date.now()}`;

    await test.step("Create a Dropdown case field with an option icon", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Dropdown");
      await templatesPage.addDropdownOption("Critical");
      // Change the icon for the option
      await templatesPage.setDropdownOptionIcon("Critical");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Dropdown field - with colors", async () => {
    const fieldName = `E2E Dropdown Colors ${Date.now()}`;

    await test.step("Create a Dropdown case field with an option color", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Dropdown");
      await templatesPage.addDropdownOption("Red Item");
      // Change the color for the option
      await templatesPage.setDropdownOptionColor("Red Item");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
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

    await test.step("Create a Multi-Select case field with options", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Multi-Select");
      await templatesPage.addDropdownOption("Tag A");
      await templatesPage.addDropdownOption("Tag B");
      await templatesPage.addDropdownOption("Tag C");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });

  test("Add Multi-Select field - with icons and colors", async () => {
    const fieldName = `E2E MultiSelect Styled ${Date.now()}`;

    await test.step("Create a Multi-Select case field with option icons and colors", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Multi-Select");
      await templatesPage.addDropdownOption("Category 1");
      await templatesPage.addDropdownOption("Category 2");
      // Set icon and color for options
      await templatesPage.setDropdownOptionIcon("Category 1");
      await templatesPage.setDropdownOptionColor("Category 2");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
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

    await test.step("Create a Steps case field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Steps");
      await templatesPage.submitCaseField();
    });

    await test.step("Verify the field appears in the table", async () => {
      await templatesPage.expectCaseFieldInTable(fieldName);
    });
  });
});

test.describe("Case Fields - Validation", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("System name auto-generated", async ({ page: _page }) => {
    const fieldName = `E2E Auto Name ${Date.now()}`;

    await test.step("Open the add field dialog for a Text String field", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text String");
    });

    await test.step("Verify the system name is auto-generated, then cancel", async () => {
      // System name should be auto-generated
      const systemNameInput = templatesPage.dialog
        .locator('input[name="systemName"]')
        .first();
      const systemName = await systemNameInput.inputValue();
      expect(systemName).toBeTruthy();
      expect(systemName.length).toBeGreaterThan(0);

      await templatesPage.cancelCaseField();
    });
  });

  test("System name format validation", async () => {
    const fieldName = `E2E Format Test ${Date.now()}`;

    await test.step("Submit a Text String field with an invalid system name", async () => {
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(fieldName);
      await templatesPage.selectCaseFieldType("Text String");
      // Try to set an invalid system name (starts with number)
      await templatesPage.fillCaseFieldSystemName("123invalid");
      await templatesPage.clickSubmitCaseField();
    });

    await test.step("Verify the dialog stays open with a validation error and cancel", async () => {
      // Should show validation error - dialog should remain open
      await expect(templatesPage.dialog).toBeVisible({ timeout: 5000 });
      // Cancel to close the dialog
      await templatesPage.cancelCaseField();
    });
  });

  test("System name uniqueness", async ({ api }) => {
    const fieldName = `E2E Unique ${Date.now()}`;
    const systemName = `unique_${Date.now()}`;

    await test.step("Create a field with a system name via API", async () => {
      await api.createCaseField({
        displayName: fieldName,
        systemName: systemName,
        typeName: "Text String",
      });
    });

    await test.step("Reload the case fields page", async () => {
      await templatesPage.goto();
    });

    await test.step("Submit another field reusing the same system name", async () => {
      // Try to create another field with the same system name
      await templatesPage.clickAddCaseField();
      await templatesPage.fillCaseFieldDisplayName(
        `Another Field ${Date.now()}`
      );
      await templatesPage.selectCaseFieldType("Text String");
      await templatesPage.fillCaseFieldSystemName(systemName);
      await templatesPage.clickSubmitCaseField();
    });

    await test.step("Verify the dialog stays open with a uniqueness error and cancel", async () => {
      // Should show uniqueness error - dialog should remain open
      await expect(templatesPage.dialog).toBeVisible({ timeout: 5000 });
      // Cancel to close the dialog
      await templatesPage.cancelCaseField();
    });
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

    await test.step("Create a case field via API", async () => {
      await api.createCaseField({
        displayName: fieldName,
        typeName: "Text String",
      });
    });

    await test.step("Reload and verify the field exists", async () => {
      await templatesPage.goto();
      // Verify field exists
      await templatesPage.expectCaseFieldInTable(fieldName);
    });

    await test.step("Delete the field", async () => {
      await templatesPage.clickDeleteCaseField(fieldName);
      await templatesPage.confirmDelete();
    });

    await test.step("Verify the field is gone", async () => {
      await templatesPage.expectCaseFieldNotInTable(fieldName);
    });
  });

  test("Delete case field removes from templates", async ({ api, page }) => {
    const fieldName = `E2E Field To Remove ${Date.now()}`;
    const templateName = `E2E Template With Field ${Date.now()}`;
    let fieldId: number | undefined;
    let fieldCount: number | undefined;

    await test.step("Create an enabled case field via API", async () => {
      // Create a field (must be enabled to be assignable)
      fieldId = await api.createCaseField({
        displayName: fieldName,
        typeName: "Text String",
        isEnabled: true,
      });
    });

    await test.step("Create a template that uses the field", async () => {
      // Create a template with that field
      await api.createTemplate({
        name: templateName,
        caseFieldIds: [fieldId!],
      });
    });

    await test.step("Reload and verify the template has the field", async () => {
      await templatesPage.goto();
      // Verify template has the field
      fieldCount = await templatesPage.getTemplateCaseFieldsCount(templateName);
      expect(fieldCount).toBe(1);
    });

    await test.step("Delete the field and wait for deletion", async () => {
      await templatesPage.clickDeleteCaseField(fieldName);
      await templatesPage.confirmDelete();
      // Wait for deletion to complete
      await page.waitForTimeout(500);
    });

    await test.step("Reload and verify the template's field count decreased", async () => {
      // Reload and verify template's field count decreased
      await templatesPage.goto();
      await page.waitForTimeout(500);
      fieldCount = await templatesPage.getTemplateCaseFieldsCount(templateName);
      expect(fieldCount).toBe(0);
    });
  });
});
