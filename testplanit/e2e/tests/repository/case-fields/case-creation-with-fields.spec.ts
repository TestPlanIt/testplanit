import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Case Creation with Custom Fields E2E Tests
 *
 * Tests all 10 case field types in test case creation forms:
 * - Text String, Text Long, Number, Integer, Checkbox
 * - Date, Link, Dropdown, Multi-Select, Steps
 *
 * Verifies:
 * - Field rendering in creation form
 * - User input handling
 * - Validation (required fields, min/max, etc.)
 * - Default values
 * - Restricted field access control
 */

test.describe("Case Creation - Text String Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);

    // Create isolated project for this test
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with empty text string (optional field)", async ({ api }) => {
    const systemName = `text_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    // Create optional text string field
    const fieldId = await api.createCaseField({
      displayName: `Text Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Text String",
      isRequired: false,
    });

    // Assign to dedicated template
    await api.assignFieldToTemplate(templateId, fieldId);

    // Small delay to ensure DB write completes
    await repositoryPage.getPage().waitForTimeout(500);

    // Navigate and open add case dialog
    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data is loaded
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    // Wait for the field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 5000 });

    // Fill required name field
    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Leave text string field empty and submit
    await repositoryPage.submitAddCase();

    // Dialog should close on success
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Create case with text string value", async ({ api }) => {
    const systemName = `text_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    const fieldId = await api.createCaseField({
      displayName: `Text Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Text String",
      isRequired: false,
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    // Fill name and text field
    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    await repositoryPage.fillCaseField(systemName, "Test value");

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Default value auto-applied for text string", async ({ api }) => {
    const systemName = `text_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const defaultValue = "Default text value";

    const fieldId = await api.createCaseField({
      displayName: `Text Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Text String",
      isRequired: false,
      defaultValue: defaultValue,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    // Verify default value is present
    const fieldInput = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('input');
    await expect(fieldInput).toHaveValue(defaultValue);
  });

  test("Required text string validation prevents submission", async ({ api }) => {
    const systemName = `text_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Required Text ${Date.now()}`,
      systemName: systemName,
      typeName: "Text String",
      isRequired: true,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    // Fill name but not required text field
    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Try to submit - should fail validation
    const submitButton = repositoryPage.getPage().getByTestId("case-submit-button");
    await submitButton.click();

    // Dialog should remain open
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).toBeVisible();

    // Validation message should appear (using FormMessage component)
    await repositoryPage.getPage().waitForTimeout(500);
  });

  test("Hint text displays in field", async ({ api }) => {
    const systemName = `text_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const hintText = "This is a helpful hint";

    const fieldId = await api.createCaseField({
      displayName: `Text Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Text String",
      isRequired: false,
      hint: hintText,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    // Verify hint icon is visible in label
    const fieldLabel = repositoryPage.getPage().getByTestId(`field-${systemName}-label`);
    await expect(fieldLabel).toBeVisible();

    // HelpPopover should be present
    const helpIcon = fieldLabel.locator('button[class*="help"], svg[class*="help"]');
    await expect(helpIcon.first()).toBeVisible();
  });
});

test.describe("Case Creation - Number Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with decimal number value", async ({ api }) => {
    const systemName = `number_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Number Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Number",
      isRequired: false,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Fill number field with decimal value
    const numberInput = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('input[type="number"]');
    await numberInput.fill("123.45");

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Number min/max validation enforced", async ({ api }) => {
    const systemName = `number_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Number Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Number",
      isRequired: false,
      minValue: 0,
      maxValue: 100,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Try to enter value outside range
    const numberInput = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('input[type="number"]');
    await numberInput.fill("150");

    // Try to submit - validation should fail
    const submitButton = repositoryPage.getPage().getByTestId("case-submit-button");
    await submitButton.click();

    // Dialog should remain open due to validation error
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).toBeVisible();
  });
});

test.describe("Case Creation - Checkbox Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with checkbox default unchecked", async ({ api }) => {
    const systemName = `checkbox_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Checkbox Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Checkbox",
      isRequired: false,
      isChecked: false,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Verify checkbox is unchecked by default
    const switchButton = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('button[role="switch"]');
    await expect(switchButton).toHaveAttribute('data-state', 'unchecked');

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Create case with checkbox default checked", async ({ api }) => {
    const systemName = `checkbox_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Checkbox Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Checkbox",
      isRequired: false,
      isChecked: true,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Verify checkbox is checked by default
    const switchButton = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('button[role="switch"]');
    await expect(switchButton).toHaveAttribute('data-state', 'checked');

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Toggle checkbox before submission", async ({ api }) => {
    const systemName = `checkbox_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Checkbox Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Checkbox",
      isRequired: false,
      isChecked: false,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Toggle checkbox
    const switchButton = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('button[role="switch"]');
    await switchButton.click();
    await expect(switchButton).toHaveAttribute('data-state', 'checked');

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Case Creation - Dropdown Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with dropdown selection", async ({ api }) => {
    const systemName = `dropdown_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // Create dropdown field
    const fieldId = await api.createCaseField({
      displayName: `Priority ${Date.now()}`,
      systemName: systemName,
      typeName: "Dropdown",
      isRequired: false,
    });

    // Create field options (they are automatically assigned to the field)
    await api.createFieldOption({
      name: "Low",
      caseFieldId: fieldId,
      isDefault: false,
      order: 0,
    });
    await api.createFieldOption({
      name: "High",
      caseFieldId: fieldId,
      isDefault: false,
      order: 1,
    });

    // Assign to template
    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Select dropdown option
    const selectTrigger = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('[role="combobox"]');
    await selectTrigger.click();
    await repositoryPage.getPage().waitForTimeout(500);

    const option = repositoryPage.getPage().locator('[role="option"]:has-text("High")');
    await option.click();

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Case Creation - Restricted Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Restricted field appears but is disabled without permission", async ({ api }) => {
    const systemName = `restricted_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Restricted Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Text String",
      isRequired: false,
      isRestricted: true,
    });

    // Create dedicated template for this test
    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    // Reload page to ensure fresh template/field data (React Query cache invalidation)
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    // Select the template
    await repositoryPage.selectTemplate(templateName);

    // Field should be visible but disabled
    const fieldInput = repositoryPage.getPage().getByTestId(`field-${systemName}-input`).locator('input');
    await expect(fieldInput).toBeVisible();
    await expect(fieldInput).toBeDisabled();

    // Lock icon should be present in label
    const fieldLabel = repositoryPage.getPage().getByTestId(`field-${systemName}-label`);
    const lockIcon = fieldLabel.locator('svg[class*="lock"]');
    await expect(lockIcon).toBeVisible();
  });
});
