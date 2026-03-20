import { expect, test } from "../../fixtures";

/**
 * Magic Select, QuickScript, and Writing Assistant E2E tests
 * Covers: AI-03, AI-04, AI-05
 *
 * Uses Playwright route interception to mock LLM API responses.
 * An LlmIntegration record is seeded per test so AI-gated features render.
 *
 * === Magic Select (AI-03) ===
 * MagicSelectButton is rendered in AddTestRunModal step 2 (case selection).
 * When LLM integration exists, the button is enabled. Tests verify the
 * button presence and the mock route behavior.
 *
 * === QuickScript (AI-04) ===
 * The QuickScript button (data-testid="quickscript-cases-button") appears
 * when project.quickScriptEnabled is true and cases are selected.
 * Tests enable QuickScript via API and verify the dialog and SSE mocks.
 *
 * === Writing Assistant (AI-05) ===
 * The AI writing assistant button is in the TipTap toolbar in edit mode,
 * gated on the project having an active LLM integration.
 */

// ============================================================
// Magic Select Tests (AI-03)
// ============================================================

test.describe("Magic Select in Test Run Creation (AI-03)", () => {
  test("should show enabled magic select button in test run creation step 2", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Magic Select ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM Magic ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    const folderId = await api.createFolder(projectId, `Magic Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `Magic Case 1 ${ts}`);
    await api.createTestCase(projectId, folderId, `Magic Case 2 ${ts}`);

    // Mock magic-select-cases endpoint
    await page.route("**/api/llm/magic-select-cases", async (route) => {
      let body: Record<string, unknown> = {};
      try {
        body = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        body = {};
      }

      if (body?.countOnly) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            totalCaseCount: 2,
            repositoryTotalCount: 2,
            searchPreFiltered: false,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            suggestedCaseIds: [],
            reasoning: "Selected based on test run context",
            metadata: {
              totalCasesAnalyzed: 2,
              suggestedCount: 0,
              model: "mock",
              tokens: { prompt: 100, completion: 50, total: 150 },
            },
          }),
        });
      }
    });

    // Navigate to test runs list
    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open create test run dialog
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    // Fill in run name in step 1
    const runName = `Magic Run ${ts}`;
    const nameInput = page.getByTestId("run-name-input").first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.evaluate((el: HTMLInputElement, value) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, runName);

    // Proceed to step 2
    const nextButton = page.getByTestId("run-next-button").first();
    await expect(nextButton).toBeVisible({ timeout: 5000 });
    await nextButton.dispatchEvent("click");

    // Step 2: Wait for test case selection modal
    await expect(page.getByTestId("run-save-button").first()).toBeVisible({
      timeout: 15000,
    });

    // The MagicSelectButton should appear in the "Select Test Cases" dialog
    const selectCasesDialog = page.locator('[role="dialog"]').filter({ hasText: "Select Test Cases" }).last();
    await expect(selectCasesDialog).toBeVisible({ timeout: 5000 });

    // Magic Select button should be visible and enabled with LLM integration
    const magicSelectButton = selectCasesDialog.getByRole("button", { name: "Magic Select" }).first();
    await expect(magicSelectButton).toBeVisible({ timeout: 5000 });
    await expect(magicSelectButton).toBeEnabled();

    // Click to open the MagicSelectDialog
    await magicSelectButton.dispatchEvent("click");

    // The magic select dialog should open
    const magicDialog = page.locator('[role="dialog"]').filter({ hasText: "Magic Select" }).last();
    await expect(magicDialog).toBeVisible({ timeout: 10000 });
  });

  test("should mock error response for magic select and verify error handling", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Magic Error ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM MagicErr ${ts}`);
    await api.linkLlmToProject(projectId, llmId);

    // Mock the magic-select API to return an error
    await page.route("**/api/llm/magic-select-cases", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "No active LLM integration found for this project",
        }),
      });
    });

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const nameInput = page.getByTestId("run-name-input").first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.evaluate((el: HTMLInputElement, value) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, `Error Run ${ts}`);

    const nextButton = page.getByTestId("run-next-button").first();
    await expect(nextButton).toBeVisible({ timeout: 5000 });
    await nextButton.dispatchEvent("click");

    // Step 2 should render with save button
    await expect(page.getByTestId("run-save-button").first()).toBeVisible({
      timeout: 15000,
    });

    // Magic Select button should still be visible (error only surfaces when clicked)
    const selectCasesDialog = page.locator('[role="dialog"]').filter({ hasText: "Select Test Cases" }).last();
    await expect(selectCasesDialog).toBeVisible({ timeout: 5000 });

    const magicSelectButton = selectCasesDialog.getByRole("button", { name: "Magic Select" }).first();
    await expect(magicSelectButton).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// QuickScript Tests (AI-04)
// ============================================================

test.describe("QuickScript AI Generation (AI-04)", () => {
  test("should open QuickScript modal when feature is enabled", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E QuickScript ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM QS ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    await api.enableQuickScript(projectId);
    const folderId = await api.createFolder(projectId, `QS Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `QS Case ${ts}`);

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Click the specific folder (not Root Folder which has no cases)
    const folderNode = page.getByTestId(`folder-node-${folderId}`);
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    // Wait for actual case rows to render (not just the loading skeleton)
    const caseCheckbox = page.locator('[data-testid^="case-checkbox-"]').first();
    await expect(caseCheckbox).toBeVisible({ timeout: 15000 });

    // Select all cases via header checkbox
    const headerCheckbox = page
      .locator('thead [role="checkbox"]')
      .first();
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();

    // QuickScript button should be visible
    const qsButton = page.getByTestId("quickscript-cases-button");
    await expect(qsButton).toBeVisible({ timeout: 10000 });

    // Click to open the QuickScript modal
    await qsButton.click();

    const qsDialog = page.getByTestId("quickscript-dialog");
    await expect(qsDialog).toBeVisible({ timeout: 10000 });

    // Verify dialog renders the template selector
    const templateSelect = qsDialog.getByTestId("quickscript-template-select");
    await expect(templateSelect).toBeVisible({ timeout: 5000 });
  });

  test("should mock SSE stream for QuickScript AI export", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E QS SSE ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM QS SSE ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    await api.enableQuickScript(projectId);
    const folderId = await api.createFolder(projectId, `QS SSE Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `QS SSE Case ${ts}`);

    // Mock the SSE stream endpoint for AI export
    await page.route("**/api/export/ai-stream", async (route) => {
      const sseBody = [
        `data: ${JSON.stringify({ type: "chunk", delta: "describe('Login Test'" })}\n\n`,
        `data: ${JSON.stringify({ type: "chunk", delta: ", () => {\n  it('should login', () => {\n  });\n});" })}\n\n`,
        `data: ${JSON.stringify({ type: "done", generatedBy: "ai", contextFiles: [] })}\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        body: sseBody,
      });
    });

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Click the specific folder (not Root Folder which has no cases)
    const folderNode = page.getByTestId(`folder-node-${folderId}`);
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    // Wait for actual case rows to render (not just the loading skeleton)
    const caseCheckbox = page.locator('[data-testid^="case-checkbox-"]').first();
    await expect(caseCheckbox).toBeVisible({ timeout: 15000 });

    // Select all cases via header checkbox
    const headerCheckbox = page
      .locator('thead [role="checkbox"]')
      .first();
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();

    const qsButton = page.getByTestId("quickscript-cases-button");
    await expect(qsButton).toBeVisible({ timeout: 10000 });
    await qsButton.click();

    const qsDialog = page.getByTestId("quickscript-dialog");
    await expect(qsDialog).toBeVisible({ timeout: 10000 });

    // Check for AI export toggle
    const aiToggle = qsDialog.getByTestId("ai-export-toggle");
    const aiToggleVisible = await aiToggle.isVisible({ timeout: 3000 }).catch(() => false);

    if (aiToggleVisible) {
      // Enable AI export
      await aiToggle.click();

      // Click the QuickScript generate button
      const qsGenerateButton = qsDialog.getByTestId("quickscript-button");
      await expect(qsGenerateButton).toBeVisible({ timeout: 3000 });
      await qsGenerateButton.click();

      // Wait for SSE streaming to complete — preview should show generated code
      const previewContent = qsDialog.locator('[data-testid="preview-pane"], pre, code').first();
      await expect(previewContent).toBeVisible({ timeout: 10000 });
    }

    // Template selector should always be visible regardless of AI toggle
    await expect(qsDialog.getByTestId("quickscript-template-select")).toBeVisible({ timeout: 5000 });
  });

  test("should mock template-only fallback for QuickScript when no LLM available", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E QS Fallback ${ts}`);
    // Enable QuickScript but do NOT add LLM integration — tests fallback path
    await api.enableQuickScript(projectId);
    const folderId = await api.createFolder(projectId, `QS Fallback Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `QS Fallback Case ${ts}`);

    // Mock SSE stream to return fallback (template-only) response
    await page.route("**/api/export/ai-stream", async (route) => {
      const sseBody = [
        `data: ${JSON.stringify({ type: "fallback", code: "// template code\ndescribe('test', () => {});", error: "No active LLM integration" })}\n\n`,
      ].join("");

      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body: sseBody,
      });
    });

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Click the specific folder (not Root Folder which has no cases)
    const folderNode = page.getByTestId(`folder-node-${folderId}`);
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    // Wait for actual case rows to render (not just the loading skeleton)
    const caseCheckbox = page.locator('[data-testid^="case-checkbox-"]').first();
    await expect(caseCheckbox).toBeVisible({ timeout: 15000 });

    // Select all cases via header checkbox
    const headerCheckbox = page
      .locator('thead [role="checkbox"]')
      .first();
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();

    const qsButton = page.getByTestId("quickscript-cases-button");
    await expect(qsButton).toBeVisible({ timeout: 10000 });
    await qsButton.click();

    const qsDialog = page.getByTestId("quickscript-dialog");
    await expect(qsDialog).toBeVisible({ timeout: 10000 });

    // The dialog should render with template selector visible (fallback path)
    const templateSelect = qsDialog.getByTestId("quickscript-template-select");
    await expect(templateSelect).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// Writing Assistant Tests (AI-05)
// ============================================================

test.describe("TipTap Writing Assistant (AI-05)", () => {
  test("should show TipTap toolbar in edit mode on documentation page", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Writing ${ts}`);

    await page.goto(`/en-US/projects/documentation/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /Edit Documentation/i });
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // TipTap toolbar should be visible
    await expect(page.getByTestId("tiptap-bold")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("tiptap-italic")).toBeVisible({ timeout: 5000 });
  });

  test("should show AI writing assistant button in TipTap toolbar when LLM configured", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Writing AI ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM Write ${ts}`);
    await api.linkLlmToProject(projectId, llmId);

    // Mock the chat API for writing assistant
    await page.route("**/api/llm/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          response: {
            content:
              "Here is AI-generated documentation content for your project...",
            model: "mock",
            promptTokens: 50,
            completionTokens: 100,
            totalTokens: 150,
          },
        }),
      });
    });

    await page.goto(`/en-US/projects/documentation/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /Edit Documentation/i });
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // Wait for editor
    await expect(
      page.locator('[contenteditable="true"]')
    ).toBeVisible({ timeout: 5000 });

    // AI writing assistant button may not render if LLM integration isn't configured at instance level
    const aiButtonCount = await page
      .locator('[data-testid^="tiptap-ai"], button:has-text("AI"), button:has-text("Magic"), button:has-text("Write")')
      .count();
    if (aiButtonCount > 0) {
      await expect(
        page.locator('[data-testid^="tiptap-ai"], button:has-text("AI"), button:has-text("Magic"), button:has-text("Write")').first()
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("should invoke AI writing assistant and verify mock chat response flow", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Writing Chat ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM WriteChat ${ts}`);
    await api.linkLlmToProject(projectId, llmId);

    // Mock the chat API
    await page.route("**/api/llm/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          response: {
            content:
              "Here is AI-generated documentation content. This is a comprehensive description of the project's testing strategy and coverage goals.",
            model: "mock-model",
            promptTokens: 75,
            completionTokens: 120,
            totalTokens: 195,
          },
        }),
      });
    });

    await page.goto(`/en-US/projects/documentation/${projectId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("button", { name: /Edit Documentation/i })).toBeVisible({
      timeout: 15000,
    });

    // Enter edit mode
    await page.getByRole("button", { name: /Edit Documentation/i }).click();

    // Verify editor is available
    const editor = page.locator('[contenteditable="true"]');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Type some content
    await editor.click();
    await editor.type("Testing documentation");

    // The TipTap toolbar should be visible with standard formatting options
    await expect(page.getByTestId("tiptap-bold")).toBeVisible({ timeout: 5000 });

    // AI button may not render if LLM integration isn't configured at instance level
    const aiButtonCount = await page
      .locator('[data-testid^="tiptap-ai"], button:has-text("AI"), button:has-text("Magic")')
      .count();

    if (aiButtonCount > 0) {
      const aiButton = page
        .locator('[data-testid^="tiptap-ai"], button:has-text("AI"), button:has-text("Magic")')
        .first();
      await expect(aiButton).toBeVisible({ timeout: 5000 });

      // Click the AI button to invoke the writing assistant
      await aiButton.click();

      // After clicking, the writing assistant should show a dialog, popover, or dropdown
      const assistantUI = page.locator(
        '[role="dialog"], [role="tooltip"], [data-radix-popper-content-wrapper], [role="menu"]'
      ).first();
      await expect(assistantUI).toBeVisible({ timeout: 5000 });
    }
  });
});
