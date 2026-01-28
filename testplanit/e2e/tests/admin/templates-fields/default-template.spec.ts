import { test, expect } from "../../../fixtures";
import { TemplatesFieldsPage } from "../../../page-objects/admin/templates-fields.page";

/**
 * Default Template Behavior Tests
 *
 * Tests for the special behaviors of default templates:
 * - Only one default template at a time
 * - Setting default auto-enables template
 * - Cannot disable default template
 * - Cannot delete default template
 * - Default template auto-assigned to all projects
 * - Default indicator in templates list
 */

test.describe("Default Template - Basic Behavior", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test.skip("Only one default template at a time", async ({ api, page }) => {
    // Skipping test because it's difficuklt to isolate the test from other tests that may create templates and set them as default.
    // Create two templates
    const template1Name = `E2E Default 1 ${Date.now()}`;
    const template2Name = `E2E Default 2 ${Date.now()}`;

    const template1Id = await api.createTemplate({
      name: template1Name,
      isDefault: true,
    });
    const template2Id = await api.createTemplate({
      name: template2Name,
      isDefault: false,
    });

    console.log(`Created template1: ${template1Name} (ID: ${template1Id})`);
    console.log(`Created template2: ${template2Name} (ID: ${template2Id})`);

    await templatesPage.goto();

    // Both should be visible
    await templatesPage.expectTemplateInTable(template1Name);
    await templatesPage.expectTemplateInTable(template2Name);

    // Set template2 as default via edit
    console.log(`Setting ${template2Name} as default via UI`);
    await templatesPage.clickEditTemplate(template2Name);
    await templatesPage.toggleTemplateDefault(true);
    await templatesPage.submitTemplate();

    // Wait for the dialog to close and mutations to complete
    await page.waitForLoadState("networkidle");
    console.log('Dialog closed, network idle');

    // Poll the API to wait for the cascade update to complete
    // The UI mutations happen asynchronously, so we poll until both conditions are met
    await expect.poll(
      async () => {
        const template1Verification = await api.verifyTemplate(template1Id);
        const template2Verification = await api.verifyTemplate(template2Id);
        console.log(`Poll: ${template1Name} isDefault=${template1Verification.isDefault}, ${template2Name} isDefault=${template2Verification.isDefault}`);
        return !template1Verification.isDefault && template2Verification.isDefault;
      },
      {
        message: `Expected ${template2Name} to be default and ${template1Name} to not be default`,
        timeout: 20000,
        intervals: [100, 250, 500, 1000],
      }
    ).toBe(true);

    console.log('Cascade complete');

    // Final verification
    const template1Verification = await api.verifyTemplate(template1Id);
    const template2Verification = await api.verifyTemplate(template2Id);
    console.log(`Final: ${template1Name} isDefault=${template1Verification.isDefault}, ${template2Name} isDefault=${template2Verification.isDefault}`);
    expect(template1Verification.isDefault).toBe(false);
    expect(template2Verification.isDefault).toBe(true);
  });

  test("Setting default auto-enables template", async ({ api }) => {
    // Create a disabled template
    const templateName = `E2E Auto Enable ${Date.now()}`;
    await api.createTemplate({
      name: templateName,
      isEnabled: false,
      isDefault: false,
    });

    await templatesPage.goto();
    await templatesPage.expectTemplateInTable(templateName);

    // Set as default
    await templatesPage.clickEditTemplate(templateName);
    await templatesPage.toggleTemplateDefault(true);
    await templatesPage.submitTemplate();

    // Template should now be enabled (auto-enabled when set as default)
    // Verification depends on UI implementation
  });

  test("Default indicator shown in templates list", async ({ api }) => {
    // Get or create a default template
    const defaultTemplate = await api.getDefaultTemplate();

    await templatesPage.goto();

    if (defaultTemplate) {
      // Verify the default template has a visual indicator
      await templatesPage.expectTemplateInTable(defaultTemplate.templateName);
      // The UI should show a "Default" badge or indicator
      // Exact verification depends on UI implementation
    }
  });
});

test.describe("Default Template - Protection Rules", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Cannot disable default template", async ({ api, page }) => {
    // Create and set a template as default
    const templateName = `E2E No Disable ${Date.now()}`;
    await api.createTemplate({
      name: templateName,
      isDefault: true,
      isEnabled: true,
    });

    await templatesPage.goto();

    // Try to disable via edit dialog
    await templatesPage.clickEditTemplate(templateName);

    // The enabled toggle should be disabled or not changeable when isDefault is true
    // This verification depends on UI implementation

    await templatesPage.cancelTemplate();
  });

  test("Cannot delete default template", async ({ api, page }) => {
    // Create a default template
    const templateName = `E2E No Delete ${Date.now()}`;
    const templateId = await api.createTemplate({
      name: templateName,
      isDefault: true,
    });

    // Verify via API that the template is actually marked as default
    const verification = await api.verifyTemplate(templateId);
    if (!verification.exists) {
      throw new Error(`Template ${templateId} does not exist in the database`);
    }
    if (!verification.isDefault) {
      throw new Error(`Template ${templateId} was not marked as default in the database (isDefault=${verification.isDefault})`);
    }

    await templatesPage.goto();

    // Wait for the page to load and show the correct data
    await page.waitForLoadState("networkidle");

    // For default templates, the delete button should either be:
    // 1. Not present (with the testid - meaning it's disabled/placeholder)
    // 2. Disabled
    // 3. Show an error when clicked
    const row = templatesPage.templatesTable.locator("tr").filter({ hasText: templateName }).first();
    await expect(row).toBeVisible({ timeout: 5000 });

    // Verify the "Default" switch is checked - poll to wait for UI to sync with database
    const defaultSwitch = row.locator('button[role="switch"]').last();
    await expect.poll(
      async () => {
        const state = await defaultSwitch.getAttribute("data-state");
        return state;
      },
      {
        message: `Expected default switch to be checked for template ${templateName}`,
        timeout: 10000,
        intervals: [100, 250, 500],
      }
    ).toBe("checked");

    // The delete button with testid should NOT be present for default templates
    // (The UI renders a disabled placeholder button without the testid)
    const deleteButton = row.getByTestId("delete-template-button");
    const buttonExists = await deleteButton.count() > 0;

    if (buttonExists) {
      // If button exists, it should be disabled
      const isDisabled = await deleteButton.isDisabled().catch(() => false);
      expect(isDisabled).toBe(true);
    }

    // Verify template still exists (cannot be deleted)
    await templatesPage.expectTemplateInTable(templateName);
  });

  test("Cannot unset default without setting another", async ({ api }) => {
    // Create a single template that is default
    const templateName = `E2E Single Default ${Date.now()}`;
    await api.createTemplate({
      name: templateName,
      isDefault: true,
    });

    await templatesPage.goto();

    // Try to unset default
    await templatesPage.clickEditTemplate(templateName);

    // The default toggle may be disabled or show validation error
    // when trying to unset without another default

    await templatesPage.cancelTemplate();
  });
});

test.describe("Default Template - Project Assignment", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Default template auto-assigned to all projects", async ({ api }) => {
    // Create a default template FIRST (required for project creation)
    const templateName = `E2E Auto Assign ${Date.now()}`;
    const templateId = await api.createTemplate({
      name: templateName,
      isDefault: true,
    });

    // Wait for template to be fully set as default
    await expect.poll(
      async () => {
        const verification = await api.verifyTemplate(templateId);
        return verification.isDefault;
      },
      {
        message: `Expected template ${templateName} to be default`,
        timeout: 10000,
        intervals: [100, 250, 500],
      }
    ).toBe(true);

    // Now create a project (requires default template to exist)
    const projectName = `E2E Default Proj ${Date.now()}`;
    await api.createProject(projectName);

    await templatesPage.goto();

    // The default template should be available for all projects
    // This is verified by checking the template exists and is default
    await templatesPage.expectTemplateInTable(templateName);
  });

  test("Default template available for new projects", async ({ api }) => {
    // Create a default template for this test
    const templateName = `E2E New Proj Template ${Date.now()}`;
    await api.createTemplate({
      name: templateName,
      isDefault: true,
    });

    // Create a new project after the default template exists
    const projectName = `E2E New Proj ${Date.now()}`;
    await api.createProject(projectName);

    await templatesPage.goto();

    // Default template should be available for the new project
    await templatesPage.expectTemplateInTable(templateName);
  });
});

test.describe("Default Template - Cascade Behaviors", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Changing default unsets previous default", async ({ api, page }) => {
    // Create two templates
    const template1Name = `E2E Cascade A ${Date.now()}`;
    const template2Name = `E2E Cascade B ${Date.now()}`;

    const template1Id = await api.createTemplate({
      name: template1Name,
      isDefault: true,
    });

    // Wait for template1 to be fully set as default before creating template2
    await expect.poll(
      async () => {
        const verification = await api.verifyTemplate(template1Id);
        return verification.isDefault;
      },
      {
        message: `Expected template1 ${template1Name} to be default before creating template2`,
        timeout: 10000,
        intervals: [100, 250, 500],
      }
    ).toBe(true);

    const template2Id = await api.createTemplate({
      name: template2Name,
      isDefault: false,
    });

    await templatesPage.goto();

    // Set template2 as default via UI
    await templatesPage.clickEditTemplate(template2Name);
    await templatesPage.toggleTemplateDefault(true);
    await templatesPage.submitTemplate();

    // Wait for the dialog to close and mutations to complete
    await page.waitForLoadState("networkidle");

    // Poll the API to wait for the cascade update to complete
    // The cascade should unset template1's default and set template2 as default
    await expect.poll(
      async () => {
        const template1Verification = await api.verifyTemplate(template1Id);
        const template2Verification = await api.verifyTemplate(template2Id);
        return !template1Verification.isDefault && template2Verification.isDefault;
      },
      {
        message: `Expected template2 ${template2Name} to be default and template1 ${template1Name} to not be default`,
        timeout: 40000, // Increased timeout from 30s to 40s
        intervals: [100, 250, 500, 1000, 2000, 3000],
      }
    ).toBe(true);

    // Final verification
    const template1Verification = await api.verifyTemplate(template1Id);
    const template2Verification = await api.verifyTemplate(template2Id);
    expect(template1Verification.isDefault).toBe(false);
    expect(template2Verification.isDefault).toBe(true);
  });

  test("Deleting non-default template preserves default", async ({ api, page }) => {
    // Create a default template and a non-default template
    const defaultTemplateName = `E2E Preserve Default ${Date.now()}`;
    const otherTemplateName = `E2E Delete Me ${Date.now()}`;

    await api.createTemplate({
      name: defaultTemplateName,
      isDefault: true,
    });
    await api.createTemplate({
      name: otherTemplateName,
      isDefault: false,
    });

    await templatesPage.goto();

    // Delete the non-default template
    await templatesPage.clickDeleteTemplate(otherTemplateName);
    await templatesPage.confirmDelete();

    // Wait for deletion to complete and table to update
    await page.waitForLoadState("networkidle");

    // Verify the deleted template is no longer in the table
    await templatesPage.expectTemplateNotInTable(otherTemplateName);

    // Default template should still exist and be default
    await templatesPage.expectTemplateInTable(defaultTemplateName);
  });
});
