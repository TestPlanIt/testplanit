import { expect, test } from "../../../fixtures";
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
 *
 * NOTE: These tests run serially to avoid database/React Query conflicts
 * when multiple tests create templates/fields simultaneously.
 */

test.describe.configure({ mode: 'serial' });

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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    // Verify default value is present
    const fieldLabel = repositoryPage.getPage().getByTestId(`field-${systemName}-label`);
    const labelText = await fieldLabel.textContent();
    const fieldInput = repositoryPage.getPage().getByLabel(labelText?.trim() || '', { exact: false });
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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    // Verify hint icon is visible in label
    const fieldLabel = repositoryPage.getPage().getByTestId(`field-${systemName}-label`);
    await expect(fieldLabel).toBeVisible();

    // HelpPopover button should be present (has aria-label="Help")
    const helpButton = fieldLabel.getByRole('button', { name: 'Help' });
    await expect(helpButton).toBeVisible();
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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Fill number field with decimal value
    await repositoryPage.fillCaseField(systemName, "123.45");

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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Try to enter value outside range
    await repositoryPage.fillCaseField(systemName, "150");

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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Verify checkbox is unchecked by default
    const fieldLabel = repositoryPage.getPage().getByTestId(`field-${systemName}-label`);
    const labelText = await fieldLabel.textContent();
    const switchButton = repositoryPage.getPage().getByRole('switch', { name: labelText?.trim() });
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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Verify checkbox is checked by default
    const fieldLabel = repositoryPage.getPage().getByTestId(`field-${systemName}-label`);
    const labelText = await fieldLabel.textContent();
    const switchButton = repositoryPage.getPage().getByRole('switch', { name: labelText?.trim() });
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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Toggle checkbox
    const fieldLabel = repositoryPage.getPage().getByTestId(`field-${systemName}-label`);
    const labelText = await fieldLabel.textContent();
    const switchButton = repositoryPage.getPage().getByRole('switch', { name: labelText?.trim() });
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

    // Wait for the specific field to appear after template selection
    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Select dropdown option - find the combobox within the field element
    const selectTrigger = fieldElement.getByRole('combobox');
    await selectTrigger.click();
    await repositoryPage.getPage().waitForTimeout(500);

    const option = repositoryPage.getPage().getByRole('option', { name: 'High' });
    await option.click();

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Case Creation - Text Long Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with text long field renders TipTap editor", async ({ api }) => {
    const systemName = `textlong_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Text Long Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Text Long",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    // TipTap editor should be present within the field
    const editor = fieldElement.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Type into the TipTap editor
    await editor.click();
    await repositoryPage.getPage().keyboard.type("Rich text content for test case");

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Create case with empty text long field (optional)", async ({ api }) => {
    const systemName = `textlong_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Text Long Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Text Long",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Leave text long field empty and submit
    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Case Creation - Integer Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with integer value", async ({ api }) => {
    const systemName = `integer_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Integer Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Integer",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    await repositoryPage.fillCaseField(systemName, "42");

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Integer min/max validation enforced", async ({ api }) => {
    const systemName = `integer_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Integer Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Integer",
      isRequired: false,
      minValue: 1,
      maxValue: 10,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Enter value outside range
    await repositoryPage.fillCaseField(systemName, "99");

    const submitButton = repositoryPage.getPage().getByTestId("case-submit-button");
    await submitButton.click();

    // Dialog should remain open due to validation error
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).toBeVisible();
  });
});

test.describe("Case Creation - Date Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with date field selection", async ({ api }) => {
    const systemName = `date_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Date Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Date",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Click the date picker button to open the calendar popover
    const dateButton = fieldElement.getByRole('button').first();
    await dateButton.click();

    // Select today's date from the calendar
    const today = new Date();
    const dayNumber = today.getDate().toString();
    // Click the day button in the calendar - today should be available
    const calendarDay = repositoryPage.getPage().locator('[role="gridcell"] button').filter({ hasText: new RegExp(`^${dayNumber}$`) }).first();
    await calendarDay.click();

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Create case with empty date field (optional)", async ({ api }) => {
    const systemName = `date_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Date Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Date",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Leave date field empty and submit
    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Case Creation - Link Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with link value", async ({ api }) => {
    const systemName = `link_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Link Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Link",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    await repositoryPage.fillCaseField(systemName, "https://example.com/test");

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Create case with empty link field (optional)", async ({ api }) => {
    const systemName = `link_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Link Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Link",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Leave link field empty and submit
    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Case Creation - Multi-Select Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with multi-select selection", async ({ api }) => {
    const systemName = `multiselect_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Multi-Select Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Multi-Select",
      isRequired: false,
    });

    // Create field options
    await api.createFieldOption({
      name: "Option A",
      caseFieldId: fieldId,
      isDefault: false,
      order: 0,
    });
    await api.createFieldOption({
      name: "Option B",
      caseFieldId: fieldId,
      isDefault: false,
      order: 1,
    });
    await api.createFieldOption({
      name: "Option C",
      caseFieldId: fieldId,
      isDefault: false,
      order: 2,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Click the react-select input within the field to open dropdown
    const selectInput = fieldElement.locator('input').first();
    await selectInput.click();

    // Select "Option A" from the dropdown menu
    const optionA = repositoryPage.getPage().locator('[class*="option"]').filter({ hasText: 'Option A' }).first();
    await optionA.click();

    // Click again to select a second option
    await selectInput.click();
    const optionB = repositoryPage.getPage().locator('[class*="option"]').filter({ hasText: 'Option B' }).first();
    await optionB.click();

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Case Creation - Steps Fields", () => {
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    repositoryPage = new RepositoryPage(page);
    projectId = await api.createProject(`E2E Case Creation ${Date.now()}`);
  });

  test("Create case with steps field - add a step", async ({ api }) => {
    const systemName = `steps_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Steps Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Steps",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    // Click "Add Step" button to add a step
    const addStepButton = repositoryPage.getPage().getByTestId("add-step-button");
    await expect(addStepButton).toBeVisible({ timeout: 5000 });
    await addStepButton.click();

    // Verify the step editor appeared
    const stepEditor = repositoryPage.getPage().getByTestId("step-editor-0");
    await expect(stepEditor).toBeVisible({ timeout: 5000 });

    // Type into the step's TipTap editor
    const stepTipTap = stepEditor.locator('.tiptap').first();
    await stepTipTap.click();
    await repositoryPage.getPage().keyboard.type("Step 1: Navigate to login page");

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    await repositoryPage.submitAddCase();
    await expect(repositoryPage.getPage().getByTestId("add-case-dialog")).not.toBeVisible({ timeout: 10000 });
  });

  test("Create case with empty steps field (optional)", async ({ api }) => {
    const systemName = `steps_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const fieldId = await api.createCaseField({
      displayName: `Steps Field ${Date.now()}`,
      systemName: systemName,
      typeName: "Steps",
      isRequired: false,
    });

    const templateName = `Template ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const templateId = await api.createTemplate({
      name: templateName,
      projectIds: [projectId],
    });

    await api.assignFieldToTemplate(templateId, fieldId);

    await repositoryPage.goto(projectId);
    await repositoryPage.getPage().reload({ waitUntil: "networkidle" });
    await repositoryPage.openAddCaseModal();
    await repositoryPage.expectAddCaseDialogVisible();

    await repositoryPage.selectTemplate(templateName);

    const fieldElement = repositoryPage.getPage().getByTestId(`field-${systemName}`);
    await expect(fieldElement).toBeVisible({ timeout: 10000 });

    const nameInput = repositoryPage.getPage().getByTestId("case-name-input");
    await nameInput.fill(`Test Case ${Date.now()}`);

    // Leave steps field empty and submit
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

  test("Restricted result field appears but is disabled without permission", async ({ api, browser, baseURL }) => {
    const systemName = `restricted_result_field_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // Create restricted RESULT field (not case field)
    const displayName = `Restricted Result ${Date.now()}`;
    const resultFieldId = await api.createResultField({
      displayName,
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

    // Assign result field to template
    await api.assignResultFieldToTemplate(templateId, resultFieldId);

    // Create a test case with this template
    const caseName = `Test Case ${Date.now()}`;
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(projectId, folderId, caseName, templateId);

    // Create a test run
    const testRunId = await api.createTestRun(projectId, `Test Run ${Date.now()}`);

    // Add the test case to the test run
    const testRunCaseId = await api.addTestCaseToTestRun(testRunId, caseId);

    // Create a custom role WITHOUT TestRunResultRestrictedFields permission
    const restrictedRoleName = `restricted_role_${Date.now()}`;
    const restrictedRoleId = await api.createRole(restrictedRoleName);

    // Grant base permissions but NOT TestRunResultRestrictedFields
    const areasToGrant = [
      "TestCaseRepository",
      "TestRuns",
      "TestRunResults",
    ];
    for (const area of areasToGrant) {
      await api.setRolePermission({
        roleId: restrictedRoleId,
        area,
        canAddEdit: true,
      });
    }

    // Create a regular user with the custom restricted role
    const regularUserEmail = `user-${Date.now()}@example.com`;
    const regularUserPassword = "testpassword123";
    const userResult = await api.createUser({
      name: "Regular User",
      email: regularUserEmail,
      password: regularUserPassword,
      access: "USER",
      roleId: restrictedRoleId,
    });
    const regularUserId = userResult.data.id;

    // Give the regular user access to the project using GLOBAL_ROLE
    // so the system resolves permissions from the user's global role (our restricted role)
    await api.giveUserProjectAccess({
      userId: regularUserId,
      projectId: projectId,
      accessType: "GLOBAL_ROLE",
    });

    // Mark the welcome tour as completed for the regular user (via UserPreferences)
    await api.updateUserPreferences({
      userId: regularUserId,
      hasCompletedWelcomeTour: true,
    });

    // Create a new browser context and authenticate as the regular user
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();

    try {
      // Login as regular user
      await userPage.goto(`${baseURL}/en-US/signin`);
      await userPage.waitForLoadState("networkidle");

      const emailInput = userPage.getByTestId("email-input");
      const passwordInput = userPage.getByTestId("password-input");
      const submitButton = userPage.getByTestId("signin-button");

      await emailInput.fill(regularUserEmail);
      await passwordInput.fill(regularUserPassword);
      await submitButton.click();

      // Wait for redirect after login
      await userPage.waitForURL(/\/en-US\/?$/, { timeout: 30000 });

      // Navigate to the test run as regular user
      await userPage.goto(`${baseURL}/en-US/projects/runs/${projectId}/${testRunId}`);
      await userPage.waitForLoadState("networkidle");

      // Click on the test case name to open sidebar
      const testCaseLink = userPage.locator(`text=${caseName}`).first();
      await expect(testCaseLink).toBeVisible({ timeout: 10000 });
      await testCaseLink.click();

      // Wait for sidebar to load
      await userPage.waitForLoadState("networkidle");

      // Find and click the "Add Result" button in the sidebar
      const addResultButton = userPage.locator('button:has-text("Add Result")').first();
      await expect(addResultButton).toBeVisible({ timeout: 15000 });
      await addResultButton.click();

      // Wait for Add Result modal to open
      const modal = userPage.getByRole('dialog', { name: 'Add Result' });
      await expect(modal).toBeVisible({ timeout: 10000 });

      // Find the restricted result field by its label text within the modal
      const fieldLabel = modal.getByText(displayName).first();
      await expect(fieldLabel).toBeVisible({ timeout: 10000 });

      // The label is inside a FormItem div — go up to it to scope the input search
      const formItem = fieldLabel.locator('..');
      const fieldInput = formItem.locator('input').first();
      await expect(fieldInput).toBeVisible();
      await expect(fieldInput).toBeDisabled();

      // Lock icon should be present next to the label
      const lockIcon = formItem.locator('[title="Restricted Field"]').first();
      await expect(lockIcon).toBeVisible();
    } finally {
      await userContext.close();
    }
  });
});
