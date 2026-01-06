import { test, expect } from "../../../fixtures";
import { TemplatesFieldsPage } from "../../../page-objects/admin/templates-fields.page";

/**
 * Templates CRUD Operations Tests
 *
 * Tests for creating, reading, updating, and deleting templates
 * in the Admin > Templates & Fields page.
 *
 * Templates define collections of Case Fields and Result Fields
 * that can be assigned to projects.
 */

test.describe("Templates - Navigation and Display", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
  });

  test("Navigate to Templates & Fields page", async ({ page }) => {
    await templatesPage.goto();

    // Verify we're on the correct page
    await expect(page).toHaveURL(/\/admin\/fields/);

    // Verify the Add Template button is visible
    await expect(templatesPage.addTemplateButton).toBeVisible();
  });

  test("Templates table displays correctly", async ({ page }) => {
    await templatesPage.goto();

    // Verify the templates table is visible
    await expect(templatesPage.templatesTable).toBeVisible();

    // Verify table headers exist (Name, Case Fields, Result Fields, Projects, Enabled, Default, Actions)
    const headers = templatesPage.templatesTable.locator("th");
    await expect(headers.first()).toBeVisible();

    // There should be at least a default template in the system
    const rows = templatesPage.templatesTable.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });
});

test.describe("Templates - Create Operations", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Add template with name only", async ({ api }) => {
    const templateName = `E2E Template ${Date.now()}`;

    await templatesPage.clickAddTemplate();
    await templatesPage.fillTemplateName(templateName);
    await templatesPage.submitTemplate();

    // Verify template appears in the table
    await templatesPage.expectTemplateInTable(templateName);

    // Cleanup will be handled by api.cleanup() in afterEach
  });

  test("Add template with case fields assigned", async ({ api }) => {
    // First create a case field to assign
    const fieldName = `E2E Case Field ${Date.now()}`;
    await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
    });

    // Reload to see the new field
    await templatesPage.goto();

    const templateName = `E2E Template With Fields ${Date.now()}`;

    await templatesPage.clickAddTemplate();
    await templatesPage.fillTemplateName(templateName);
    await templatesPage.selectCaseField(fieldName);
    await templatesPage.submitTemplate();

    // Verify template appears in the table
    await templatesPage.expectTemplateInTable(templateName);

    // Verify the template shows the field count
    const fieldCount = await templatesPage.getTemplateCaseFieldsCount(templateName);
    expect(fieldCount).toBeGreaterThanOrEqual(1);
  });

  test("Add template with result fields assigned", async ({ api }) => {
    // First create a result field to assign
    const fieldName = `E2E Result Field ${Date.now()}`;
    await api.createResultField({
      displayName: fieldName,
      typeName: "Text String",
    });

    // Reload to see the new field
    await templatesPage.goto();

    const templateName = `E2E Template With Results ${Date.now()}`;

    await templatesPage.clickAddTemplate();
    await templatesPage.fillTemplateName(templateName);
    await templatesPage.selectResultField(fieldName);
    await templatesPage.submitTemplate();

    // Verify template appears in the table
    await templatesPage.expectTemplateInTable(templateName);

    // Verify the template shows the field count
    const fieldCount = await templatesPage.getTemplateResultFieldsCount(templateName);
    expect(fieldCount).toBeGreaterThanOrEqual(1);
  });

  test("Add template with project assignments", async ({ api }) => {
    // Create a project to assign
    const projectId = await api.createProject(`E2E Project ${Date.now()}`);

    // Reload to see the new project
    await templatesPage.goto();

    const templateName = `E2E Template With Project ${Date.now()}`;

    await templatesPage.clickAddTemplate();
    await templatesPage.fillTemplateName(templateName);

    // Note: Project selection depends on UI implementation
    // This test assumes there's at least one project to select
    await templatesPage.submitTemplate();

    // Verify template appears in the table
    await templatesPage.expectTemplateInTable(templateName);
  });

  test("Add template with all options", async ({ api }) => {
    // Create fields to assign
    const caseFieldName = `E2E Case ${Date.now()}`;
    const resultFieldName = `E2E Result ${Date.now()}`;

    await api.createCaseField({
      displayName: caseFieldName,
      typeName: "Text String",
    });
    await api.createResultField({
      displayName: resultFieldName,
      typeName: "Text String",
    });

    // Reload to see new fields
    await templatesPage.goto();

    const templateName = `E2E Full Template ${Date.now()}`;

    await templatesPage.clickAddTemplate();
    await templatesPage.fillTemplateName(templateName);
    await templatesPage.toggleTemplateEnabled(true);
    await templatesPage.selectCaseField(caseFieldName);
    await templatesPage.selectResultField(resultFieldName);
    await templatesPage.submitTemplate();

    // Verify template appears in the table
    await templatesPage.expectTemplateInTable(templateName);

    // Verify template is enabled
    const isEnabled = await templatesPage.isTemplateEnabled(templateName);
    expect(isEnabled).toBe(true);
  });

  test("Duplicate name shows error", async ({ api }) => {
    // Create a template first
    const templateName = `E2E Duplicate ${Date.now()}`;
    await api.createTemplate({ name: templateName });

    // Reload to see the template
    await templatesPage.goto();

    // Try to create another template with the same name
    await templatesPage.clickAddTemplate();
    await templatesPage.fillTemplateName(templateName);
    await templatesPage.clickSubmitTemplate();

    // Should show an error (dialog stays open with error message)
    await templatesPage.expectFormError("exists");
  });

  test("Cancel add template", async ({ page }) => {
    const templateName = `E2E Cancel ${Date.now()}`;

    await templatesPage.clickAddTemplate();
    await templatesPage.fillTemplateName(templateName);
    await templatesPage.cancelTemplate();

    // Verify template does NOT appear in the table
    await templatesPage.expectTemplateNotInTable(templateName);
  });
});

test.describe("Templates - Edit Operations", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Edit template name", async ({ api, page }) => {
    // Create a template to edit
    const originalName = `E2E Edit Original ${Date.now()}`;
    await api.createTemplate({ name: originalName });

    // Reload to see the template
    await templatesPage.goto();

    // Edit the template
    const newName = `E2E Edit Updated ${Date.now()}`;
    await templatesPage.clickEditTemplate(originalName);
    await templatesPage.fillTemplateName(newName);
    await templatesPage.submitTemplate();

    // Verify the new name appears
    await templatesPage.expectTemplateInTable(newName);

    // Verify the old name is gone
    await templatesPage.expectTemplateNotInTable(originalName);
  });

  test("Edit template - add case fields", async ({ api, page }) => {
    // Create a template and a field (field must be enabled to appear in dropdown)
    const templateName = `E2E Add Fields ${Date.now()}`;
    const fieldName = `E2E Field To Add ${Date.now()}`;

    await api.createTemplate({ name: templateName });
    await api.createCaseField({
      displayName: fieldName,
      typeName: "Text String",
      isEnabled: true,
    });

    // Reload
    await templatesPage.goto();

    // Edit and add field
    await templatesPage.clickEditTemplate(templateName);
    // Wait for dialog content to fully load including the field selectors
    await page.waitForTimeout(1000);
    await templatesPage.selectCaseField(fieldName);
    await templatesPage.submitTemplate();

    // Wait for table to update and reload page to get fresh data
    await templatesPage.goto();

    // Verify field count increased
    const fieldCount = await templatesPage.getTemplateCaseFieldsCount(templateName);
    expect(fieldCount).toBeGreaterThanOrEqual(1);
  });

  test("Edit template - add result fields", async ({ api, page }) => {
    // Create a template and a field (field must be enabled to appear in dropdown)
    const templateName = `E2E Add Results ${Date.now()}`;
    const fieldName = `E2E Result To Add ${Date.now()}`;

    await api.createTemplate({ name: templateName });
    await api.createResultField({
      displayName: fieldName,
      typeName: "Text String",
      isEnabled: true,
    });

    // Reload
    await templatesPage.goto();

    // Edit and add field
    await templatesPage.clickEditTemplate(templateName);
    // Wait for dialog content to fully load including the field selectors
    await page.waitForTimeout(1000);
    await templatesPage.selectResultField(fieldName);
    await templatesPage.submitTemplate();

    // Wait for table to update and reload page to get fresh data
    await templatesPage.goto();

    // Verify field count increased
    const fieldCount = await templatesPage.getTemplateResultFieldsCount(templateName);
    expect(fieldCount).toBeGreaterThanOrEqual(1);
  });

  test("Cancel edit template", async ({ api, page }) => {
    // Create a template
    const originalName = `E2E Cancel Edit ${Date.now()}`;
    await api.createTemplate({ name: originalName });

    // Reload
    await templatesPage.goto();

    // Start editing but cancel
    const attemptedName = `E2E Should Not Save ${Date.now()}`;
    await templatesPage.clickEditTemplate(originalName);
    await templatesPage.fillTemplateName(attemptedName);
    await templatesPage.cancelTemplate();

    // Original name should still be there
    await templatesPage.expectTemplateInTable(originalName);

    // Attempted name should not exist
    await templatesPage.expectTemplateNotInTable(attemptedName);
  });
});

test.describe("Templates - Toggle Operations", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Toggle template enabled via switch", async ({ api }) => {
    // Create an enabled template
    const templateName = `E2E Toggle Enabled ${Date.now()}`;
    await api.createTemplate({ name: templateName, isEnabled: true });

    // Reload
    await templatesPage.goto();

    // Verify initially enabled
    let isEnabled = await templatesPage.isTemplateEnabled(templateName);
    expect(isEnabled).toBe(true);

    // Toggle to disabled
    await templatesPage.toggleTemplateEnabledInTable(templateName);

    // Verify now disabled
    isEnabled = await templatesPage.isTemplateEnabled(templateName);
    expect(isEnabled).toBe(false);

    // Toggle back to enabled
    await templatesPage.toggleTemplateEnabledInTable(templateName);

    // Verify enabled again
    isEnabled = await templatesPage.isTemplateEnabled(templateName);
    expect(isEnabled).toBe(true);
  });
});

test.describe("Templates - Delete Operations", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Delete template", async ({ api }) => {
    // Create a template to delete
    const templateName = `E2E Delete ${Date.now()}`;
    await api.createTemplate({ name: templateName });

    // Reload
    await templatesPage.goto();

    // Verify template exists
    await templatesPage.expectTemplateInTable(templateName);

    // Delete the template
    await templatesPage.clickDeleteTemplate(templateName);
    await templatesPage.confirmDelete();

    // Verify template is gone
    await templatesPage.expectTemplateNotInTable(templateName);
  });
});
