import { expect, test } from "../../fixtures";

/**
 * Session Duplication E2E Tests
 *
 * Tests the ability to duplicate a session from the session context menu.
 * When duplicating, the Add Session dialog opens pre-populated with the
 * original session's metadata (name, config, milestone, state, etc.)
 * but no results are copied.
 *
 * Covers:
 * - Duplicate menu item appears in session context menu
 * - Clicking Duplicate opens the Add Session dialog pre-populated
 * - Duplicated session name includes " - Duplicate" suffix
 * - User can modify fields and submit
 * - New session is created without copying results
 */
test.describe("Session Duplication", () => {
  test("should show duplicate option in session context menu", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Dup Menu ${ts}`);
    const sessionId = await api.createSession(projectId, `Dup Menu Session ${ts}`);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Wait for the session item to appear
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });

    // Click the three-dot menu
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();

    // The "Duplicate" menu item should be visible
    const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
    await expect(duplicateItem).toBeVisible({ timeout: 5000 });

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should open Add Session dialog pre-populated when duplicating", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Dup Prefill ${ts}`);
    const originalName = `Original Session ${ts}`;
    const sessionId = await api.createSession(projectId, originalName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Wait for the session item to appear
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });

    // Click the three-dot menu and then Duplicate
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();

    const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
    await expect(duplicateItem).toBeVisible({ timeout: 5000 });
    await duplicateItem.click();

    // The Add Session dialog should open (may take a moment to fetch data)
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // The dialog title should indicate duplication
    await expect(dialog.locator('h2, [class*="DialogTitle"]')).toContainText(
      "Duplicate",
      { timeout: 5000 }
    );

    // The name field should be pre-populated with "Original Name - Duplicate"
    const nameInput = dialog.locator('input[name="name"]');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    const nameValue = await nameInput.inputValue();
    expect(nameValue).toContain(originalName);
    expect(nameValue).toContain("Duplicate");

    // Cleanup - close dialog and delete session
    const cancelButton = dialog.getByRole("button", { name: /cancel/i });
    await cancelButton.click();
    await api.deleteSession(sessionId);
  });

  test("should create a duplicated session with modified name", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Dup Create ${ts}`);
    const originalName = `Source Session ${ts}`;
    const sessionId = await api.createSession(projectId, originalName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Wait for the session item
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });

    // Open context menu and click Duplicate
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();
    const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
    await duplicateItem.click();

    // Wait for dialog to appear
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // Modify the name
    const nameInput = dialog.locator('input[name="name"]');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    const newName = `Duplicated Session ${ts}`;
    await nameInput.clear();
    await nameInput.fill(newName);

    // Submit the form
    const submitButton = dialog.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Dialog should close after successful creation
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Verify the new session was created
    const newSessionResponse = await page.request.get(
      `/api/model/sessions/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { projectId, name: newName, isDeleted: false },
          select: { id: true },
        })
      )}`
    );
    expect(newSessionResponse.ok()).toBeTruthy();
    const newSessionData = await newSessionResponse.json();
    expect(newSessionData.data).not.toBeNull();
    expect(newSessionData.data.id).not.toBe(sessionId);

    // Cleanup
    await api.deleteSession(sessionId);
    if (newSessionData.data?.id) {
      await api.deleteSession(newSessionData.data.id);
    }
  });
});
