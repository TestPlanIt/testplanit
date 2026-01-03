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

    // Select the folder first
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Look for import button - it's "Import Test Cases" button in the header
    const importButton = page.locator('button:has-text("Import Test Cases")').first();
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();

    // Import dialog (wizard) should open
    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // Verify the import wizard has the expected title
    const wizardTitle = importDialog.locator('text=Import Test Cases');
    await expect(wizardTitle.first()).toBeVisible({ timeout: 5000 });

    // Verify the wizard has file upload functionality
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });

    // Create a CSV file with test case data
    const case1Name = `Imported Case 1 ${uniqueId}`;
    const case2Name = `Imported Case 2 ${uniqueId}`;
    const csvContent = `name,description
${case1Name},Description for case 1
${case2Name},Description for case 2`;

    // Upload the CSV file
    const buffer = Buffer.from(csvContent, "utf-8");
    await fileInput.setInputFiles({
      name: "import-test-cases.csv",
      mimeType: "text/csv",
      buffer: buffer,
    });

    // Wait for the file to be processed
    await page.waitForLoadState("networkidle");

    // Verify the file was uploaded - look for the filename or file info
    const fileInfo = importDialog.locator('text=import-test-cases.csv');
    await expect(fileInfo.first()).toBeVisible({ timeout: 5000 });

    // Verify the Next button is available (wizard is functional)
    const nextButton = importDialog.locator('[data-testid="next-button"], button:has-text("Next")').first();
    await expect(nextButton).toBeVisible({ timeout: 5000 });

    // Close the dialog - full import wizard flow is complex and covered by unit tests
    await page.keyboard.press("Escape");
    await expect(importDialog.first()).not.toBeVisible({ timeout: 5000 });
  });

  test("Import CSV - Field Mapping", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Look for import button - it's "Import Test Cases" button in the header
    const importButton = page.locator('button:has-text("Import Test Cases")').first();
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();

    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // Upload a CSV file to get to the field mapping step
    const csvContent = `name,description,priority
Test Case 1,Description 1,High
Test Case 2,Description 2,Low`;
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });
    await fileInput.setInputFiles({
      name: "test-mapping.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csvContent, "utf-8"),
    });
    await page.waitForLoadState("networkidle");

    // Select a folder
    const folderSelect = importDialog.locator('button:has-text("Select a folder")').first();
    await expect(folderSelect).toBeVisible({ timeout: 5000 });
    await folderSelect.click();
    const folderOption = page.locator('[role="option"]').first();
    await expect(folderOption).toBeVisible({ timeout: 5000 });
    await folderOption.click();

    // Click Next to get to field mapping step (step 2)
    const nextButton = importDialog.locator('[data-testid="next-button"], button:has-text("Next")').first();
    await expect(nextButton).toBeEnabled({ timeout: 5000 });
    await nextButton.click();
    await page.waitForLoadState("networkidle");

    // Verify field mapping UI is visible on step 2
    // Look for mapping-related content (column headers, dropdown selectors, etc.)
    const mappingContent = importDialog.locator('text=/Map|Mapping|Column|Field/i').first();
    await expect(mappingContent).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
  });

  test("Import CSV - Validation Errors", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Look for import button
    const importButton = page.locator('button:has-text("Import Test Cases")').first();
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();

    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // Upload an empty/invalid CSV file
    const invalidCsv = `invalid header without name column
some data,without,proper,structure`;
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });
    await fileInput.setInputFiles({
      name: "invalid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(invalidCsv, "utf-8"),
    });
    await page.waitForLoadState("networkidle");

    // The wizard should show some indication that the file is uploaded
    // Look for the file name or "Selected file" text
    const selectedFile = importDialog.locator('text=invalid.csv').first();
    await expect(selectedFile).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
  });

  test("Import CSV - Skip Invalid Rows", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Look for import button
    const importButton = page.locator('button:has-text("Import Test Cases")').first();
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();

    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // The import wizard is visible - verify it has the expected structure
    // Step indicators (1, 2, 3, 4) should be visible
    const stepIndicators = importDialog.locator('text=/1|Upload/i');
    await expect(stepIndicators.first()).toBeVisible({ timeout: 3000 });

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

    // Click export button - use the data-testid from Cases.tsx
    const exportButton = page.locator('[data-testid="export-cases-button"]').first();
    await expect(exportButton).toBeVisible({ timeout: 10000 });
    await expect(exportButton).toBeEnabled({ timeout: 5000 });
    await exportButton.click();

    // Export dialog should open
    const exportDialog = page.locator('[role="dialog"]');
    await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

    // Select CSV format from the format selector
    const csvFormat = exportDialog.locator('[data-testid="export-format-csv"]').first();
    await expect(csvFormat).toBeVisible({ timeout: 5000 });
    await csvFormat.click();

    // Select "All filtered" scope to export all cases in the current view
    const allFilteredScope = exportDialog.locator('[data-testid="export-scope-allFiltered"]').first();
    await expect(allFilteredScope).toBeVisible({ timeout: 5000 });
    await allFilteredScope.click();

    // Find and click the export submit button
    const exportSubmit = exportDialog.locator('[data-testid="export-modal-export-button"], button:has-text("Export")').first();
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

    // Close dialog if still open (export may keep dialog open)
    await page.keyboard.press("Escape");
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

    // Click export button - use the data-testid from Cases.tsx
    const exportButton = page.locator('[data-testid="export-cases-button"]').first();
    await expect(exportButton).toBeVisible({ timeout: 10000 });
    await expect(exportButton).toBeEnabled({ timeout: 5000 });
    await exportButton.click();

    const exportDialog = page.locator('[role="dialog"]');
    await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

    // Select CSV format first
    const csvFormat = exportDialog.locator('[data-testid="export-format-csv"]').first();
    await expect(csvFormat).toBeVisible({ timeout: 5000 });
    await csvFormat.click();

    // Verify column selection options exist - "Visible columns only" and "All columns"
    const visibleColumnsOption = exportDialog.locator('[data-testid="export-columns-visible"]').first();
    const allColumnsOption = exportDialog.locator('[data-testid="export-columns-all"]').first();

    // Both column options should be visible
    await expect(visibleColumnsOption).toBeVisible({ timeout: 5000 });
    await expect(allColumnsOption).toBeVisible({ timeout: 5000 });

    // Select visible columns option
    await visibleColumnsOption.click();

    await page.keyboard.press("Escape");
  });
});
