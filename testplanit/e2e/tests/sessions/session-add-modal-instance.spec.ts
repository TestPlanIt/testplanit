import { expect, test } from "../../fixtures";

/**
 * Session Add Modal Instance Tests
 *
 * Tests that the single AddSessionModal instance works correctly when triggered
 * from different entry points (header button, milestone add button, unscheduled
 * add button). Validates milestone pre-selection and form reset between uses.
 */
test.describe("Session Add Modal Instance", () => {
  test("should open Add Session dialog from the header button with no milestone pre-selected", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const milestoneName = `Header Milestone ${ts}`;
    const dialog = page.locator('[role="dialog"]').first();

    let projectId: number | undefined;
    let sessionId: number | undefined;

    await test.step("Create project, milestone, and a placeholder session", async () => {
      projectId = await api.createProject(`E2E ModalHeader ${ts}`);
      await api.createMilestone(projectId, milestoneName);

      // Create a session under the milestone so the milestone group shows
      sessionId = await api.createSession(
        projectId,
        `Placeholder Session ${ts}`
      );
    });

    await test.step("Open the Add Session dialog from the header button", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");

      // Click the header "New Session" button
      const newSessionButton = page.getByTestId("new-session-button");
      await expect(newSessionButton).toBeVisible({ timeout: 15000 });
      await newSessionButton.click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify no milestone is pre-selected", async () => {
      // Milestone field should show "None" or be empty (no pre-selection)
      // The MilestoneSelect uses a combobox; check it doesn't contain the milestone name
      const milestoneLabel = dialog.locator('label:has-text("Milestone")');
      await expect(milestoneLabel).toBeVisible({ timeout: 5000 });
      const milestoneCombobox = milestoneLabel
        .locator("..")
        .locator('[role="combobox"]');
      await expect(milestoneCombobox).not.toContainText(milestoneName, {
        timeout: 3000,
      });
    });

    await test.step("Close the dialog", async () => {
      const cancelButton = dialog.getByRole("button", { name: /cancel/i });
      await cancelButton.click();
    });

    // Cleanup
    await api.deleteSession(sessionId!);
  });

  test("should reset form fields when closing and reopening the dialog", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const configName = `Reset Config ${ts}`;
    const dialog = page.locator('[role="dialog"]').first();
    const newSessionButton = page.getByTestId("new-session-button");

    let projectId: number | undefined;

    await test.step("Create project with a configuration", async () => {
      projectId = await api.createProject(`E2E ModalReset ${ts}`);
      await api.createConfiguration(configName, projectId);
    });

    await test.step("Open the Add Session modal", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");

      // Open the modal
      await expect(newSessionButton).toBeVisible({ timeout: 15000 });
      await newSessionButton.click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill in the name and select a configuration", async () => {
      // Fill in the name
      const nameInput = dialog.locator('input[name="name"]');
      await nameInput.fill(`Temp Session ${ts}`);

      // Select a configuration
      const configLabel = dialog.locator('label:has-text("Configurations")');
      const configCombobox = configLabel
        .locator("..")
        .locator('button[role="combobox"]');
      await configCombobox.click();
      await page.locator(`[role="option"]:has-text("${configName}")`).click();
      await page.keyboard.press("Escape");

      // Verify config is selected
      await expect(configLabel).toContainText("(1)", { timeout: 5000 });
    });

    await test.step("Cancel the dialog", async () => {
      const cancelButton = dialog.getByRole("button", { name: /cancel/i });
      await cancelButton.click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Reopen the modal and verify the form was reset", async () => {
      // Reopen the modal
      await newSessionButton.click();
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Name should be empty
      const nameInputAfter = dialog.locator('input[name="name"]');
      await expect(nameInputAfter).toHaveValue("", { timeout: 5000 });

      // Configurations count should not show "(1)"
      const configLabelAfter = dialog.locator(
        'label:has-text("Configurations")'
      );
      await expect(configLabelAfter).not.toContainText("(1)", {
        timeout: 3000,
      });
    });

    await test.step("Close the dialog", async () => {
      const cancelButton2 = dialog.getByRole("button", { name: /cancel/i });
      await cancelButton2.click();
    });
  });
});
