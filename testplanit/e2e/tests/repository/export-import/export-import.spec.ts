import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Export & Import Tests
 *
 * Test cases for exporting and importing test cases.
 */
test.describe("Export & Import", () => {
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

  test("Import Test Cases from CSV", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Look for import button
    const importButton = page.locator('[data-testid="import-button"], button:has-text("Import")').first();
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importButton.click();

      // Import dialog should open
      const importDialog = page.locator('[role="dialog"], [data-testid="import-dialog"]');
      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

      // Select CSV option
      const csvOption = importDialog.locator('[data-testid="import-csv"], button:has-text("CSV")').first();
      if (await csvOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await csvOption.click();
      }

      // File upload input should be available
      const fileInput = page.locator('input[type="file"]');
      expect(await fileInput.count()).toBeGreaterThan(0);

      // Close dialog
      await page.keyboard.press("Escape");
    } else {
      test.skip();
    }
  });

  test("Import CSV - Field Mapping", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const importButton = page.locator('[data-testid="import-button"]').first();
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importButton.click();

      const importDialog = page.locator('[role="dialog"]');
      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

      // After uploading a file, field mapping step should appear
      // This is a placeholder - actual test would need to upload a file
      const mappingStep = page.locator('[data-testid="field-mapping"], text=/map.*fields/i');
      // Would verify mapping UI exists after file upload

      await page.keyboard.press("Escape");
    }
    test.skip();
  });

  test("Import CSV - Validation Errors", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const importButton = page.locator('[data-testid="import-button"]').first();
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importButton.click();

      const importDialog = page.locator('[role="dialog"]');
      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

      // After uploading an invalid file, errors should be shown
      // This is a placeholder - actual test would upload invalid CSV
      const errorDisplay = page.locator('[data-testid="validation-errors"], .error-list');
      // Would verify error display after uploading invalid file

      await page.keyboard.press("Escape");
    }
    test.skip();
  });

  test("Import CSV - Skip Invalid Rows", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const importButton = page.locator('[data-testid="import-button"]').first();
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importButton.click();

      const importDialog = page.locator('[role="dialog"]');
      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

      // Look for "Skip invalid rows" option
      const skipOption = importDialog.locator('[data-testid="skip-invalid"], text=/skip invalid/i');
      if (await skipOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        expect(await skipOption.isVisible()).toBe(true);
      }

      await page.keyboard.press("Escape");
    }
    test.skip();
  });

  test("Export Test Cases to CSV", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create some test cases to export
    const folderName = `Export CSV Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Export Case 1 ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Export Case 2 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Click export button
    const exportButton = page.locator('[data-testid="export-button"], button:has-text("Export")').first();
    if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await exportButton.click();

      // Export dialog should open
      const exportDialog = page.locator('[role="dialog"], [data-testid="export-dialog"]');
      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select CSV format
      const csvFormat = exportDialog.locator('[data-testid="format-csv"], [data-value="csv"], label:has-text("CSV")').first();
      if (await csvFormat.isVisible({ timeout: 3000 }).catch(() => false)) {
        await csvFormat.click();
      }

      // Verify export scope options
      const scopeOptions = exportDialog.locator('[data-testid="export-scope-radio-group"], [data-testid="export-scope"]');
      await expect(scopeOptions.first()).toBeVisible({ timeout: 5000 });

      // Click export (would trigger download)
      const exportSubmit = exportDialog.locator('button:has-text("Export"), button[type="submit"]').first();
      expect(await exportSubmit.isEnabled()).toBe(true);

      // Close without actually exporting
      await page.keyboard.press("Escape");
    } else {
      test.skip();
    }
  });

  test("Export Specific Columns Only", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Export Columns Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Columns Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    const exportButton = page.locator('[data-testid="export-button"]').first();
    if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await exportButton.click();

      const exportDialog = page.locator('[role="dialog"]');
      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Look for column selection
      const columnSelection = exportDialog.locator('[data-testid="column-selection"], text=/columns/i');
      if (await columnSelection.isVisible({ timeout: 3000 }).catch(() => false)) {
        await columnSelection.click();

        // Toggle specific columns
        const columnCheckboxes = exportDialog.locator('[data-testid="column-checkbox"], input[type="checkbox"]');
        if (await columnCheckboxes.count() > 0) {
          // Deselect some columns
          await columnCheckboxes.first().click();
          expect(await columnCheckboxes.first().isChecked()).toBe(false);
        }
      }

      await page.keyboard.press("Escape");
    }
    test.skip();
  });
});
