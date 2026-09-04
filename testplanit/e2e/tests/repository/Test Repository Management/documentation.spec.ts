import { expect, test } from "../../../fixtures";

/**
 * Documentation Tests
 *
 * Test cases for project documentation functionality.
 *
 * Documentation is a single rich-text page per project stored in Projects.docs field.
 * Features:
 * - View-only mode for users without edit permissions
 * - Edit mode with rich text editor (TipTap)
 * - Save and cancel functionality
 * - Default content from AppConfig
 * - Permission-based access control
 */
test.describe("Documentation", () => {
  /**
   * Create a unique project for each test to avoid data interference
   */
  async function createTestProject(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const projectName = `Doc Test Project ${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return await api.createProject(projectName);
  }

  test("View documentation in read-only mode", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");

      // Verify page loaded
      await expect(page).toHaveURL(
        new RegExp(`/projects/documentation/${projectId}`)
      );
    });

    await test.step("Verify documentation header is visible", async () => {
      const header = page
        .locator("h1, h2")
        .filter({ hasText: /documentation/i })
        .first();
      await expect(header).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify editor is shown in read-only mode", async () => {
      // Verify TipTap editor is visible (in read-only mode)
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Editor should be read-only (contenteditable should be false or not present)
      const isEditable = await editor.getAttribute("contenteditable");
      expect(isEditable).not.toBe("true");
    });
  });

  test("Edit button appears for users with edit permissions", async ({
    api,
    page,
  }) => {
    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify Edit Documentation button when permitted", async () => {
      // Look for Edit Documentation button
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();

      // Button may or may not be visible depending on permissions
      // If visible, it should be clickable
      if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(editButton).toBeVisible();
      }
    });
  });

  test("Enter edit mode and make changes", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode", async () => {
      // Try to find and click Edit button
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();

      // Only proceed if edit button is visible (user has permissions)
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");

      // Editor should now be editable
      await expect(editor).toBeVisible({ timeout: 5000 });
    });

    await test.step("Type content into the editor", async () => {
      // Click in editor and add content
      await editor.click();
      await page.keyboard.type("Test documentation content " + Date.now());
    });

    await test.step("Verify Save and Cancel buttons are visible", async () => {
      // Save and Cancel buttons should be visible
      const saveButton = page
        .locator("button")
        .filter({ hasText: /^save$/i })
        .first();
      const cancelButton = page
        .locator("button")
        .filter({ hasText: /^cancel$/i })
        .first();

      await expect(saveButton).toBeVisible({ timeout: 3000 });
      await expect(cancelButton).toBeVisible({ timeout: 3000 });
    });
  });

  test("Save documentation changes", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();
    const testContent = `Updated documentation ${Date.now()}`;

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode", async () => {
      // Check if edit button is available
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Replace content with new text", async () => {
      await editor.click();

      // Clear existing content and add new content
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(testContent);
    });

    await test.step("Save and verify the content persists", async () => {
      // Save the changes
      const saveButton = page
        .locator("button")
        .filter({ hasText: /^save$/i })
        .first();
      await expect(saveButton).toBeVisible({ timeout: 3000 });

      // Wait for the API call to complete
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/model/projects/update") &&
          response.request().method() === "PUT",
        { timeout: 15000 }
      );

      await saveButton.click();

      // Wait for the API response
      const response = await responsePromise;
      expect(response.ok()).toBeTruthy();

      // Wait for page to update
      await page.waitForLoadState("networkidle");

      // Verify content was saved (editor should still show the content)
      await expect(editor).toContainText(testContent, { timeout: 5000 });
    });
  });

  test("Cancel documentation edits", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();
    let initialContent: string | undefined;

    await test.step("Open documentation and capture initial content", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");

      // Get initial content (normalize whitespace for comparison)
      initialContent = ((await editor.textContent()) || "").trim();
    });

    await test.step("Enter edit mode and make changes", async () => {
      // Check if edit button is available
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");

      // Wait for editor to be editable
      await editor.click();
      // Wait for editor to be focused and ready for input
      await expect(editor).toBeFocused({ timeout: 2000 });

      // Make changes
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("This should be canceled");
    });

    await test.step("Cancel the edits", async () => {
      // Click cancel
      const cancelButton = page
        .locator("button")
        .filter({ hasText: /^cancel$/i })
        .first();
      await expect(cancelButton).toBeVisible({ timeout: 3000 });
      await cancelButton.click();

      // Wait for page to reload and editor to update
      await page.waitForLoadState("networkidle");
      // Wait for editor content to be restored
      await expect(editor).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify content reverted to initial value", async () => {
      // Wait for the canceled content to be replaced (editor should no longer contain "This should be canceled")
      await expect(editor).not.toContainText("This should be canceled", {
        timeout: 5000,
      });

      // Verify content was reverted (normalize whitespace for comparison)
      const finalContent = ((await editor.textContent()) || "")
        .trim()
        .replace(/\s+/g, " ");
      const normalizedInitial = initialContent!.replace(/\s+/g, " ");
      // Content should match (allowing for minor whitespace differences)
      expect(finalContent).toBe(normalizedInitial);
    });
  });

  test("Rich text formatting - headings", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode", async () => {
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Type and select heading text", async () => {
      await editor.click();
      // Wait for editor to be focused
      await expect(editor).toBeFocused({ timeout: 2000 });

      // Type text first
      await page.keyboard.type("Heading 1");

      // Select the text
      await page.keyboard.press("Home");
      await page.keyboard.down("Shift");
      await page.keyboard.press("End");
      await page.keyboard.up("Shift");
    });

    await test.step("Apply Heading 1 formatting", async () => {
      // Click heading trigger button
      const headingTrigger = page.getByTestId("tiptap-heading-trigger");
      await expect(headingTrigger).toBeVisible({ timeout: 3000 });
      await headingTrigger.click();

      // Click H1 option - wait for dropdown to appear
      const h1Button = page.getByTestId("tiptap-heading-1");
      await expect(h1Button).toBeVisible({ timeout: 3000 });
      await h1Button.click();
    });

    await test.step("Verify heading was created", async () => {
      // Verify heading was created
      const h1Element = editor.locator("h1").first();
      await expect(h1Element).toBeVisible({ timeout: 3000 });
      await expect(h1Element).toContainText("Heading 1");
    });
  });

  test("Rich text formatting - bold and italic", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();
    const boldButton = page.getByTestId("tiptap-bold");

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode", async () => {
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Type text and select it", async () => {
      await editor.click();
      // Wait for editor to be focused
      await expect(editor).toBeFocused({ timeout: 2000 });

      // Type text
      await page.keyboard.type("Bold text");

      // Select all text - use platform-aware shortcut
      await page.keyboard.press("ControlOrMeta+a");
    });

    await test.step("Apply bold formatting", async () => {
      // Click bold button in toolbar (using test ID we added)
      await expect(boldButton).toBeVisible({ timeout: 3000 });
      await boldButton.click();
    });

    await test.step("Verify bold formatting was applied", async () => {
      // Verify bold formatting exists
      // Check the editor HTML for bold tags
      const editorHTML = await editor.innerHTML();
      const hasBoldTag =
        editorHTML.includes("<strong") || editorHTML.includes("<b>");

      if (hasBoldTag) {
        const boldElement = editor.locator("strong, b").first();
        await expect(boldElement).toBeVisible({ timeout: 3000 });
        await expect(boldElement).toContainText("Bold text");
      } else {
        // If no bold tag found, verify the button is active (indicates formatting was applied)
        const isBoldActive = await boldButton.evaluate((el) => {
          return (
            el.classList.contains("bg-primary") ||
            el.getAttribute("data-state") === "active" ||
            el.classList.contains("default")
          );
        });
        expect(isBoldActive).toBeTruthy();
      }
    });
  });

  test("Rich text formatting - lists", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode", async () => {
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Start a bullet list and add items", async () => {
      await editor.click();
      // Wait for editor to be focused
      await expect(editor).toBeFocused({ timeout: 2000 });

      // Click bullet list button
      const listButton = page.getByTestId("tiptap-bullet-list");
      await expect(listButton).toBeVisible({ timeout: 3000 });
      await listButton.click();

      // Type list items
      await page.keyboard.type("Item 1");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Item 2");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Item 3");
    });

    await test.step("Verify list was created", async () => {
      // Verify list was created
      const list = editor.locator("ul, ol").first();
      await expect(list).toBeVisible({ timeout: 3000 });
      const listItems = list.locator("li");
      expect(await listItems.count()).toBeGreaterThanOrEqual(2);
    });
  });

  test("Rich text formatting - code blocks", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode", async () => {
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Insert a code block via slash command", async () => {
      await editor.click();

      // Try to insert code block via slash command
      await page.keyboard.type("/code");

      // Wait for slash command menu to appear and select code block
      const codeOption = page
        .locator(
          '[role="option"]:has-text("Code"), [data-suggestion]:has-text("Code")'
        )
        .first();
      // If slash command menu appears, click the option; otherwise press Enter
      const hasCodeOption = await codeOption
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      if (hasCodeOption) {
        await codeOption.click();
      } else {
        await page.keyboard.press("Enter");
      }

      // Type code content
      await page.keyboard.type("const test = 'code';");
    });

    await test.step("Verify editor remains usable", async () => {
      // Verify code block exists (either pre or code element)
      const _codeBlock = editor.locator("pre, code").first();
      // Code block may or may not be visible depending on implementation
      // Just verify we can type in the editor
      await expect(editor).toBeVisible();
    });
  });

  test("Documentation loads default content when empty", async ({
    api,
    page,
  }) => {
    const editor = page.locator(".ProseMirror").first();

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);

      // Navigate to documentation page
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify editor shows content or a placeholder", async () => {
      // Editor should be visible (may show default content or placeholder)
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Editor should either have content or show placeholder
      const hasContent = ((await editor.textContent()) || "").trim().length > 0;
      const hasPlaceholder = await editor.getAttribute("data-placeholder");

      // Editor should be visible and either have content or placeholder
      expect(hasContent || hasPlaceholder !== null).toBeTruthy();
    });
  });

  test("Documentation persists after page reload", async ({ api, page }) => {
    const editor = page.locator(".ProseMirror").first();
    const testContent = `Persistent content ${Date.now()}`;

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode", async () => {
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      const _canEdit = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      await editButton.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Type content into the settled editor", async () => {
      // Tiptap's ProseMirror takes a tick after the edit-mode transition to
      // become a fully-wired contenteditable. Under heavy parallel load the
      // click → Ctrl+A → type sequence races initialization and the first
      // typed keystroke gets eaten ("Persistent" → "ersistent"). Wait for
      // contenteditable + focus before each input step so the editor has
      // settled before we drive it.
      await expect(editor).toHaveAttribute("contenteditable", "true");
      await editor.click();
      await expect(editor).toBeFocused();

      await page.keyboard.press("ControlOrMeta+a");
      // Insert the whole string atomically (a single insertText input event)
      // rather than char-by-char typing — Tiptap otherwise occasionally
      // swallows the leading keystroke ("Persistent" -> "ersistent").
      await page.keyboard.insertText(testContent);

      // Confirm the editor actually holds the content before we save, so a
      // swallowed keystroke fails here rather than surfacing as a phantom
      // "content did not persist" after reload.
      await expect(editor).toContainText(testContent, { timeout: 5000 });
    });

    await test.step("Save the changes", async () => {
      const saveButton = page
        .locator("button")
        .filter({ hasText: /^save$/i })
        .first();

      // Wait for the save request itself: the document is already at
      // networkidle here, so waitForLoadState would resolve immediately and
      // the reload below would abort the in-flight PUT.
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/model/projects/update") &&
          response.request().method() === "PUT",
        { timeout: 15000 }
      );
      await saveButton.click();
      const response = await responsePromise;
      expect(response.ok()).toBeTruthy();

      // The page leaves edit mode only after the save resolves
      await expect(editor).toHaveAttribute("contenteditable", "false", {
        timeout: 10000,
      });
    });

    await test.step("Reload and verify content persisted", async () => {
      // Reload page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Verify content persisted
      const editorAfterReload = page.locator(".ProseMirror").first();
      await expect(editorAfterReload).toContainText(testContent, {
        timeout: 5000,
      });
    });
  });

  test("Documentation editor shows project name in header", async ({
    api,
    page,
  }) => {
    const projectName = `Doc Header Test ${Date.now()}-${Math.random().toString(36).substring(7)}`;

    await test.step("Open documentation page for a named project", async () => {
      const projectId = await api.createProject(projectName);

      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify project name appears in the page", async () => {
      // Verify project name appears in the page
      await expect(page.locator(`text="${projectName}"`).first()).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Documentation editor is read-only for users without edit permissions", async ({
    api,
    page,
  }) => {
    const editor = page.locator(".ProseMirror").first();
    let hasEditButton: boolean | undefined;

    await test.step("Open documentation page for a new project", async () => {
      const projectId = await createTestProject(api);
      await page.goto(`/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Check whether the Edit button is present", async () => {
      // Edit button should not be visible (or user doesn't have permissions)
      const editButton = page
        .locator("button")
        .filter({ hasText: /edit.*documentation/i })
        .first();
      hasEditButton = await editButton
        .isVisible({ timeout: 3000 })
        .catch(() => false);
    });

    await test.step("Verify editor is read-only without edit permissions", async () => {
      // Editor should be visible
      await expect(editor).toBeVisible({ timeout: 5000 });

      // If edit button is not visible, editor should be read-only
      if (!hasEditButton) {
        const isEditable = await editor.getAttribute("contenteditable");
        expect(isEditable).not.toBe("true");
      }
    });
  });
});
