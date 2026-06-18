import { expect, test } from "../../../fixtures";
import { TemplatesFieldsPage } from "../../../page-objects/admin/templates-fields.page";

/**
 * Result Fields CRUD Operations Tests
 *
 * Comprehensive tests for all 9 result field types (Steps excluded):
 * - Text String
 * - Text Long
 * - Number
 * - Integer
 * - Checkbox
 * - Date
 * - Link
 * - Dropdown
 * - Multi-Select
 */

test.describe("Result Fields - Table Display", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Result fields table displays correctly", async ({ page: _page }) => {
    await test.step("Verify the result fields table is visible", async () => {
      await expect(templatesPage.resultFieldsTable).toBeVisible();
    });

    await test.step("Verify table headers exist", async () => {
      const headers = templatesPage.resultFieldsTable.locator("th");
      await expect(headers.first()).toBeVisible();
    });

    await test.step("Verify Add Result Field button is visible", async () => {
      await expect(templatesPage.addResultFieldButton).toBeVisible();
    });
  });

  test("Toggle enabled/required/restricted", async ({ api }) => {
    const fieldName = `E2E Result Toggle ${Date.now()}`;

    await test.step("Create a result field and open the table", async () => {
      await api.createResultField({
        displayName: fieldName,
        typeName: "Text String",
        isEnabled: true,
        isRequired: false,
        isRestricted: false,
      });

      await templatesPage.goto();
    });

    await test.step("Toggle enabled", async () => {
      await templatesPage.toggleResultFieldEnabledInTable(fieldName);
      await templatesPage.waitForPageLoad();
    });

    await test.step("Toggle required", async () => {
      await templatesPage.toggleResultFieldRequiredInTable(fieldName);
      await templatesPage.waitForPageLoad();
    });

    await test.step("Toggle restricted", async () => {
      await templatesPage.toggleResultFieldRestrictedInTable(fieldName);
      await templatesPage.waitForPageLoad();
    });
  });
});

test.describe("Result Fields - Text String Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Text String result field - basic", async () => {
    const fieldName = `E2E Result Text ${Date.now()}`;

    await test.step("Create a Text String result field", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Text String");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Text String result field - with default value", async () => {
    const fieldName = `E2E Result Text Default ${Date.now()}`;

    await test.step("Create a Text String result field with a default value", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Text String");
      await templatesPage.setResultFieldDefaultValue("Default result text");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Text String result field - required", async () => {
    const fieldName = `E2E Result Text Required ${Date.now()}`;

    await test.step("Create a required Text String result field", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Text String");
      await templatesPage.toggleResultFieldRequired(true);
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Edit Text String result field", async ({ api }) => {
    const fieldName = `E2E Edit Result Text ${Date.now()}`;
    const newName = `E2E Result Text Updated ${Date.now()}`;

    await test.step("Create a Text String result field and open the table", async () => {
      await api.createResultField({
        displayName: fieldName,
        typeName: "Text String",
      });

      await templatesPage.goto();
    });

    await test.step("Rename the result field", async () => {
      await templatesPage.clickEditResultField(fieldName);
      await templatesPage.fillResultFieldDisplayName(newName);
      await templatesPage.submitResultField();
    });

    await test.step("Verify the table shows the new name and not the old one", async () => {
      await templatesPage.expectResultFieldInTable(newName);
      await templatesPage.expectResultFieldNotInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Text Long Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Text Long result field - basic", async () => {
    const fieldName = `E2E Result Long ${Date.now()}`;

    await test.step("Create a Text Long result field", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Text Long");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Text Long result field - with initial height", async () => {
    const fieldName = `E2E Result Long Height ${Date.now()}`;

    await test.step("Create a Text Long result field with an initial height", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Text Long");
      await templatesPage.setResultFieldInitialHeight(300);
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Number Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Number result field - basic", async () => {
    const fieldName = `E2E Result Number ${Date.now()}`;

    await test.step("Create a Number result field", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Number");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Number result field - with min/max", async () => {
    const fieldName = `E2E Result Number Range ${Date.now()}`;

    await test.step("Create a Number result field with min and max values", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Number");
      await templatesPage.setResultFieldMinValue(0);
      await templatesPage.setResultFieldMaxValue(100);
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Number result field validation", async () => {
    const fieldName = `E2E Result Number Invalid ${Date.now()}`;

    await test.step("Submit a Number result field with min greater than max", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Number");
      await templatesPage.setResultFieldMinValue(100);
      await templatesPage.setResultFieldMaxValue(0);
      await templatesPage.clickSubmitResultField();
    });

    await test.step("Verify the validation error keeps the dialog open, then cancel", async () => {
      // Should show validation error - dialog should remain open
      await expect(templatesPage.dialog).toBeVisible({ timeout: 5000 });
      // Cancel to close the dialog
      await templatesPage.cancelResultField();
    });
  });
});

test.describe("Result Fields - Integer Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Integer result field - basic", async () => {
    const fieldName = `E2E Result Integer ${Date.now()}`;

    await test.step("Create an Integer result field", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Integer");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Integer result field - with min/max", async () => {
    const fieldName = `E2E Result Integer Range ${Date.now()}`;

    await test.step("Create an Integer result field with min and max values", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Integer");
      // Integer fields use the same minValue/maxValue keys as Number fields in the UI
      await templatesPage.setResultFieldMinValue(1);
      await templatesPage.setResultFieldMaxValue(5);
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Checkbox Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Checkbox result field - unchecked default", async () => {
    const fieldName = `E2E Result Checkbox ${Date.now()}`;

    await test.step("Create a Checkbox result field with an unchecked default", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Checkbox");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Checkbox result field - checked default", async () => {
    const fieldName = `E2E Result Checkbox Checked ${Date.now()}`;

    await test.step("Create a Checkbox result field with a checked default", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Checkbox");
      // Note: Result fields use same form methods as case fields
      await templatesPage.setCaseFieldDefaultChecked(true);
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Date Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Date result field", async () => {
    const fieldName = `E2E Result Date ${Date.now()}`;

    await test.step("Create a Date result field", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Date");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Link Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Link result field", async () => {
    const fieldName = `E2E Result Link ${Date.now()}`;

    await test.step("Create a Link result field", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Link");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Dropdown Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Dropdown result field - with options", async () => {
    const fieldName = `E2E Result Dropdown ${Date.now()}`;

    await test.step("Create a Dropdown result field with options", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Dropdown");
      await templatesPage.addDropdownOption("Pass");
      await templatesPage.addDropdownOption("Fail");
      await templatesPage.addDropdownOption("Blocked");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Dropdown result field - with default", async () => {
    const fieldName = `E2E Result Dropdown Default ${Date.now()}`;

    await test.step("Create a Dropdown result field with a default option", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Dropdown");
      await templatesPage.addDropdownOption("Not Started");
      await templatesPage.addDropdownOption("In Progress");
      await templatesPage.addDropdownOption("Complete");
      await templatesPage.setDropdownOptionDefault("Not Started");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });

  test("Add Dropdown result field - with icons/colors", async () => {
    const fieldName = `E2E Result Dropdown Styled ${Date.now()}`;

    await test.step("Create a Dropdown result field with option icons and colors", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Dropdown");
      await templatesPage.addDropdownOption("Success");
      await templatesPage.addDropdownOption("Warning");
      await templatesPage.addDropdownOption("Error");
      // Set icons and colors for options
      await templatesPage.setDropdownOptionIcon("Success");
      await templatesPage.setDropdownOptionColor("Warning");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Multi-Select Type", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add Multi-Select result field", async () => {
    const fieldName = `E2E Result MultiSelect ${Date.now()}`;

    await test.step("Create a Multi-Select result field with options", async () => {
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(fieldName);
      await templatesPage.selectResultFieldType("Multi-Select");
      await templatesPage.addDropdownOption("Browser");
      await templatesPage.addDropdownOption("Mobile");
      await templatesPage.addDropdownOption("API");
      await templatesPage.submitResultField();
    });

    await test.step("Verify the result field appears in the table", async () => {
      await templatesPage.expectResultFieldInTable(fieldName);
    });
  });
});

test.describe("Result Fields - Steps NOT Available", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Steps type NOT in result field dropdown", async () => {
    let hasStepsType: boolean | undefined;

    await test.step("Open the add result field dialog and check for the Steps type", async () => {
      await templatesPage.clickAddResultField();

      // Check if Steps type is available
      hasStepsType = await templatesPage.isStepsTypeAvailable();
    });

    await test.step("Verify the Steps type is not available, then cancel", async () => {
      // Steps should NOT be available for result fields
      expect(hasStepsType).toBe(false);

      await templatesPage.cancelResultField();
    });
  });
});

test.describe("Result Fields - Validation", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("System name unique across case AND result fields", async ({ api }) => {
    const systemName = `unique_cross_${Date.now()}`;

    await test.step("Create a case field with a system name", async () => {
      // Create a case field first
      await api.createCaseField({
        displayName: `E2E Case Field ${Date.now()}`,
        systemName: systemName,
        typeName: "Text String",
      });

      await templatesPage.goto();
    });

    await test.step("Submit a result field reusing the same system name", async () => {
      // Try to create a result field with the same system name
      await templatesPage.clickAddResultField();
      await templatesPage.fillResultFieldDisplayName(
        `E2E Result Field ${Date.now()}`
      );
      await templatesPage.selectResultFieldType("Text String");
      await templatesPage.fillResultFieldSystemName(systemName);
      await templatesPage.clickSubmitResultField();
    });

    await test.step("Verify the uniqueness error keeps the dialog open, then cancel", async () => {
      // Should show uniqueness error - dialog should remain open
      await expect(templatesPage.dialog).toBeVisible({ timeout: 5000 });
      // Cancel to close the dialog
      await templatesPage.cancelResultField();
    });
  });
});

test.describe("Result Fields - Delete Operations", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Delete result field", async ({ api }) => {
    const fieldName = `E2E Delete Result ${Date.now()}`;

    await test.step("Create a result field and verify it exists", async () => {
      await api.createResultField({
        displayName: fieldName,
        typeName: "Text String",
      });

      await templatesPage.goto();

      // Verify field exists
      await templatesPage.expectResultFieldInTable(fieldName);
    });

    await test.step("Delete the result field", async () => {
      await templatesPage.clickDeleteResultField(fieldName);
      await templatesPage.confirmDelete();
    });

    await test.step("Verify the result field is gone", async () => {
      await templatesPage.expectResultFieldNotInTable(fieldName);
    });
  });

  test("Delete result field removes from templates", async ({ api, page }) => {
    const fieldName = `E2E Result To Remove ${Date.now()}`;
    const templateName = `E2E Template With Result ${Date.now()}`;
    let fieldId: number | undefined;
    let fieldCount: number | undefined;

    await test.step("Create an enabled result field assigned to a template", async () => {
      // Create a field (must be enabled to be assignable)
      fieldId = await api.createResultField({
        displayName: fieldName,
        typeName: "Text String",
        isEnabled: true,
      });

      // Create a template with that field
      await api.createTemplate({
        name: templateName,
        resultFieldIds: [fieldId!],
      });

      await templatesPage.goto();
    });

    await test.step("Verify the template has the field assigned", async () => {
      fieldCount =
        await templatesPage.getTemplateResultFieldsCount(templateName);
      expect(fieldCount).toBe(1);
    });

    await test.step("Delete the result field", async () => {
      await templatesPage.clickDeleteResultField(fieldName);
      await templatesPage.confirmDelete();

      // Wait for deletion to complete
      await page.waitForTimeout(500);
    });

    await test.step("Reload and verify the template's field count decreased", async () => {
      await templatesPage.goto();
      await page.waitForTimeout(500);
      fieldCount =
        await templatesPage.getTemplateResultFieldsCount(templateName);
      expect(fieldCount).toBe(0);
    });
  });
});
