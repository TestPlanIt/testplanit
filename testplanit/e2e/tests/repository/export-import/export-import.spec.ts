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

    // Create a folder to import into
    const uniqueId = Date.now();
    const folderName = `Import CSV Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Look for import button
    const importButton = page.locator('[data-testid="import-button"], button:has-text("Import")').first();
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();

    // Import dialog should open
    const importDialog = page.locator('[role="dialog"], [data-testid="import-dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // Select CSV option if there's a format selector
    const csvOption = importDialog.locator('[data-testid="import-csv"], button:has-text("CSV"), label:has-text("CSV")').first();
    if (await csvOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await csvOption.click();
    }

    // Create a CSV file with test case data
    const case1Name = `Imported Case 1 ${uniqueId}`;
    const case2Name = `Imported Case 2 ${uniqueId}`;
    const csvContent = `name,description
${case1Name},Description for case 1
${case2Name},Description for case 2`;

    // Find the file input and upload the CSV
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });

    // Create a temporary file buffer for the CSV
    const buffer = Buffer.from(csvContent, "utf-8");
    await fileInput.setInputFiles({
      name: "import-test-cases.csv",
      mimeType: "text/csv",
      buffer: buffer,
    });

    // Wait for the file to be processed
    await page.waitForLoadState("networkidle");

    // Look for and click the import/submit button
    const importSubmit = importDialog.locator('button:has-text("Import"), button[type="submit"]').first();
    await expect(importSubmit).toBeEnabled({ timeout: 10000 });
    await importSubmit.click();

    // Wait for import to complete
    await page.waitForLoadState("networkidle");

    // Dialog should close after successful import
    await expect(importDialog.first()).not.toBeVisible({ timeout: 15000 });

    // Verify the imported test cases are visible in the folder
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({ timeout: 5000 });
  });

  test("Import CSV - Field Mapping", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const importButton = page.locator('[data-testid="import-button"]').first();
    await expect(importButton).toBeVisible({ timeout: 5000 });
    await importButton.click();

    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // After uploading a file, field mapping step should appear
    // This is a placeholder - actual test would need to upload a file
    const mappingStep = page.locator('[data-testid="field-mapping"], text=/map.*fields/i');
    // Would verify mapping UI exists after file upload

    await page.keyboard.press("Escape");
  });

  test("Import CSV - Validation Errors", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const importButton = page.locator('[data-testid="import-button"]').first();
    await expect(importButton).toBeVisible({ timeout: 5000 });
    await importButton.click();

    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // After uploading an invalid file, errors should be shown
    // This is a placeholder - actual test would upload invalid CSV
    const errorDisplay = page.locator('[data-testid="validation-errors"], .error-list');
    // Would verify error display after uploading invalid file

    await page.keyboard.press("Escape");
  });

  test("Import CSV - Skip Invalid Rows", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const importButton = page.locator('[data-testid="import-button"]').first();
    await expect(importButton).toBeVisible({ timeout: 5000 });
    await importButton.click();

    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // Look for "Skip invalid rows" option
    const skipOption = importDialog.locator('[data-testid="skip-invalid"], text=/skip invalid/i');
    await expect(skipOption).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
  });

  test("Export Test Cases to CSV", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases with unique, identifiable names
    const uniqueId = Date.now();
    const folderName = `Export CSV Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Name = `Export Case 1 ${uniqueId}`;
    const case2Name = `Export Case 2 ${uniqueId}`;
    await api.createTestCase(projectId, folderId, case1Name);
    await api.createTestCase(projectId, folderId, case2Name);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify test cases are visible before export
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({ timeout: 5000 });

    // Click export button
    const exportButton = page.locator('[data-testid="export-button"], button:has-text("Export")').first();
    await expect(exportButton).toBeVisible({ timeout: 10000 });
    await exportButton.click();

    // Export dialog should open
    const exportDialog = page.locator('[role="dialog"], [data-testid="export-dialog"]');
    await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

    // Select CSV format if there's a format selector
    const csvFormat = exportDialog.locator('[data-testid="format-csv"], [data-value="csv"], label:has-text("CSV")').first();
    if (await csvFormat.isVisible({ timeout: 3000 }).catch(() => false)) {
      await csvFormat.click();
    }

    // Find and click the export submit button
    const exportSubmit = exportDialog.locator('button:has-text("Export"), button[type="submit"]').first();
    await expect(exportSubmit).toBeEnabled({ timeout: 5000 });

    // Set up download listener before triggering export
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });

    await exportSubmit.click();

    // Wait for the download to complete
    const download = await downloadPromise;

    // Verify the download has a CSV filename
    const filename = download.suggestedFilename();
    expect(filename.toLowerCase()).toContain(".csv");

    // Save the file temporarily and read its contents
    const filePath = await download.path();
    expect(filePath).not.toBeNull();

    // Read the CSV content
    const fs = await import("fs/promises");
    const csvContent = await fs.readFile(filePath!, "utf-8");

    // Validate CSV structure and content
    // CSV should have a header row and at least 2 data rows (our test cases)
    const lines = csvContent.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3); // Header + 2 test cases

    // Header should contain expected column names (case-insensitive check)
    const headerLower = lines[0].toLowerCase();
    expect(headerLower).toContain("name"); // Should have a name column

    // Content should include our test case names
    expect(csvContent).toContain(case1Name);
    expect(csvContent).toContain(case2Name);

    // Dialog should close after successful export
    await expect(exportDialog.first()).not.toBeVisible({ timeout: 5000 });
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
    await expect(exportButton).toBeVisible({ timeout: 5000 });
    await exportButton.click();

    const exportDialog = page.locator('[role="dialog"]');
    await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

    // Look for column selection
    const columnSelection = exportDialog.locator('[data-testid="column-selection"], text=/columns/i');
    await expect(columnSelection).toBeVisible({ timeout: 3000 });
    await columnSelection.click();

    // Toggle specific columns
    const columnCheckboxes = exportDialog.locator('[data-testid="column-checkbox"], input[type="checkbox"]');
    expect(await columnCheckboxes.count()).toBeGreaterThan(0);

    // Deselect some columns
    await columnCheckboxes.first().click();
    expect(await columnCheckboxes.first().isChecked()).toBe(false);

    await page.keyboard.press("Escape");
  });
});
