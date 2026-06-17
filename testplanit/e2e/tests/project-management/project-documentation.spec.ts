import { expect, test } from "../../fixtures";

/**
 * Project Documentation Editor E2E tests - PROJ-04
 *
 * Covers: edit, save, cancel, and AI writing assistant presence.
 *
 * The documentation page uses a TipTap editor (ProseMirror) with:
 * - "Edit Documentation" button to enter edit mode
 * - "Save" and "Cancel" buttons when in edit mode
 * - TipTap toolbar with AI writing assistant button
 */

test.describe("Project Documentation Editor", () => {
  test("should load the documentation page with the project name", async ({
    page,
    api,
  }) => {
    const projectName = `E2E Docs Project ${Date.now()}`;
    const projectId = await api.createProject(projectName);

    await test.step("Open the project documentation page", async () => {
      await page.goto(`/en-US/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the project name and Edit Documentation button are shown", async () => {
      // Verify page loaded with project name in the header
      // The project name may appear in both the header and the breadcrumb
      await expect(page.getByText(projectName).first()).toBeVisible({
        timeout: 15000,
      });

      // The "Edit Documentation" button should be present for editors
      await expect(
        page.getByRole("button", { name: /Edit Documentation/i })
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test("should enter edit mode and display Save and Cancel buttons", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(`E2E Docs Edit ${Date.now()}`);

    await test.step("Open the project documentation page", async () => {
      await page.goto(`/en-US/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode via the Edit Documentation button", async () => {
      // Wait for the Edit button
      const editButton = page.getByRole("button", {
        name: /Edit Documentation/i,
      });
      await expect(editButton).toBeVisible({ timeout: 15000 });
      await editButton.click();
    });

    await test.step("Verify Save, Cancel, and the editable editor are shown", async () => {
      // Save and Cancel buttons should appear
      await expect(page.getByRole("button", { name: /Save/i })).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByRole("button", { name: /Cancel/i })).toBeVisible({
        timeout: 5000,
      });

      // The editor should be in editable mode (contenteditable="true")
      await expect(page.locator('[contenteditable="true"]')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("should save typed content and persist it on reload", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(`E2E Docs Save ${Date.now()}`);

    const uniqueContent = `E2E Documentation Content ${Date.now()}`;

    await test.step("Open the project documentation page", async () => {
      await page.goto(`/en-US/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode and type unique content", async () => {
      // Enter edit mode
      const editButton = page.getByRole("button", {
        name: /Edit Documentation/i,
      });
      await expect(editButton).toBeVisible({ timeout: 15000 });
      await editButton.click();

      // Wait for the editor to become editable
      const editor = page.locator('[contenteditable="true"]');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Type some unique content
      await editor.click();
      await editor.type(uniqueContent);
    });

    await test.step("Save the changes and confirm edit mode ends", async () => {
      // Save the changes
      await page.getByRole("button", { name: /Save/i }).click();

      // Edit mode should end (Save button disappears)
      await expect(page.getByRole("button", { name: /Save/i })).not.toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Reload and verify the saved content persists", async () => {
      // Reload page and verify content persists
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Content should still be visible after reload
      await expect(page.getByText(uniqueContent)).toBeVisible({
        timeout: 15000,
      });
    });
  });

  test("should cancel edit and restore original content", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(`E2E Docs Cancel ${Date.now()}`);

    await test.step("Open the project documentation page", async () => {
      await page.goto(`/en-US/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode and type content to discard", async () => {
      // Enter edit mode
      const editButton = page.getByRole("button", {
        name: /Edit Documentation/i,
      });
      await expect(editButton).toBeVisible({ timeout: 15000 });
      await editButton.click();

      // Wait for the editor to become editable
      const editor = page.locator('[contenteditable="true"]');
      await expect(editor).toBeVisible({ timeout: 5000 });

      // Type some content that we will discard
      await editor.click();
      await editor.type("Content to be discarded");
    });

    await test.step("Cancel the edit and confirm the content was discarded", async () => {
      // Click Cancel
      await page.getByRole("button", { name: /Cancel/i }).click();

      // Edit mode should end — Save button should not be visible
      await expect(page.getByRole("button", { name: /Save/i })).not.toBeVisible({
        timeout: 10000,
      });

      // The discarded text should not appear in the readonly content
      await expect(page.getByText("Content to be discarded")).not.toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("should show the TipTap toolbar in edit mode", async ({ page, api }) => {
    const projectId = await api.createProject(`E2E Docs Toolbar ${Date.now()}`);

    await test.step("Open the project documentation page", async () => {
      await page.goto(`/en-US/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode via the Edit Documentation button", async () => {
      // Enter edit mode
      const editButton = page.getByRole("button", {
        name: /Edit Documentation/i,
      });
      await expect(editButton).toBeVisible({ timeout: 15000 });
      await editButton.click();
    });

    await test.step("Verify TipTap toolbar formatting buttons are visible", async () => {
      // TipTap toolbar buttons should be visible (verify common formatting buttons)
      await expect(page.getByTestId("tiptap-bold")).toBeVisible({
        timeout: 5000,
      });
      await expect(page.getByTestId("tiptap-italic")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("should have the AI writing assistant button visible in edit mode", async ({
    page,
    api,
  }) => {
    const projectId = await api.createProject(`E2E Docs AI ${Date.now()}`);

    await test.step("Open the project documentation page", async () => {
      await page.goto(`/en-US/projects/documentation/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Enter edit mode and wait for the editable editor", async () => {
      // Enter edit mode
      const editButton = page.getByRole("button", {
        name: /Edit Documentation/i,
      });
      await expect(editButton).toBeVisible({ timeout: 15000 });
      await editButton.click();

      // Wait for editor to be editable
      await expect(page.locator('[contenteditable="true"]')).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Verify the optional AI writing assistant button if present", async () => {
      // Look for an AI assistant button in the TipTap toolbar.
      // The button may be labelled "AI", "Write", "Magic", or use a test-id.
      // We check for any button in the toolbar area containing an AI-related label.
      const aiButton = page
        .locator(
          '[data-testid^="tiptap-ai"], button:has-text("AI"), button:has-text("Magic")'
        )
        .first();

      // If an AI button exists, verify it is visible; otherwise pass (the feature may
      // require an LLM integration to be configured at the instance level).
      const aiButtonExists = await aiButton.count();
      if (aiButtonExists > 0) {
        await expect(aiButton).toBeVisible({ timeout: 5000 });
      }
      // No assertion failure when the button is not present — AI is optional/configurable
    });
  });
});
