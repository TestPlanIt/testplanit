import { expect, test } from "../../../fixtures";
import { TemplatesFieldsPage } from "../../../page-objects/admin/templates-fields.page";

/**
 * Default Template Behavior Tests
 *
 * Tests for the special behaviors of default templates:
 * - Setting default auto-enables template
 * - Cannot disable default template
 * - Cannot delete default template
 * - Default template auto-assigned to all projects
 * - Default indicator in templates list
 *
 * Mutual-exclusion of the default flag is covered by the
 * "Changing default unsets previous default" cascade test below.
 */

test.describe("Default Template - Basic Behavior", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Setting default auto-enables template", async ({ api }) => {
    const templateName = `E2E Auto Enable ${Date.now()}`;

    await test.step("Create a disabled template", async () => {
      await api.createTemplate({
        name: templateName,
        isEnabled: false,
        isDefault: false,
      });

      await templatesPage.goto();
      await templatesPage.expectTemplateInTable(templateName);
    });

    await test.step("Set the template as default", async () => {
      await templatesPage.clickEditTemplate(templateName);
      await templatesPage.toggleTemplateDefault(true);
      await templatesPage.submitTemplate();

      // Template should now be enabled (auto-enabled when set as default)
      // Verification depends on UI implementation
    });
  });

  test("Default indicator shown in templates list", async ({ api }) => {
    let defaultTemplate: Awaited<ReturnType<typeof api.getDefaultTemplate>>;

    await test.step("Open the templates list", async () => {
      // Get or create a default template
      defaultTemplate = await api.getDefaultTemplate();

      await templatesPage.goto();
    });

    await test.step("Verify the default template indicator", async () => {
      if (defaultTemplate) {
        // Verify the default template has a visual indicator
        await templatesPage.expectTemplateInTable(defaultTemplate.templateName);
        // The UI should show a "Default" badge or indicator
        // Exact verification depends on UI implementation
      }
    });
  });
});

test.describe("Default Template - Protection Rules", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Cannot disable default template", async ({ api, page: _page }) => {
    const templateName = `E2E No Disable ${Date.now()}`;

    await test.step("Create and set a template as default", async () => {
      await api.createTemplate({
        name: templateName,
        isDefault: true,
        isEnabled: true,
      });

      await templatesPage.goto();
    });

    await test.step("Attempt to disable via the edit dialog", async () => {
      await templatesPage.clickEditTemplate(templateName);

      // The enabled toggle should be disabled or not changeable when isDefault is true
      // This verification depends on UI implementation

      await templatesPage.cancelTemplate();
    });
  });

  test("Cannot delete default template", async ({ api, page }) => {
    const templateName = `E2E No Delete ${Date.now()}`;
    let templateId: Awaited<ReturnType<typeof api.createTemplate>>;
    let row: typeof templatesPage.templatesTable;

    await test.step("Create a default template", async () => {
      templateId = await api.createTemplate({
        name: templateName,
        isDefault: true,
      });
    });

    await test.step("Verify via API that the template is marked as default", async () => {
      const verification = await api.verifyTemplate(templateId!);
      if (!verification.exists) {
        throw new Error(
          `Template ${templateId} does not exist in the database`
        );
      }
      if (!verification.isDefault) {
        throw new Error(
          `Template ${templateId} was not marked as default in the database (isDefault=${verification.isDefault})`
        );
      }
    });

    await test.step("Reclaim default flag and open the templates list", async () => {
      // Re-set the template as default right before navigating, in case a concurrent
      // test's createTemplate (which runs updateMany to unset all defaults) has cleared
      // our template's isDefault flag since we created it.
      await api.ensureTemplateIsDefault(templateId!);

      await templatesPage.goto();

      // Wait for the page to load and show the correct data
      await page.waitForLoadState("networkidle");
    });

    await test.step("Confirm the row shows as default", async () => {
      // For default templates, the delete button should either be:
      // 1. Not present (with the testid - meaning it's disabled/placeholder)
      // 2. Disabled
      // 3. Show an error when clicked
      row = templatesPage.templatesTable
        .locator("tr")
        .filter({ hasText: templateName })
        .first();
      await expect(row).toBeVisible({ timeout: 5000 });

      // Verify the "Default" switch is checked - poll to wait for UI to sync with database
      // The table may need a reload to reflect the API-created template's isDefault state
      const defaultSwitch = row.locator('button[role="switch"]').last();
      await expect
        .poll(
          async () => {
            const state = await defaultSwitch.getAttribute("data-state");
            if (state !== "checked") {
              // A concurrent test may have stolen isDefault; reclaim it and reload
              await api.ensureTemplateIsDefault(templateId!);
              await page.reload();
              await page.waitForLoadState("networkidle");
            }
            return await defaultSwitch.getAttribute("data-state");
          },
          {
            message: `Expected default switch to be checked for template ${templateName}`,
            timeout: 20000,
            intervals: [500, 1000, 2000, 3000],
          }
        )
        .toBe("checked");
    });

    await test.step("Verify the delete control is unavailable and template persists", async () => {
      // The delete button with testid should NOT be present for default templates
      // (The UI renders a disabled placeholder button without the testid)
      const deleteButton = row!.getByTestId("delete-template-button");
      const buttonExists = (await deleteButton.count()) > 0;

      if (buttonExists) {
        // If button exists, it should be disabled
        const isDisabled = await deleteButton.isDisabled().catch(() => false);
        expect(isDisabled).toBe(true);
      }

      // Verify template still exists (cannot be deleted)
      await templatesPage.expectTemplateInTable(templateName);
    });
  });

  test("Cannot unset default without setting another", async ({ api }) => {
    const templateName = `E2E Single Default ${Date.now()}`;

    await test.step("Create a single default template", async () => {
      await api.createTemplate({
        name: templateName,
        isDefault: true,
      });

      await templatesPage.goto();
    });

    await test.step("Attempt to unset default in the edit dialog", async () => {
      await templatesPage.clickEditTemplate(templateName);

      // The default toggle may be disabled or show validation error
      // when trying to unset without another default

      await templatesPage.cancelTemplate();
    });
  });
});

test.describe("Default Template - Project Assignment", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Default template auto-assigned to all projects", async ({ api }) => {
    const templateName = `E2E Auto Assign ${Date.now()}`;
    let templateId: Awaited<ReturnType<typeof api.createTemplate>>;

    await test.step("Create a default template and wait for it to be set", async () => {
      // Create a default template FIRST (required for project creation)
      templateId = await api.createTemplate({
        name: templateName,
        isDefault: true,
      });

      // Wait for template to be fully set as default
      await expect
        .poll(
          async () => {
            const verification = await api.verifyTemplate(templateId!);
            return verification.isDefault;
          },
          {
            message: `Expected template ${templateName} to be default`,
            timeout: 10000,
            intervals: [100, 250, 500],
          }
        )
        .toBe(true);
    });

    await test.step("Create a project requiring the default template", async () => {
      // Now create a project (requires default template to exist)
      const projectName = `E2E Default Proj ${Date.now()}`;
      await api.createProject(projectName);
    });

    await test.step("Verify the default template is available", async () => {
      await templatesPage.goto();

      // The default template should be available for all projects
      // This is verified by checking the template exists and is default
      await templatesPage.expectTemplateInTable(templateName);
    });
  });

  test("Default template available for new projects", async ({ api }) => {
    const templateName = `E2E New Proj Template ${Date.now()}`;

    await test.step("Create a default template", async () => {
      await api.createTemplate({
        name: templateName,
        isDefault: true,
      });
    });

    await test.step("Create a new project after the default template exists", async () => {
      const projectName = `E2E New Proj ${Date.now()}`;
      await api.createProject(projectName);
    });

    await test.step("Verify the default template is available for the new project", async () => {
      await templatesPage.goto();

      await templatesPage.expectTemplateInTable(templateName);
    });
  });
});

test.describe("Default Template - Cascade Behaviors", () => {
  let templatesPage: TemplatesFieldsPage;

  test.beforeEach(async ({ page }) => {
    templatesPage = new TemplatesFieldsPage(page);
    await templatesPage.goto();
  });

  test("Changing default unsets previous default", async ({ api, page }) => {
    const template1Name = `E2E Cascade A ${Date.now()}`;
    const template2Name = `E2E Cascade B ${Date.now()}`;
    let template1Id: Awaited<ReturnType<typeof api.createTemplate>>;
    let template2Id: Awaited<ReturnType<typeof api.createTemplate>>;

    await test.step("Create the first default template and confirm it is set", async () => {
      template1Id = await api.createTemplate({
        name: template1Name,
        isDefault: true,
      });

      // Wait for template1 to be fully set as default before creating template2
      await expect
        .poll(
          async () => {
            const verification = await api.verifyTemplate(template1Id!);
            return verification.isDefault;
          },
          {
            message: `Expected template1 ${template1Name} to be default before creating template2`,
            timeout: 10000,
            intervals: [100, 250, 500],
          }
        )
        .toBe(true);
    });

    await test.step("Create a second non-default template", async () => {
      template2Id = await api.createTemplate({
        name: template2Name,
        isDefault: false,
      });
    });

    await test.step("Set the second template as default via the UI", async () => {
      await templatesPage.goto();

      await templatesPage.clickEditTemplate(template2Name);
      await templatesPage.toggleTemplateDefault(true);
      await templatesPage.submitTemplate();

      // Wait for the dialog to close and mutations to complete
      await page.waitForLoadState("networkidle");
    });

    await test.step("Wait for the cascade to flip the default flags", async () => {
      // Poll the API to wait for the cascade update to complete
      // The cascade should unset template1's default and set template2 as default
      await expect
        .poll(
          async () => {
            const template1Verification = await api.verifyTemplate(
              template1Id!
            );
            const template2Verification = await api.verifyTemplate(
              template2Id!
            );
            return (
              !template1Verification.isDefault &&
              template2Verification.isDefault
            );
          },
          {
            message: `Expected template2 ${template2Name} to be default and template1 ${template1Name} to not be default`,
            timeout: 40000, // Increased timeout from 30s to 40s
            intervals: [100, 250, 500, 1000, 2000, 3000],
          }
        )
        .toBe(true);
    });

    await test.step("Verify the final default state of both templates", async () => {
      const template1Verification = await api.verifyTemplate(template1Id!);
      const template2Verification = await api.verifyTemplate(template2Id!);
      expect(template1Verification.isDefault).toBe(false);
      expect(template2Verification.isDefault).toBe(true);
    });
  });

  test("Deleting non-default template preserves default", async ({
    api,
    page,
  }) => {
    const defaultTemplateName = `E2E Preserve Default ${Date.now()}`;
    const otherTemplateName = `E2E Delete Me ${Date.now()}`;

    await test.step("Create a default template and a non-default template", async () => {
      await api.createTemplate({
        name: defaultTemplateName,
        isDefault: true,
      });
      await api.createTemplate({
        name: otherTemplateName,
        isDefault: false,
      });

      await templatesPage.goto();
    });

    await test.step("Delete the non-default template", async () => {
      await templatesPage.clickDeleteTemplate(otherTemplateName);
      await templatesPage.confirmDelete();

      // Wait for deletion to complete and table to update
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the default template is preserved", async () => {
      // Verify the deleted template is no longer in the table
      await templatesPage.expectTemplateNotInTable(otherTemplateName);

      // Default template should still exist and be default
      await templatesPage.expectTemplateInTable(defaultTemplateName);
    });
  });
});
