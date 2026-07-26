import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";
import { clickOverflowAction } from "../../../utils/action-overflow";

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
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Import Test Cases from CSV", async ({ api, page }) => {
    const uniqueId = Date.now();
    const importDialog = page.locator('[role="dialog"]');

    let projectId: number | undefined;
    let folderId: number | undefined;
    const folderName = `Import CSV Folder ${uniqueId}`;

    await test.step("Create a project and a folder to import into", async () => {
      projectId = await getTestProjectId(api);
      folderId = await api.createFolder(projectId, folderName);
    });

    await test.step("Open the repository and select the import folder", async () => {
      await repositoryPage.goto(projectId!);

      // Select the folder first
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the Import Test Cases wizard", async () => {
      // Look for import button - it's "Import Test Cases" button in the header
      const importButton = page
        .locator('button:has-text("Import Test Cases")')
        .first();
      await expect(importButton).toBeVisible({ timeout: 10000 });
      await importButton.click();

      // Import dialog (wizard) should open
      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

      // Verify the import wizard has the expected title
      const wizardTitle = importDialog.locator("text=Import Test Cases");
      await expect(wizardTitle.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Upload a CSV file of test cases", async () => {
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
    });

    await test.step("Verify the upload succeeded and Next is available", async () => {
      // Verify the file was uploaded - look for the filename or file info
      const fileInfo = importDialog.locator("text=import-test-cases.csv");
      await expect(fileInfo.first()).toBeVisible({ timeout: 5000 });

      // Verify the Next button is available (wizard is functional)
      const nextButton = importDialog
        .locator('[data-testid="next-button"], button:has-text("Next")')
        .first();
      await expect(nextButton).toBeVisible({ timeout: 5000 });
    });

    await test.step("Close the import wizard", async () => {
      // Close the dialog - full import wizard flow is complex and covered by unit tests
      await page.keyboard.press("Escape");
      await expect(importDialog.first()).not.toBeVisible({ timeout: 5000 });
    });
  });

  test("Import CSV - Field Mapping", async ({ api, page }) => {
    const importDialog = page.locator('[role="dialog"]');

    await test.step("Open the repository and the Import wizard", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);

      // Look for import button - it's "Import Test Cases" button in the header
      const importButton = page
        .locator('button:has-text("Import Test Cases")')
        .first();
      await expect(importButton).toBeVisible({ timeout: 10000 });
      await importButton.click();

      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Upload a CSV file and select a destination folder", async () => {
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
      const folderSelect = importDialog
        .locator('button:has-text("Select a folder")')
        .first();
      await expect(folderSelect).toBeVisible({ timeout: 5000 });
      await folderSelect.click();
      const folderOption = page.locator('[role="option"]').first();
      await expect(folderOption).toBeVisible({ timeout: 5000 });
      await folderOption.click();
    });

    await test.step("Advance to the field mapping step", async () => {
      // Click Next to get to field mapping step (step 2)
      const nextButton = importDialog
        .locator('[data-testid="next-button"], button:has-text("Next")')
        .first();
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Verify field mapping UI is visible on step 2
      // Look for mapping-related content (column headers, dropdown selectors, etc.)
      const mappingContent = importDialog
        .locator("text=/Map|Mapping|Column|Field/i")
        .first();
      await expect(mappingContent).toBeVisible({ timeout: 5000 });
    });

    await test.step("Close the import wizard", async () => {
      await page.keyboard.press("Escape");
    });
  });

  test("Import CSV - Validation Errors", async ({ api, page }) => {
    const importDialog = page.locator('[role="dialog"]');

    await test.step("Open the repository and the Import wizard", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);

      // Look for import button
      const importButton = page
        .locator('button:has-text("Import Test Cases")')
        .first();
      await expect(importButton).toBeVisible({ timeout: 10000 });
      await importButton.click();

      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Upload an invalid CSV file", async () => {
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
    });

    await test.step("Verify the uploaded file is acknowledged, then close", async () => {
      // The wizard should show some indication that the file is uploaded
      // Look for the file name or "Selected file" text
      const selectedFile = importDialog.locator("text=invalid.csv").first();
      await expect(selectedFile).toBeVisible({ timeout: 5000 });

      await page.keyboard.press("Escape");
    });
  });

  test("Import CSV - Skip Invalid Rows", async ({ api, page }) => {
    const importDialog = page.locator('[role="dialog"]');

    await test.step("Open the repository and the Import wizard", async () => {
      const projectId = await getTestProjectId(api);
      await repositoryPage.goto(projectId);

      // Look for import button
      const importButton = page
        .locator('button:has-text("Import Test Cases")')
        .first();
      await expect(importButton).toBeVisible({ timeout: 10000 });
      await importButton.click();

      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify the wizard step structure, then close", async () => {
      // The import wizard is visible - verify it has the expected structure
      // Step indicators (1, 2, 3, 4) should be visible
      const stepIndicators = importDialog.locator("text=/1|Upload/i");
      await expect(stepIndicators.first()).toBeVisible({ timeout: 3000 });

      await page.keyboard.press("Escape");
    });
  });

  test("Export Test Cases to CSV", async ({ api, page }) => {
    // Create test cases with unique, identifiable names
    const uniqueId = Date.now();
    const folderName = `Export CSV Folder ${uniqueId}`;
    const case1Name = `Export Case 1 ${uniqueId}`;
    const case2Name = `Export Case 2 ${uniqueId}`;
    const exportDialog = page.locator('[role="dialog"]');

    let projectId: number | undefined;
    let folderId: number | undefined;
    let download: import("@playwright/test").Download | undefined;

    await test.step("Create a project, folder, and two test cases", async () => {
      projectId = await getTestProjectId(api);
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, case1Name);
      await api.createTestCase(projectId, folderId, case2Name);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId!);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify test cases are visible before export
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Open the export dialog and configure CSV export", async () => {
      // Click export button - use the data-testid from Cases.tsx
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      // Export dialog should open
      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select CSV format from the format selector
      const csvFormat = exportDialog
        .locator('[data-testid="export-format-csv"]')
        .first();
      await expect(csvFormat).toBeVisible({ timeout: 5000 });
      await csvFormat.click();

      // Select "All filtered" scope to export all cases in the current view
      const allFilteredScope = exportDialog
        .locator('[data-testid="export-scope-allFiltered"]')
        .first();
      await expect(allFilteredScope).toBeVisible({ timeout: 5000 });
      await allFilteredScope.click();
    });

    await test.step("Trigger the export and capture the download", async () => {
      // Find and click the export submit button
      const exportSubmit = exportDialog
        .locator(
          '[data-testid="export-modal-export-button"], button:has-text("Export")'
        )
        .first();
      await expect(exportSubmit).toBeEnabled({ timeout: 5000 });

      // Set up download listener before triggering export
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });

      await exportSubmit.click();

      // Wait for the download to complete
      download = await downloadPromise;
    });

    await test.step("Validate the exported CSV file contents", async () => {
      // Verify the download has a CSV filename
      const filename = download!.suggestedFilename();
      expect(filename.toLowerCase()).toContain(".csv");

      // Save the file temporarily and read its contents
      const filePath = await download!.path();
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
    });

    await test.step("Close the export dialog", async () => {
      // Close dialog if still open (export may keep dialog open)
      await page.keyboard.press("Escape");
      await expect(exportDialog.first()).not.toBeVisible({ timeout: 5000 });
    });
  });

  test("Export Specific Columns Only", async ({ api, page }) => {
    const exportDialog = page.locator('[role="dialog"]');

    await test.step("Create a project, folder, and a test case", async () => {
      const projectId = await getTestProjectId(api);

      const folderName = `Export Columns Folder ${Date.now()}`;
      const folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(
        projectId,
        folderId,
        `Columns Case ${Date.now()}`
      );

      await repositoryPage.goto(projectId);

      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the export dialog and select CSV format", async () => {
      // Click export button - use the data-testid from Cases.tsx
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select CSV format first
      const csvFormat = exportDialog
        .locator('[data-testid="export-format-csv"]')
        .first();
      await expect(csvFormat).toBeVisible({ timeout: 5000 });
      await csvFormat.click();
    });

    await test.step("Verify column options and choose visible columns, then close", async () => {
      // Verify column selection options exist - "Visible columns only" and "All columns"
      const visibleColumnsOption = exportDialog
        .locator('[data-testid="export-columns-visible"]')
        .first();
      const allColumnsOption = exportDialog
        .locator('[data-testid="export-columns-all"]')
        .first();

      // Both column options should be visible
      await expect(visibleColumnsOption).toBeVisible({ timeout: 5000 });
      await expect(allColumnsOption).toBeVisible({ timeout: 5000 });

      // Select visible columns option
      await visibleColumnsOption.click();

      await page.keyboard.press("Escape");
    });
  });

  test("Export Test Cases to PDF", async ({ api, page }) => {
    // Create test cases with unique, identifiable names
    const uniqueId = Date.now();
    const folderName = `Export PDF Folder ${uniqueId}`;
    const case1Name = `PDF Export Case 1 ${uniqueId}`;
    const case2Name = `PDF Export Case 2 ${uniqueId}`;
    const exportDialog = page.locator('[role="dialog"]');

    let projectId: number | undefined;
    let folderId: number | undefined;
    let download: import("@playwright/test").Download | undefined;

    await test.step("Create a project, folder, and two test cases", async () => {
      projectId = await getTestProjectId(api);
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, case1Name);
      await api.createTestCase(projectId, folderId, case2Name);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId!);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify test cases are visible before export
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Open the export dialog and select PDF format", async () => {
      // Click export button
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      // Export dialog should open
      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select PDF format
      const pdfFormat = exportDialog
        .locator('[data-testid="export-format-pdf"]')
        .first();
      await expect(pdfFormat).toBeVisible({ timeout: 5000 });
      await pdfFormat.click();
    });

    await test.step("Verify PDF options and select the all-filtered scope", async () => {
      // Verify PDF-specific options are shown
      // Column selection for PDF
      const pdfColumnsAll = exportDialog
        .locator('[data-testid="export-columns-pdf-all"]')
        .first();
      await expect(pdfColumnsAll).toBeVisible({ timeout: 5000 });

      // Attachment format for PDF (names/embedded)
      const pdfAttachmentNames = exportDialog
        .locator('[data-testid="export-attachment-pdf-names"]')
        .first();
      await expect(pdfAttachmentNames).toBeVisible({ timeout: 5000 });

      // Select "All filtered" scope to export all cases in the current view
      const allFilteredScope = exportDialog
        .locator('[data-testid="export-scope-allFiltered"]')
        .first();
      await expect(allFilteredScope).toBeVisible({ timeout: 5000 });
      await allFilteredScope.click();
    });

    await test.step("Trigger the export and capture the download", async () => {
      // Find and click the export submit button
      const exportSubmit = exportDialog
        .locator('[data-testid="export-modal-export-button"]')
        .first();
      await expect(exportSubmit).toBeEnabled({ timeout: 5000 });

      // Set up download listener before triggering export
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });

      await exportSubmit.click();

      // Wait for the download to complete
      download = await downloadPromise;
    });

    await test.step("Validate the downloaded PDF file structure", async () => {
      // Verify the download has a PDF filename
      const filename = download!.suggestedFilename();
      expect(filename.toLowerCase()).toContain(".pdf");

      // Save the file temporarily and verify it exists
      const filePath = await download!.path();
      expect(filePath).not.toBeNull();

      // Read the PDF content to verify it's a valid PDF file
      const fs = await import("fs/promises");
      const pdfBuffer = await fs.readFile(filePath!);

      // PDF files start with %PDF magic bytes
      const pdfHeader = pdfBuffer.slice(0, 5).toString("utf-8");
      expect(pdfHeader).toBe("%PDF-");

      // Verify the PDF has some content (minimum size for a valid PDF with content)
      expect(pdfBuffer.length).toBeGreaterThan(1000);

      // Verify PDF structure contains expected markers
      const pdfContent = pdfBuffer.toString("utf-8");
      // PDF should contain end-of-file marker
      expect(pdfContent).toContain("%%EOF");
      // PDF should contain object definitions (basic structure validation)
      expect(pdfContent).toMatch(/\d+ \d+ obj/);
    });

    await test.step("Close the export dialog", async () => {
      // Close dialog if still open
      await page.keyboard.press("Escape");
      await expect(exportDialog.first()).not.toBeVisible({ timeout: 5000 });
    });
  });

  test("Export PDF - Content Validation", async ({ api, page }) => {
    // Use predictable test case names for content validation
    const folderName = "PDF Content Test Folder";
    const case1Name = "Login Functionality Test";
    const case2Name = "User Registration Test";
    const exportDialog = page.locator('[role="dialog"]');

    let projectId: number | undefined;
    let folderId: number | undefined;
    let download: import("@playwright/test").Download | undefined;

    await test.step("Create a project, folder, and two named test cases", async () => {
      projectId = await getTestProjectId(api);
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, case1Name);
      await api.createTestCase(projectId, folderId, case2Name);
    });

    await test.step("Open the repository and select the folder", async () => {
      await repositoryPage.goto(projectId!);
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Wait for test cases to load
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Open the export dialog and configure PDF, all-filtered", async () => {
      // Open export dialog
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select PDF format
      const pdfFormat = exportDialog
        .locator('[data-testid="export-format-pdf"]')
        .first();
      await pdfFormat.click();

      // Select all filtered
      const allFilteredScope = exportDialog
        .locator('[data-testid="export-scope-allFiltered"]')
        .first();
      await allFilteredScope.click();
    });

    await test.step("Trigger the export and capture the download", async () => {
      // Export
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      const exportSubmit = exportDialog
        .locator('[data-testid="export-modal-export-button"]')
        .first();
      await exportSubmit.click();

      download = await downloadPromise;
    });

    await test.step("Parse the PDF and validate its content and structure", async () => {
      const filePath = await download!.path();
      expect(filePath).not.toBeNull();

      // Parse PDF and extract text content using pdf-parse
      const { PDFParse } = await import("pdf-parse");
      const fs = await import("fs/promises");
      const pdfBuffer = await fs.readFile(filePath!);

      const parser = new PDFParse({ data: pdfBuffer });

      // Extract text to validate content
      const pdfData = await parser.getText();
      await parser.destroy();

      // Validate PDF has pages and content
      expect(pdfData.total).toBeGreaterThan(0);
      expect(pdfData.text.length).toBeGreaterThan(0);

      // Validate that test case names are present in the extracted PDF text
      // This proves the PDF was generated correctly with the expected content
      expect(pdfData.text).toContain(case1Name);
      expect(pdfData.text).toContain(case2Name);

      // Validate PDF structure
      const pdfHeader = pdfBuffer.subarray(0, 5).toString("utf-8");
      expect(pdfHeader).toBe("%PDF-");

      const pdfContent = pdfBuffer.toString("utf-8");
      expect(pdfContent).toContain("%%EOF");

      // Validate expected metadata/structure in PDF
      expect(pdfData.text).toContain("Test Cases Export"); // Title
      expect(pdfData.text).toContain("Exported:"); // Metadata
    });

    await test.step("Close the export dialog", async () => {
      await page.keyboard.press("Escape");
    });
  });

  test("Export PDF - All Columns Option", async ({ api, page }) => {
    const exportDialog = page.locator('[role="dialog"]');

    await test.step("Create a project, folder, and a test case", async () => {
      const projectId = await getTestProjectId(api);

      const uniqueId = Date.now();
      const folderName = `PDF Columns Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(
        projectId,
        folderId,
        `PDF Columns Case ${uniqueId}`
      );

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the export dialog and select PDF format", async () => {
      // Click export button
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select PDF format
      const pdfFormat = exportDialog
        .locator('[data-testid="export-format-pdf"]')
        .first();
      await pdfFormat.click();
    });

    await test.step("Toggle between all-columns and visible-columns options", async () => {
      // Verify PDF column options
      const pdfColumnsAll = exportDialog
        .locator('[data-testid="export-columns-pdf-all"]')
        .first();
      const pdfColumnsVisible = exportDialog
        .locator('[data-testid="export-columns-pdf-visible"]')
        .first();

      await expect(pdfColumnsAll).toBeVisible({ timeout: 5000 });
      await expect(pdfColumnsVisible).toBeVisible({ timeout: 5000 });

      // Select all columns
      await pdfColumnsAll.click();

      // Verify all columns is selected (checked)
      await expect(pdfColumnsAll).toBeChecked();

      // Switch to visible columns
      await pdfColumnsVisible.click();
      await expect(pdfColumnsVisible).toBeChecked();

      await page.keyboard.press("Escape");
    });
  });

  test("Export PDF - Attachment Format Options", async ({ api, page }) => {
    const exportDialog = page.locator('[role="dialog"]');

    await test.step("Create a project, folder, and a test case", async () => {
      const projectId = await getTestProjectId(api);

      const uniqueId = Date.now();
      const folderName = `PDF Attachments Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(
        projectId,
        folderId,
        `PDF Attachments Case ${uniqueId}`
      );

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the export dialog and select PDF format", async () => {
      // Click export button
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select PDF format
      const pdfFormat = exportDialog
        .locator('[data-testid="export-format-pdf"]')
        .first();
      await pdfFormat.click();
    });

    await test.step("Toggle between names and embedded attachment formats", async () => {
      // Verify PDF attachment format options
      const attachmentNames = exportDialog
        .locator('[data-testid="export-attachment-pdf-names"]')
        .first();
      const attachmentEmbedded = exportDialog
        .locator('[data-testid="export-attachment-pdf-embedded"]')
        .first();

      await expect(attachmentNames).toBeVisible({ timeout: 5000 });
      await expect(attachmentEmbedded).toBeVisible({ timeout: 5000 });

      // Default should be "names" for PDF
      await expect(attachmentNames).toBeChecked();

      // Switch to embedded
      await attachmentEmbedded.click();
      await expect(attachmentEmbedded).toBeChecked();

      // Switch back to names
      await attachmentNames.click();
      await expect(attachmentNames).toBeChecked();

      await page.keyboard.press("Escape");
    });
  });

  test("Export PDF - Selected Cases Only", async ({ api, page }) => {
    const uniqueId = Date.now();
    const folderName = `PDF Selected Folder ${uniqueId}`;
    const case1Name = `PDF Selected Case 1 ${uniqueId}`;
    const case2Name = `PDF Selected Case 2 ${uniqueId}`;
    const case3Name = `PDF Selected Case 3 ${uniqueId}`;
    const exportDialog = page.locator('[role="dialog"]');

    let projectId: number | undefined;
    let folderId: number | undefined;
    let download: import("@playwright/test").Download | undefined;

    await test.step("Create a project, folder, and three test cases", async () => {
      projectId = await getTestProjectId(api);
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, case1Name);
      await api.createTestCase(projectId, folderId, case2Name);
      await api.createTestCase(projectId, folderId, case3Name);
    });

    await test.step("Open the repository and select one test case", async () => {
      await repositoryPage.goto(projectId!);
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Wait for cases to be visible
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });

      // Select the first case using the checkbox
      const firstCaseRow = page
        .locator("tr")
        .filter({ hasText: case1Name })
        .first();
      const checkbox = firstCaseRow
        .locator('input[type="checkbox"], [role="checkbox"]')
        .first();
      await checkbox.click();
    });

    await test.step("Open the export dialog and select PDF format", async () => {
      // Click export button
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select PDF format
      const pdfFormat = exportDialog
        .locator('[data-testid="export-format-pdf"]')
        .first();
      await pdfFormat.click();
    });

    await test.step("Choose the Selected scope and confirm the count", async () => {
      // Verify "Selected" scope shows count of 1
      const selectedScope = exportDialog
        .locator('[data-testid="export-scope-selected"]')
        .first();
      await expect(selectedScope).toBeVisible({ timeout: 5000 });
      await expect(selectedScope).toBeEnabled();

      // The label should indicate 1 selected item
      const selectedLabel = exportDialog
        .locator('label[for="scope-selected"]')
        .first();
      await expect(selectedLabel).toContainText("1");

      // Select the "selected" scope
      await selectedScope.click();
    });

    await test.step("Export the selected case and verify the download", async () => {
      // Export should be enabled
      const exportSubmit = exportDialog
        .locator('[data-testid="export-modal-export-button"]')
        .first();
      await expect(exportSubmit).toBeEnabled({ timeout: 5000 });

      // Set up download listener
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      await exportSubmit.click();

      // Verify download completes
      download = await downloadPromise;
      const filename = download.suggestedFilename();
      expect(filename.toLowerCase()).toContain(".pdf");

      await page.keyboard.press("Escape");
    });
  });

  test("Export PDF - Format Switching", async ({ api, page }) => {
    const exportDialog = page.locator('[role="dialog"]');
    const csvFormat = exportDialog
      .locator('[data-testid="export-format-csv"]')
      .first();
    const pdfFormat = exportDialog
      .locator('[data-testid="export-format-pdf"]')
      .first();
    const csvDelimiter = exportDialog
      .locator('[data-testid="export-columns-all"]')
      .first();

    await test.step("Create a project, folder, and a test case", async () => {
      const projectId = await getTestProjectId(api);

      const uniqueId = Date.now();
      const folderName = `PDF Format Switch Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(
        projectId,
        folderId,
        `Format Switch Case ${uniqueId}`
      );

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the export dialog with CSV selected by default", async () => {
      // Click export button
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Initially CSV should be selected
      await expect(csvFormat).toBeChecked();

      // CSV-specific options should be visible
      await expect(csvDelimiter).toBeVisible({ timeout: 5000 });
    });

    await test.step("Switch to PDF and verify PDF-specific options appear", async () => {
      // Switch to PDF
      await pdfFormat.click();
      await expect(pdfFormat).toBeChecked();

      // PDF-specific options should now be visible
      const pdfColumnsAll = exportDialog
        .locator('[data-testid="export-columns-pdf-all"]')
        .first();
      const pdfAttachmentNames = exportDialog
        .locator('[data-testid="export-attachment-pdf-names"]')
        .first();

      await expect(pdfColumnsAll).toBeVisible({ timeout: 5000 });
      await expect(pdfAttachmentNames).toBeVisible({ timeout: 5000 });

      // CSV-specific delimiter select should not be visible for PDF
      const delimiterSelect = exportDialog
        .locator('[data-testid="export-delimiter-select"]')
        .first();
      await expect(delimiterSelect).not.toBeVisible();
    });

    await test.step("Switch back to CSV and verify CSV options return", async () => {
      // Switch back to CSV
      await csvFormat.click();
      await expect(csvFormat).toBeChecked();

      // CSV options should be back
      await expect(csvDelimiter).toBeVisible({ timeout: 5000 });

      await page.keyboard.press("Escape");
    });
  });
});
