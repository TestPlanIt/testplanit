import { expect, test } from "../../fixtures";

/**
 * Session Duplication Metadata Tests
 *
 * Tests that duplicating a session correctly pre-populates all metadata fields
 * in the Add Session dialog: configuration, milestone, state, tags, and
 * rich-text fields (description, mission).
 */
test.describe("Session Duplication Metadata", () => {
  test("should pre-populate configuration from source session", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E DupConfig ${ts}`);
    const configName = `Dup Config ${ts}`;
    const configId = await api.createConfiguration(configName);
    const sessionId = await api.createSession(
      projectId,
      `Config Source ${ts}`,
      { configId }
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Find the session and click Duplicate
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();
    const duplicateItem = page.getByTestId(
      `session-duplicate-${sessionId}`
    );
    await expect(duplicateItem).toBeVisible({ timeout: 5000 });
    await duplicateItem.click();

    // Wait for dialog
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // The Configurations label should show "(1)" indicating config was pre-selected
    // Allow extra time for the duplication data to load and pre-populate the form
    const configLabel = dialog.locator(
      'label:has-text("Configurations")'
    );
    await expect(configLabel).toContainText("(1)", { timeout: 10000 });

    // The badge should show the config name
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await expect(configCombobox).toContainText(configName, { timeout: 5000 });

    // Cleanup
    const cancelButton = dialog.getByRole("button", { name: /cancel/i });
    await cancelButton.click();
    await api.deleteSession(sessionId);
  });

  test("should pre-populate milestone from source session", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E DupMilestone ${ts}`);
    const milestoneName = `Dup Milestone ${ts}`;
    const milestoneId = await api.createMilestone(
      projectId,
      milestoneName
    );
    const sessionId = await api.createSession(
      projectId,
      `Milestone Source ${ts}`,
      { milestoneId }
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Find the session and click Duplicate
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();
    const duplicateItem = page.getByTestId(
      `session-duplicate-${sessionId}`
    );
    await expect(duplicateItem).toBeVisible({ timeout: 5000 });
    await duplicateItem.click();

    // Wait for dialog
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // The Milestone field should contain the milestone name
    const milestoneLabel = dialog.locator('label:has-text("Milestone")');
    await expect(milestoneLabel).toBeVisible({ timeout: 5000 });
    const milestoneCombobox = milestoneLabel
      .locator("..")
      .locator('[role="combobox"]');
    await expect(milestoneCombobox).toContainText(milestoneName, {
      timeout: 5000,
    });

    // Cleanup
    const cancelButton = dialog.getByRole("button", { name: /cancel/i });
    await cancelButton.click();
    await api.deleteSession(sessionId);
    await api.deleteMilestone(milestoneId);
  });

  test("should show Duplicate Session title in dialog", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E DupTitle ${ts}`);
    const sessionId = await api.createSession(
      projectId,
      `Title Source ${ts}`
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Find the session and click Duplicate
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();
    const duplicateItem = page.getByTestId(
      `session-duplicate-${sessionId}`
    );
    await duplicateItem.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // Dialog title should say "Duplicate Session"
    await expect(
      dialog.locator('h2, [class*="DialogTitle"]')
    ).toContainText("Duplicate Session", { timeout: 5000 });

    // Cleanup
    const cancelButton = dialog.getByRole("button", { name: /cancel/i });
    await cancelButton.click();
    await api.deleteSession(sessionId);
  });

  test("should allow duplicating a completed session", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E DupCompleted ${ts}`);
    const sessionId = await api.createSession(
      projectId,
      `Completed Source ${ts}`,
      { isCompleted: true, completedAt: new Date() }
    );

    await page.goto(`/en-US/projects/sessions/${projectId}?tab=completed`);
    await page.waitForLoadState("load");

    // Find the completed session and click Duplicate
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();
    const duplicateItem = page.getByTestId(
      `session-duplicate-${sessionId}`
    );
    await expect(duplicateItem).toBeVisible({ timeout: 5000 });
    await duplicateItem.click();

    // Dialog should open with the name pre-populated
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    const nameInput = dialog.locator('input[name="name"]');
    const nameValue = await nameInput.inputValue();
    expect(nameValue).toContain(`Completed Source ${ts}`);
    expect(nameValue).toContain("Duplicate");

    // Cleanup
    const cancelButton = dialog.getByRole("button", { name: /cancel/i });
    await cancelButton.click();
    await api.deleteSession(sessionId);
  });
});
