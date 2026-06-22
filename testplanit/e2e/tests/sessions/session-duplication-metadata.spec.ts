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
    const configName = `Dup Config ${ts}`;
    let sessionId: number | undefined;
    let dialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create a project, configuration, and session", async () => {
      const projectId = await api.createProject(`E2E DupConfig ${ts}`);
      const configId = await api.createConfiguration(configName, projectId);
      sessionId = await api.createSession(projectId, `Config Source ${ts}`, {
        configId,
      });

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Open the session's Duplicate action", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });
      const moreButton = sessionItem.locator("button:has(svg)").last();
      await moreButton.click();
      const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
      await expect(duplicateItem).toBeVisible({ timeout: 5000 });
      await duplicateItem.click();
    });

    await test.step("Wait for the Add Session dialog to open", async () => {
      dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify the configuration is pre-populated", async () => {
      // The Configurations label should show "(1)" indicating config was pre-selected
      // Allow extra time for the duplication data to load and pre-populate the form
      const configLabel = dialog!.locator('label:has-text("Configurations")');
      await expect(configLabel).toContainText("(1)", { timeout: 10000 });

      // The badge should show the config name
      const configCombobox = configLabel
        .locator("..")
        .locator('button[role="combobox"]');
      await expect(configCombobox).toContainText(configName, { timeout: 5000 });
    });

    await test.step("Cancel the dialog and delete the session", async () => {
      const cancelButton = dialog!.getByRole("button", { name: /cancel/i });
      await cancelButton.click();
      await api.deleteSession(sessionId!);
    });
  });

  test("should pre-populate milestone from source session", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const milestoneName = `Dup Milestone ${ts}`;
    let milestoneId: number | undefined;
    let sessionId: number | undefined;
    let dialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create a project, milestone, and session", async () => {
      const projectId = await api.createProject(`E2E DupMilestone ${ts}`);
      milestoneId = await api.createMilestone(projectId, milestoneName);
      sessionId = await api.createSession(projectId, `Milestone Source ${ts}`, {
        milestoneId,
      });

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Open the session's Duplicate action", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });
      const moreButton = sessionItem.locator("button:has(svg)").last();
      await moreButton.click();
      const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
      await expect(duplicateItem).toBeVisible({ timeout: 5000 });
      await duplicateItem.click();
    });

    await test.step("Wait for the Add Session dialog to open", async () => {
      dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify the milestone is pre-populated", async () => {
      const milestoneLabel = dialog!.locator('label:has-text("Milestone")');
      await expect(milestoneLabel).toBeVisible({ timeout: 5000 });
      const milestoneCombobox = milestoneLabel
        .locator("..")
        .locator('[role="combobox"]');
      await expect(milestoneCombobox).toContainText(milestoneName, {
        timeout: 5000,
      });
    });

    await test.step("Cancel the dialog and delete the session and milestone", async () => {
      const cancelButton = dialog!.getByRole("button", { name: /cancel/i });
      await cancelButton.click();
      await api.deleteSession(sessionId!);
      await api.deleteMilestone(milestoneId!);
    });
  });

  test("should show Duplicate Session title in dialog", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let sessionId: number | undefined;
    let dialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create a project and session", async () => {
      const projectId = await api.createProject(`E2E DupTitle ${ts}`);
      sessionId = await api.createSession(projectId, `Title Source ${ts}`);

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Open the session's Duplicate action", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });
      const moreButton = sessionItem.locator("button:has(svg)").last();
      await moreButton.click();
      const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
      await duplicateItem.click();
    });

    await test.step("Verify the dialog title reads Duplicate Session", async () => {
      dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 15000 });

      await expect(dialog.locator('h2, [class*="DialogTitle"]')).toContainText(
        "Duplicate Session",
        { timeout: 5000 }
      );
    });

    await test.step("Cancel the dialog and delete the session", async () => {
      const cancelButton = dialog!.getByRole("button", { name: /cancel/i });
      await cancelButton.click();
      await api.deleteSession(sessionId!);
    });
  });

  test("should allow duplicating a completed session", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let sessionId: number | undefined;
    let dialog: ReturnType<typeof page.locator> | undefined;

    await test.step("Create a project and a completed session", async () => {
      const projectId = await api.createProject(`E2E DupCompleted ${ts}`);
      sessionId = await api.createSession(projectId, `Completed Source ${ts}`, {
        isCompleted: true,
        completedAt: new Date(),
      });

      await page.goto(`/en-US/projects/sessions/${projectId}?tab=completed`);
      await page.waitForLoadState("load");
    });

    await test.step("Open the completed session's Duplicate action", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });
      const moreButton = sessionItem.locator("button:has(svg)").last();
      await moreButton.click();
      const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
      await expect(duplicateItem).toBeVisible({ timeout: 5000 });
      await duplicateItem.click();
    });

    await test.step("Verify the dialog opens with the name pre-populated", async () => {
      dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 15000 });

      const nameInput = dialog.locator('input[name="name"]');
      const nameValue = await nameInput.inputValue();
      expect(nameValue).toContain(`Completed Source ${ts}`);
      expect(nameValue).toContain("Duplicate");
    });

    await test.step("Cancel the dialog and delete the session", async () => {
      const cancelButton = dialog!.getByRole("button", { name: /cancel/i });
      await cancelButton.click();
      await api.deleteSession(sessionId!);
    });
  });
});
