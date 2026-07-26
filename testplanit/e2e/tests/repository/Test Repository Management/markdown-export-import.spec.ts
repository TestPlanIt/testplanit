import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";
import { clickOverflowAction } from "../../../utils/action-overflow";

/**
 * Markdown Export & Import Tests
 *
 * Tests for the markdown format option in CSV export and
 * markdown auto-detection in CSV import.
 */
test.describe("Markdown Export & Import", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    return await api.createProject(`E2E Markdown Test ${Date.now()}`);
  }

  /**
   * Ensure the Description field is assigned to the project's template.
   * Other E2E tests can change which template is the default, so the
   * template assigned to a freshly-created project may not include
   * the Description field. This helper guarantees it is present.
   */
  async function ensureDescriptionFieldOnTemplate(
    api: import("../../../fixtures/api.fixture").ApiHelper,
    projectId: number
  ): Promise<{ descriptionFieldId: number; templateId: number }> {
    const caseFields = await api.getCaseFields();
    const descriptionField = caseFields.find(
      (f: { displayName: string }) => f.displayName === "Description"
    );
    if (!descriptionField) {
      throw new Error("No Description case field found in database");
    }

    const templateId = await api.getTemplateId(projectId);
    await api.assignFieldToTemplate(templateId, descriptionField.id);

    // Also ensure Steps and Expected Result fields are on the template
    // (needed for step markdown export tests)
    const stepsField = caseFields.find(
      (f: { displayName: string }) => f.displayName === "Steps"
    );
    const expectedField = caseFields.find(
      (f: { displayName: string }) => f.displayName === "Expected Result"
    );
    if (stepsField) await api.assignFieldToTemplate(templateId, stepsField.id);
    if (expectedField)
      await api.assignFieldToTemplate(templateId, expectedField.id);

    return { descriptionFieldId: descriptionField.id, templateId };
  }

  // Rich TipTap JSON with heading, bold, italic, and bullet list
  const RICH_TIPTAP_JSON = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Test Heading" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "Bold text" },
          { type: "text", text: " and " },
          { type: "text", marks: [{ type: "italic" }], text: "italic" },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Item 1" }],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Item 2" }],
              },
            ],
          },
        ],
      },
    ],
  };

  const STEP_TIPTAP_JSON = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Click " },
          { type: "text", marks: [{ type: "bold" }], text: "Submit" },
        ],
      },
    ],
  };

  const EXPECTED_RESULT_TIPTAP_JSON = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Form is submitted" }],
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Export Tests
  // ---------------------------------------------------------------------------

  test("CSV export - Markdown format options visible", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();

    const exportDialog = page.locator('[role="dialog"]');
    let textLongMarkdown: ReturnType<typeof exportDialog.locator> | undefined;
    let stepsMarkdown: ReturnType<typeof exportDialog.locator> | undefined;

    await test.step("Create project, folder, and a test case", async () => {
      const folderId = await api.createFolder(
        projectId,
        `MD Options Folder ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `MD Options Case ${uniqueId}`
      );

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open export modal", async () => {
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify Text Long and Steps markdown format options for CSV", async () => {
      // CSV is default - verify all three Text Long format options
      const textLongJson = exportDialog
        .locator('[data-testid="export-textlong-json"]')
        .first();
      const textLongPlainText = exportDialog
        .locator('[data-testid="export-textlong-plainText"]')
        .first();
      textLongMarkdown = exportDialog
        .locator('[data-testid="export-textlong-markdown"]')
        .first();

      await expect(textLongJson).toBeVisible({ timeout: 5000 });
      await expect(textLongPlainText).toBeVisible({ timeout: 5000 });
      await expect(textLongMarkdown).toBeVisible({ timeout: 5000 });

      // Verify JSON is checked by default
      await expect(textLongJson).toBeChecked();

      // Verify all three Steps format options
      const stepsJson = exportDialog
        .locator('[data-testid="export-steps-json"]')
        .first();
      const stepsPlainText = exportDialog
        .locator('[data-testid="export-steps-plainText"]')
        .first();
      stepsMarkdown = exportDialog
        .locator('[data-testid="export-steps-markdown"]')
        .first();

      await expect(stepsJson).toBeVisible({ timeout: 5000 });
      await expect(stepsPlainText).toBeVisible({ timeout: 5000 });
      await expect(stepsMarkdown).toBeVisible({ timeout: 5000 });
    });

    await test.step("Select Markdown for Text Long and Steps", async () => {
      // Click markdown for Text Long and verify it becomes checked
      await textLongMarkdown!.click();
      await expect(textLongMarkdown!).toBeChecked();

      // Click markdown for Steps and verify it becomes checked
      await stepsMarkdown!.click();
      await expect(stepsMarkdown!).toBeChecked();
    });

    await test.step("Switch to PDF and verify markdown options disappear", async () => {
      const pdfFormat = exportDialog
        .locator('[data-testid="export-format-pdf"]')
        .first();
      await pdfFormat.click();

      // Text Long format radio group should not be visible in PDF mode
      const textLongGroup = exportDialog
        .locator('[data-testid="export-textlong-format-radio-group"]')
        .first();
      await expect(textLongGroup).not.toBeVisible();

      // Steps format radio group should not be visible in PDF mode
      const stepsGroup = exportDialog
        .locator('[data-testid="export-steps-format-radio-group"]')
        .first();
      await expect(stepsGroup).not.toBeVisible();
    });

    await test.step("Switch back to CSV and verify markdown options reappear", async () => {
      const csvFormat = exportDialog
        .locator('[data-testid="export-format-csv"]')
        .first();
      await csvFormat.click();

      await expect(textLongMarkdown!).toBeVisible({ timeout: 5000 });
      await expect(stepsMarkdown!).toBeVisible({ timeout: 5000 });

      await page.keyboard.press("Escape");
    });
  });

  test("CSV export - Text Long and Steps as Markdown content", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const caseName = `MD Export Case ${uniqueId}`;

    const exportDialog = page.locator('[role="dialog"]');
    let csvContent: string | undefined;

    await test.step("Create case with rich TipTap content and steps", async () => {
      const folderId = await api.createFolder(
        projectId,
        `MD Export Folder ${uniqueId}`
      );

      // Ensure the Description field is on the project's template
      const { descriptionFieldId } = await ensureDescriptionFieldOnTemplate(
        api,
        projectId
      );

      // Create test case with rich TipTap JSON content in the Description field
      const caseId = await api.createTestCaseWithFieldValues(
        projectId,
        folderId,
        caseName,
        { [descriptionFieldId]: JSON.stringify(RICH_TIPTAP_JSON) }
      );

      // Add steps with rich TipTap content
      await api.addStepsToTestCase(caseId, [
        {
          step: STEP_TIPTAP_JSON,
          expectedResult: EXPECTED_RESULT_TIPTAP_JSON,
          order: 0,
        },
      ]);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      // Wait for the case to be visible
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Open export modal", async () => {
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Select Markdown format and All filtered scope", async () => {
      // Select Markdown format for Text Long
      const textLongMarkdown = exportDialog
        .locator('[data-testid="export-textlong-markdown"]')
        .first();
      await textLongMarkdown.click();

      // Select Markdown format for Steps
      const stepsMarkdown = exportDialog
        .locator('[data-testid="export-steps-markdown"]')
        .first();
      await stepsMarkdown.click();

      // Select "All filtered" scope
      const allFiltered = exportDialog
        .locator('[data-testid="export-scope-allFiltered"]')
        .first();
      await allFiltered.click();
    });

    await test.step("Download the CSV export", async () => {
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      const exportSubmit = exportDialog
        .locator('[data-testid="export-modal-export-button"]')
        .first();
      await exportSubmit.click();

      const download = await downloadPromise;
      expect(download.suggestedFilename().toLowerCase()).toContain(".csv");

      const fs = await import("fs/promises");
      const filePath = await download.path();
      csvContent = await fs.readFile(filePath!, "utf-8");
    });

    await test.step("Verify CSV contains markdown content, not raw JSON", async () => {
      // CSV should NOT contain raw TipTap JSON (check both plain and CSV-escaped forms)
      expect(csvContent!).not.toContain('"type":"doc"');
      expect(csvContent!).not.toContain('""type"":""doc""');

      // CSV should contain markdown formatting indicators
      // The heading "Test Heading" should appear with ## prefix
      expect(csvContent!).toContain("Test Heading");
      // Bold text should appear with ** markers
      expect(csvContent!).toContain("**Bold text**");
      // List items should be present
      expect(csvContent!).toContain("Item 1");
      expect(csvContent!).toContain("Item 2");

      // Steps should contain markdown too - bold "Submit"
      expect(csvContent!).toContain("**Submit**");

      await page.keyboard.press("Escape");
    });
  });

  test("CSV export - Text Long as JSON regression", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const caseName = `JSON Export Case ${uniqueId}`;

    const exportDialog = page.locator('[role="dialog"]');
    let csvContent: string | undefined;

    await test.step("Create case with rich TipTap content", async () => {
      const folderId = await api.createFolder(
        projectId,
        `JSON Export Folder ${uniqueId}`
      );

      // Ensure the Description field is on the project's template
      const { descriptionFieldId } = await ensureDescriptionFieldOnTemplate(
        api,
        projectId
      );

      await api.createTestCaseWithFieldValues(projectId, folderId, caseName, {
        [descriptionFieldId]: JSON.stringify(RICH_TIPTAP_JSON),
      });

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");

      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Open export modal and export with default JSON format", async () => {
      // Open export modal - JSON is the default Text Long format
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Keep default JSON format - just select scope and export
      const allFiltered = exportDialog
        .locator('[data-testid="export-scope-allFiltered"]')
        .first();
      await allFiltered.click();

      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      const exportSubmit = exportDialog
        .locator('[data-testid="export-modal-export-button"]')
        .first();
      await exportSubmit.click();

      const download = await downloadPromise;
      const fs = await import("fs/promises");
      const filePath = await download.path();
      csvContent = await fs.readFile(filePath!, "utf-8");
    });

    await test.step("Verify CSV contains raw TipTap JSON and no markdown", async () => {
      // JSON format should contain raw TipTap JSON
      // CSV escapes double quotes by doubling them, so "type":"doc" becomes ""type"":""doc""
      expect(csvContent!).toContain('""type"":""doc""');
      // And should NOT have markdown indicators like ##
      expect(csvContent!).not.toMatch(/^## /m);

      await page.keyboard.press("Escape");
    });
  });

  // ---------------------------------------------------------------------------
  // Import Tests
  // ---------------------------------------------------------------------------

  test("CSV import - Markdown in Text Long field auto-detected", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const caseName = `MD Import Case ${uniqueId}`;

    const importDialog = page.locator('[role="dialog"]');
    let descValue: any;

    await test.step("Create project, ensure template field, and folder", async () => {
      // Ensure the template has a Description field for import mapping
      await ensureDescriptionFieldOnTemplate(api, projectId);
      const folderName = `MD Import Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open import wizard", async () => {
      const importButton = page
        .locator('button:has-text("Import Test Cases")')
        .first();
      await expect(importButton).toBeVisible({ timeout: 10000 });
      await importButton.click();

      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Upload CSV with markdown in Description column", async () => {
      // Create CSV with markdown in Description column
      const markdownContent = `# Test Heading\n\n**Bold text** and *italic*\n\n- Item 1\n- Item 2`;
      const csvContent = `name,description\n${caseName},"${markdownContent}"`;

      // Upload CSV
      const fileInput = page.locator('input[type="file"]').first();
      await expect(fileInput).toBeAttached({ timeout: 5000 });
      await fileInput.setInputFiles({
        name: "import-markdown.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvContent, "utf-8"),
      });
      await page.waitForLoadState("networkidle");

      // Verify file uploaded
      const fileInfo = importDialog.locator("text=import-markdown.csv");
      await expect(fileInfo.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Select template and folder", async () => {
      // Select template (required for page 1 validation)
      const templateSelect = importDialog
        .locator('[data-testid="template-select"]')
        .first();
      await expect(templateSelect).toBeVisible({ timeout: 5000 });
      await templateSelect.click();
      const templateOption = page.locator('[role="option"]').first();
      await expect(templateOption).toBeVisible({ timeout: 5000 });
      await templateOption.click();

      // Folder should already be selected since we navigated there
      // If folder selector appears, select it
      const folderSelect = importDialog
        .locator('button:has-text("Select a folder")')
        .first();
      if (await folderSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await folderSelect.click();
        const folderOption = page.locator('[role="option"]').first();
        await expect(folderOption).toBeVisible({ timeout: 5000 });
        await folderOption.click();
      }
    });

    await test.step("Advance through wizard and run import", async () => {
      // Page 1 → Page 2 (Field Mapping)
      const nextButton = importDialog
        .locator('[data-testid="next-button"]')
        .first();
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Page 2 → Page 3 (Folder split)
      // Wait for mapping page to load, then advance
      await page.waitForTimeout(1000);
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Page 3 → Page 4 (Preview)
      await page.waitForTimeout(1000);
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Page 4 - Click Import
      const importBtn = importDialog
        .locator('[data-testid="import-button"]')
        .first();
      await expect(importBtn).toBeVisible({ timeout: 5000 });
      await expect(importBtn).toBeEnabled({ timeout: 5000 });
      await importBtn.click();

      // Wait for import to complete - dialog should close or show success
      await expect(importDialog.first()).not.toBeVisible({ timeout: 30000 });

      // Wait for the page to refresh and show the imported case
      await page.waitForLoadState("networkidle");

      // Verify the case appears in the table
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Fetch the imported case Description field value via API", async () => {
      // Verify via API that the Description field is stored as TipTap JSON (not raw markdown)
      // First find the imported case
      const caseResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { name: caseName, projectId, isDeleted: false },
              select: { id: true },
            }),
          },
        }
      );
      expect(caseResponse.ok()).toBeTruthy();
      const importedCase = (await caseResponse.json()).data;
      expect(importedCase).toBeTruthy();

      // Get field values for the imported case
      const fieldValuesResponse = await request.get(
        `${baseURL}/api/model/caseFieldValues/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { testCaseId: importedCase.id },
              include: { field: true },
            }),
          },
        }
      );
      expect(fieldValuesResponse.ok()).toBeTruthy();
      const fieldValues = (await fieldValuesResponse.json()).data;

      // Find the Description field value
      descValue = fieldValues.find(
        (fv: any) => fv.field?.displayName === "Description"
      );
      expect(descValue).toBeTruthy();
    });

    await test.step("Verify Description stored as TipTap JSON with a heading", async () => {
      // The value should be TipTap JSON (auto-detected from markdown), not raw markdown string
      const parsedValue =
        typeof descValue.value === "string"
          ? JSON.parse(descValue.value)
          : descValue.value;
      expect(parsedValue.type).toBe("doc");
      expect(parsedValue.content).toBeDefined();
      expect(parsedValue.content.length).toBeGreaterThan(0);

      // Verify it contains a heading node (converted from # Test Heading)
      const hasHeading = parsedValue.content.some(
        (node: any) => node.type === "heading"
      );
      expect(hasHeading).toBe(true);
    });
  });

  test("CSV import - Plain text in Text Long field regression", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const caseName = `Plain Import Case ${uniqueId}`;

    const importDialog = page.locator('[role="dialog"]');
    let descValue: any;

    await test.step("Create project, ensure template field, and folder", async () => {
      // Ensure the template has a Description field for import mapping
      await ensureDescriptionFieldOnTemplate(api, projectId);
      const folderName = `Plain Import Folder ${uniqueId}`;
      const folderId = await api.createFolder(projectId, folderName);

      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open import wizard", async () => {
      const importButton = page
        .locator('button:has-text("Import Test Cases")')
        .first();
      await expect(importButton).toBeVisible({ timeout: 10000 });
      await importButton.click();

      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("Upload CSV with plain text Description", async () => {
      // Create CSV with plain text (no markdown patterns)
      const csvContent = `name,description\n${caseName},"Just a simple description with no formatting"`;

      // Upload CSV
      const fileInput = page.locator('input[type="file"]').first();
      await expect(fileInput).toBeAttached({ timeout: 5000 });
      await fileInput.setInputFiles({
        name: "import-plain.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvContent, "utf-8"),
      });
      await page.waitForLoadState("networkidle");
    });

    await test.step("Select template and folder", async () => {
      // Select template (required for page 1 validation)
      const templateSelect = importDialog
        .locator('[data-testid="template-select"]')
        .first();
      await expect(templateSelect).toBeVisible({ timeout: 5000 });
      await templateSelect.click();
      const templateOption = page.locator('[role="option"]').first();
      await expect(templateOption).toBeVisible({ timeout: 5000 });
      await templateOption.click();

      // Select folder if needed
      const folderSelect = importDialog
        .locator('button:has-text("Select a folder")')
        .first();
      if (await folderSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await folderSelect.click();
        const folderOption = page.locator('[role="option"]').first();
        await expect(folderOption).toBeVisible({ timeout: 5000 });
        await folderOption.click();
      }
    });

    await test.step("Advance through wizard and run import", async () => {
      // Navigate through wizard: Page 1 → 2 → 3 → 4
      const nextButton = importDialog
        .locator('[data-testid="next-button"]')
        .first();
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      await page.waitForTimeout(1000);
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      await page.waitForTimeout(1000);
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Import
      const importBtn = importDialog
        .locator('[data-testid="import-button"]')
        .first();
      await expect(importBtn).toBeVisible({ timeout: 5000 });
      await expect(importBtn).toBeEnabled({ timeout: 5000 });
      await importBtn.click();

      await expect(importDialog.first()).not.toBeVisible({ timeout: 30000 });
      await page.waitForLoadState("networkidle");

      // Verify case appears
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Fetch the imported case Description field value via API", async () => {
      // Verify via API that it's stored as TipTap JSON (plain text wrapped in paragraph)
      const caseResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { name: caseName, projectId, isDeleted: false },
              select: { id: true },
            }),
          },
        }
      );
      expect(caseResponse.ok()).toBeTruthy();
      const importedCase = (await caseResponse.json()).data;

      const fieldValuesResponse = await request.get(
        `${baseURL}/api/model/caseFieldValues/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { testCaseId: importedCase.id },
              include: { field: true },
            }),
          },
        }
      );
      expect(fieldValuesResponse.ok()).toBeTruthy();
      const fieldValues = (await fieldValuesResponse.json()).data;

      descValue = fieldValues.find(
        (fv: any) => fv.field?.displayName === "Description"
      );
      expect(descValue).toBeTruthy();
    });

    await test.step("Verify Description stored as TipTap paragraph, no heading", async () => {
      // Should still be valid TipTap JSON with a paragraph node
      const parsedValue =
        typeof descValue.value === "string"
          ? JSON.parse(descValue.value)
          : descValue.value;
      expect(parsedValue.type).toBe("doc");
      expect(parsedValue.content).toBeDefined();

      // Should NOT have a heading node (it's plain text, not markdown)
      const hasHeading = parsedValue.content.some(
        (node: any) => node.type === "heading"
      );
      expect(hasHeading).toBe(false);

      // Should have a paragraph containing our text
      const hasParagraph = parsedValue.content.some(
        (node: any) => node.type === "paragraph"
      );
      expect(hasParagraph).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Round-trip Test
  // ---------------------------------------------------------------------------

  test("Round-trip - Export markdown then re-import", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const originalCaseName = `RT Original Case ${uniqueId}`;
    const targetFolderName = `RT Target Folder ${uniqueId}`;

    const exportDialog = page.locator('[role="dialog"]');
    const importDialog = page.locator('[role="dialog"]');
    let targetFolderId: number | undefined;
    let exportedCsv: string | undefined;
    let descValue: any;

    await test.step("Create source case with rich content and target folder", async () => {
      // Create source folder with rich content case
      const sourceFolderName = `RT Source Folder ${uniqueId}`;
      const sourceFolderId = await api.createFolder(
        projectId,
        sourceFolderName
      );

      // Ensure the Description field is on the project's template
      const { descriptionFieldId } = await ensureDescriptionFieldOnTemplate(
        api,
        projectId
      );

      await api.createTestCaseWithFieldValues(
        projectId,
        sourceFolderId,
        originalCaseName,
        { [descriptionFieldId]: JSON.stringify(RICH_TIPTAP_JSON) }
      );

      // Create target folder for re-import
      targetFolderId = await api.createFolder(projectId, targetFolderName);

      // Step 1: Export the source folder as Markdown
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(sourceFolderId);
      await page.waitForLoadState("networkidle");

      await expect(
        page.locator(`text="${originalCaseName}"`).first()
      ).toBeVisible({ timeout: 10000 });
    });

    await test.step("Export source folder as Markdown CSV", async () => {
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );

      await expect(exportDialog.first()).toBeVisible({ timeout: 5000 });

      // Select Markdown format for Text Long
      const textLongMarkdown = exportDialog
        .locator('[data-testid="export-textlong-markdown"]')
        .first();
      await textLongMarkdown.click();

      const allFiltered = exportDialog
        .locator('[data-testid="export-scope-allFiltered"]')
        .first();
      await allFiltered.click();

      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      const exportSubmit = exportDialog
        .locator('[data-testid="export-modal-export-button"]')
        .first();
      await exportSubmit.click();

      const download = await downloadPromise;
      const fs = await import("fs/promises");
      const filePath = await download.path();
      exportedCsv = await fs.readFile(filePath!, "utf-8");

      await page.keyboard.press("Escape");
      await expect(exportDialog.first()).not.toBeVisible({ timeout: 5000 });

      // Verify the exported CSV has markdown content
      expect(exportedCsv).toContain("Test Heading");
      expect(exportedCsv).toContain("**Bold text**");
    });

    await test.step("Open import wizard and upload exported CSV into target folder", async () => {
      // Step 2: Re-import the exported CSV into the target folder
      await repositoryPage.selectFolder(targetFolderId!);
      await page.waitForLoadState("networkidle");

      const importButton = page
        .locator('button:has-text("Import Test Cases")')
        .first();
      await expect(importButton).toBeVisible({ timeout: 10000 });
      await importButton.click();

      await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

      // Remove the BOM if present and upload the exported CSV
      const cleanCsv = exportedCsv!.replace(/^\uFEFF/, "");
      const fileInput = page.locator('input[type="file"]').first();
      await expect(fileInput).toBeAttached({ timeout: 5000 });
      await fileInput.setInputFiles({
        name: "roundtrip-import.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(cleanCsv, "utf-8"),
      });
      await page.waitForLoadState("networkidle");
    });

    await test.step("Select template and target folder", async () => {
      // Select template (required for page 1 validation)
      const templateSelect = importDialog
        .locator('[data-testid="template-select"]')
        .first();
      await expect(templateSelect).toBeVisible({ timeout: 5000 });
      await templateSelect.click();
      const templateOption = page.locator('[role="option"]').first();
      await expect(templateOption).toBeVisible({ timeout: 5000 });
      await templateOption.click();

      // Select folder if needed
      const folderSelect = importDialog
        .locator('button:has-text("Select a folder")')
        .first();
      if (await folderSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await folderSelect.click();
        // Select the target folder
        const folderOptions = page.locator('[role="option"]');
        const targetOption = folderOptions.filter({
          hasText: targetFolderName,
        });
        if (
          await targetOption.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await targetOption.click();
        } else {
          // Fall back to first option
          await folderOptions.first().click();
        }
      }
    });

    await test.step("Advance through wizard and run import", async () => {
      // Navigate through wizard pages
      const nextButton = importDialog
        .locator('[data-testid="next-button"]')
        .first();
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      await page.waitForTimeout(1000);
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      await page.waitForTimeout(1000);
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Import
      const importBtn = importDialog
        .locator('[data-testid="import-button"]')
        .first();
      await expect(importBtn).toBeVisible({ timeout: 5000 });
      await expect(importBtn).toBeEnabled({ timeout: 5000 });
      await importBtn.click();

      await expect(importDialog.first()).not.toBeVisible({ timeout: 30000 });
      await page.waitForLoadState("networkidle");

      // Verify case appears in target folder
      await expect(
        page.locator(`text="${originalCaseName}"`).first()
      ).toBeVisible({ timeout: 15000 });
    });

    await test.step("Fetch the re-imported case Description field value via API", async () => {
      // Verify via API that re-imported Description is TipTap JSON with heading + bold
      const caseResponse = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {
                name: originalCaseName,
                folderId: targetFolderId,
                isDeleted: false,
              },
              select: { id: true },
            }),
          },
        }
      );
      expect(caseResponse.ok()).toBeTruthy();
      const reimportedCase = (await caseResponse.json()).data;
      expect(reimportedCase).toBeTruthy();

      const fieldValuesResponse = await request.get(
        `${baseURL}/api/model/caseFieldValues/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { testCaseId: reimportedCase.id },
              include: { field: true },
            }),
          },
        }
      );
      expect(fieldValuesResponse.ok()).toBeTruthy();
      const fieldValues = (await fieldValuesResponse.json()).data;

      descValue = fieldValues.find(
        (fv: any) => fv.field?.displayName === "Description"
      );
      expect(descValue).toBeTruthy();
    });

    await test.step("Verify round-trip preserved heading and bold formatting", async () => {
      const parsedValue =
        typeof descValue.value === "string"
          ? JSON.parse(descValue.value)
          : descValue.value;
      expect(parsedValue.type).toBe("doc");

      // Should have a heading (round-trip preserved the markdown → TipTap conversion)
      const hasHeading = parsedValue.content.some(
        (node: any) => node.type === "heading"
      );
      expect(hasHeading).toBe(true);

      // Should have bold text somewhere in the content
      const hasBold = JSON.stringify(parsedValue).includes('"type":"bold"');
      expect(hasBold).toBe(true);
    });
  });
});
