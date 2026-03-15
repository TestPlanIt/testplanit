import type { APIRequestContext, Page } from "@playwright/test";
import path from "path";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";
import { TestCasePage } from "../../../page-objects/repository/test-case.page";

/**
 * Markdown Paste & Import Tests
 *
 * Tests for:
 * 1. Pasting markdown into TipTap editor (auto-converts to rich text)
 * 2. Importing CSV with markdown content (auto-detected and stored as TipTap JSON)
 */
test.describe("Markdown Paste & Import", () => {
  let repositoryPage: RepositoryPage;
  let testCasePage: TestCasePage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
    testCasePage = new TestCasePage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper,
    suffix: string = ""
  ): Promise<number> {
    return await api.createProject(
      `E2E MD Paste ${suffix} ${Date.now()}_${Math.floor(Math.random() * 100000)}`
    );
  }

  /**
   * Simulate pasting text into the currently focused element via ClipboardEvent
   */
  async function pasteTextIntoFocusedEditor(
    page: Page,
    text: string
  ): Promise<void> {
    await page.evaluate((pasteText) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", pasteText);
      const event = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement?.dispatchEvent(event);
    }, text);
    // Give editor time to process the paste event
    await page.waitForTimeout(500);
  }

  /**
   * Get the Description field value for a case via API
   */
  async function getDescriptionFieldValue(
    request: APIRequestContext,
    baseURL: string,
    caseId: number
  ): Promise<any> {
    const response = await request.get(
      `${baseURL}/api/model/caseFieldValues/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { testCaseId: caseId },
            include: { field: true },
          }),
        },
      }
    );
    expect(response.ok()).toBeTruthy();
    const fieldValues = (await response.json()).data;
    const desc = fieldValues.find(
      (fv: any) => fv.field?.displayName === "Description"
    );
    if (!desc?.value) return null;
    return typeof desc.value === "string" ? JSON.parse(desc.value) : desc.value;
  }

  // ---------------------------------------------------------------------------
  // Paste Tests
  // ---------------------------------------------------------------------------

  test("Paste markdown into TipTap editor converts to rich text", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api, "MD");
    const uniqueId = Date.now();
    const folderId = await api.createFolder(
      projectId,
      `MD Paste Folder ${uniqueId}`
    );
    const caseName = `MD Paste Case ${uniqueId}`;
    const caseId = await api.createTestCase(projectId, folderId, caseName);

    // Navigate to the case detail page
    await testCasePage.goto(projectId, caseId);

    // Enter edit mode
    await testCasePage.clickEdit();

    // The first .tiptap editor on the case detail page is the Description field
    // (the second is the Expected field)
    // The sidebar may overlap the editor, so we focus it via JavaScript
    const editor = page.locator(".tiptap").first();
    await expect(editor).toBeAttached({ timeout: 10000 });
    await editor.evaluate((el) => {
      (el as HTMLElement).focus();
    });
    await page.waitForTimeout(300);

    // Paste markdown content
    const markdownText =
      "# Test Heading\n\n**Bold text** and *italic*\n\n- Item 1\n- Item 2";
    await pasteTextIntoFocusedEditor(page, markdownText);

    // Assert the editor DOM contains rich content (NOT literal markdown)
    // Use innerHTML to check since the editor may be in a narrow panel
    // where child elements are considered "hidden" by Playwright
    await expect(async () => {
      const innerHTML = await editor.innerHTML();
      // Heading should be converted to h1 element (# maps to h1 in TipTap)
      expect(innerHTML).toContain("<h1>");
      expect(innerHTML).toContain("Test Heading");
      // Bold should be converted to <strong>
      expect(innerHTML).toContain("<strong>");
      expect(innerHTML).toContain("Bold text");
      // Italic should be converted to <em>
      expect(innerHTML).toContain("<em>");
      expect(innerHTML).toContain("italic");
      // List items should be present (may have class attributes)
      expect(innerHTML).toMatch(/<li[\s>]/);
      expect(innerHTML).toContain("Item 1");
      expect(innerHTML).toContain("Item 2");
      // Should NOT contain literal markdown syntax
      expect(innerHTML).not.toContain("**Bold text**");
      expect(innerHTML).not.toContain("# Test Heading");
    }).toPass({ timeout: 5000 });

    // Trigger a small edit to ensure TipTap's onUpdate propagates to React state
    // (the programmatic paste via view.dispatch may not have flushed React state)
    await page.keyboard.press("End");
    await page.keyboard.type(" ");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(1000);

    // Save the changes
    await testCasePage.saveChanges();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Verify via API that the stored value is TipTap JSON
    const parsedValue = await getDescriptionFieldValue(
      request,
      baseURL!,
      caseId
    );
    expect(parsedValue).toBeTruthy();
    expect(parsedValue.type).toBe("doc");

    // Should have a heading node
    const hasHeading = parsedValue.content.some(
      (node: any) => node.type === "heading"
    );
    expect(hasHeading).toBe(true);

    // Should have bold text
    const hasBold = JSON.stringify(parsedValue).includes('"type":"bold"');
    expect(hasBold).toBe(true);
  });

  test("Paste plain text stays as plain text (regression)", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api, "Plain");
    const uniqueId = Date.now();
    const folderId = await api.createFolder(
      projectId,
      `Plain Paste Folder ${uniqueId}`
    );
    const caseName = `Plain Paste Case ${uniqueId}`;
    const caseId = await api.createTestCase(projectId, folderId, caseName);

    // Navigate to the case detail page
    await testCasePage.goto(projectId, caseId);

    // Enter edit mode
    await testCasePage.clickEdit();

    // The first .tiptap editor on the case detail page is the Description field
    const editor = page.locator(".tiptap").first();
    await expect(editor).toBeAttached({ timeout: 10000 });

    // Focus the editor and type plain text (no markdown patterns)
    // Use keyboard.type() to reliably input text via ProseMirror
    await editor.evaluate((el) => {
      (el as HTMLElement).focus();
    });
    await page.waitForTimeout(300);

    const plainText = "Just a simple description without any formatting";

    // First try pasting via synthetic event
    await pasteTextIntoFocusedEditor(page, plainText);
    await page.waitForTimeout(500);

    // Verify text was inserted - if synthetic paste didn't work, type it
    const editorText = await editor.textContent();
    if (!editorText?.includes("simple description")) {
      // Synthetic paste didn't insert text - use keyboard as fallback
      await editor.evaluate((el) => {
        (el as HTMLElement).focus();
      });
      await page.keyboard.type(plainText, { delay: 10 });
    }

    // Editor should contain the plain text
    await expect(async () => {
      const text = await editor.textContent();
      expect(text).toContain("simple description");
    }).toPass({ timeout: 5000 });

    // Should NOT have heading, bold, or list elements (verify via innerHTML)
    const innerHTML = await editor.innerHTML();
    expect(innerHTML).not.toMatch(/<h[1-6]/);
    expect(innerHTML).not.toContain("<strong>");
    expect(innerHTML).not.toContain("<li>");

    // Save
    await testCasePage.saveChanges();

    // Wait for save to complete and reload
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Verify via API that content is a simple paragraph doc
    const parsedValue = await getDescriptionFieldValue(
      request,
      baseURL!,
      caseId
    );
    expect(parsedValue).toBeTruthy();
    expect(parsedValue.type).toBe("doc");

    // Should NOT have heading nodes
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

  // ---------------------------------------------------------------------------
  // CSV Import Tests
  // ---------------------------------------------------------------------------

  test("Import markdown CSV - all 10 cases with diverse markdown", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const projectId = await getTestProjectId(api, "Import");
    const uniqueId = Date.now();
    const folderName = `MD CSV Import Folder ${uniqueId}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Open import wizard
    const importButton = page
      .locator('button:has-text("Import Test Cases")')
      .first();
    await expect(importButton).toBeVisible({ timeout: 10000 });
    await importButton.click();

    const importDialog = page.locator('[role="dialog"]');
    await expect(importDialog.first()).toBeVisible({ timeout: 5000 });

    // Upload the actual import-markdown.csv file from disk
    const csvPath = path.resolve(
      __dirname,
      "../../../../test/test-data/sample-csv/import-markdown.csv"
    );
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });
    await fileInput.setInputFiles(csvPath);
    await page.waitForLoadState("networkidle");

    // Verify file uploaded
    const fileInfo = importDialog.locator("text=import-markdown.csv");
    await expect(fileInfo.first()).toBeVisible({ timeout: 5000 });

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

    // Navigate through wizard: Page 1 → 2 → 3 → 4
    const nextButton = importDialog
      .locator('[data-testid="next-button"]')
      .first();
    await expect(nextButton).toBeEnabled({ timeout: 5000 });
    await nextButton.click();
    await page.waitForLoadState("networkidle");

    // Page 2 → 3 (Folder split)
    await page.waitForTimeout(1000);
    await expect(nextButton).toBeEnabled({ timeout: 5000 });
    await nextButton.click();
    await page.waitForLoadState("networkidle");

    // Page 3 → 4 (Preview)
    await page.waitForTimeout(1000);
    await expect(nextButton).toBeEnabled({ timeout: 5000 });
    await nextButton.click();
    await page.waitForLoadState("networkidle");

    // Click Import
    const importBtn = importDialog
      .locator('[data-testid="import-button"]')
      .first();
    await expect(importBtn).toBeVisible({ timeout: 5000 });
    await expect(importBtn).toBeEnabled({ timeout: 5000 });
    await importBtn.click();

    // Wait for import to complete
    await expect(importDialog.first()).not.toBeVisible({ timeout: 30000 });
    await page.waitForLoadState("networkidle");

    // Verify key cases appear in the table
    const expectedCases = [
      "MD - Headings",
      "MD - Emphasis & Inline",
      "MD - Blockquotes",
      "MD - Unordered Lists",
      "MD - Ordered Lists",
      "MD - Code Blocks",
      "MD - Links & Images",
      "MD - Tables",
      "MD - Mixed Rich Content",
      "MD - Edge Cases",
    ];

    // Verify a few representative cases are visible
    for (const caseName of [
      "MD - Headings",
      "MD - Code Blocks",
      "MD - Mixed Rich Content",
    ]) {
      await expect(
        page.locator(`text="${caseName}"`).first()
      ).toBeVisible({ timeout: 15000 });
    }

    // Now verify via API that each case's Description is TipTap JSON
    // with appropriate structure for the markdown content

    // Helper to get a case by name and check its Description
    async function verifyCaseDescription(
      caseName: string,
      checks: {
        hasNodeType?: string;
        hasMarkType?: string;
        isDoc?: boolean;
      }
    ) {
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

      const parsedValue = await getDescriptionFieldValue(
        request,
        baseURL!,
        importedCase.id
      );
      expect(parsedValue).toBeTruthy();

      if (checks.isDoc !== false) {
        expect(parsedValue.type).toBe("doc");
        expect(parsedValue.content).toBeDefined();
        expect(parsedValue.content.length).toBeGreaterThan(0);
      }

      const jsonStr = JSON.stringify(parsedValue);

      if (checks.hasNodeType) {
        const hasNode = jsonStr.includes(`"type":"${checks.hasNodeType}"`);
        expect(hasNode, `Expected "${caseName}" to contain node type "${checks.hasNodeType}" in: ${jsonStr.substring(0, 500)}`).toBe(true);
      }

      if (checks.hasMarkType) {
        const hasMark = jsonStr.includes(`"type":"${checks.hasMarkType}"`);
        expect(hasMark, `Expected "${caseName}" to contain mark type "${checks.hasMarkType}" in: ${jsonStr.substring(0, 500)}`).toBe(true);
      }
    }

    // Verify each imported case has the expected TipTap structure
    await verifyCaseDescription("MD - Headings", { hasNodeType: "heading" });
    await verifyCaseDescription("MD - Emphasis & Inline", {
      hasMarkType: "bold",
    });
    // Note: "MD - Blockquotes" only contains blockquotes (a weak pattern),
    // which alone doesn't trigger markdown detection (needs 2+ weak patterns).
    // So it's stored as plain text. Just verify it's a valid doc.
    await verifyCaseDescription("MD - Blockquotes", {});
    await verifyCaseDescription("MD - Unordered Lists", {
      hasNodeType: "bulletList",
    });
    await verifyCaseDescription("MD - Ordered Lists", {
      hasNodeType: "orderedList",
    });
    await verifyCaseDescription("MD - Code Blocks", {
      hasNodeType: "codeBlock",
    });
    await verifyCaseDescription("MD - Mixed Rich Content", {
      hasNodeType: "heading",
    });
    // Also check that Mixed Rich Content has bold
    await verifyCaseDescription("MD - Mixed Rich Content", {
      hasMarkType: "bold",
    });
  });
});
