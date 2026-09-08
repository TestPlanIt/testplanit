import { expect, test } from "../../fixtures";

/**
 * Session Multi-Configuration Creation Tests
 *
 * Tests the MultiAsyncCombobox configuration selector in the Add Session dialog.
 * When multiple configurations are selected, one Session is created per configuration,
 * all sharing the same metadata and linked via a configurationGroupId.
 *
 * Covers:
 * - Selecting multiple configurations via MultiAsyncCombobox
 * - Creating multiple sessions from a single form submission
 * - Verifying sessions share the same configurationGroupId
 * - Clearing all configurations
 */
test.describe("Session Multi-Configuration Creation", () => {
  test("should display MultiAsyncCombobox for configurations", async ({
    api,
    page,
  }) => {
    const configName = `MultiConfig ${Date.now()}`;

    let projectId: number | undefined;
    await test.step("Create a project with one configuration", async () => {
      projectId = await api.createProject(
        `E2E MultiConfig Session ${Date.now()}`
      );
      await api.createConfiguration(configName, projectId);
    });

    await test.step("Open the sessions page and the Add Session dialog", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");

      const newSessionButton = page.getByTestId("new-session-button");
      await expect(newSessionButton).toBeVisible({ timeout: 15000 });
      await newSessionButton.click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the Configurations field renders a MultiAsyncCombobox", async () => {
      const dialog = page.locator('[role="dialog"]').first();

      // The Configurations field should have a MultiAsyncCombobox
      // Look for the label "Configurations" (plural, indicating multi-select)
      const configLabel = dialog.locator('label:has-text("Configurations")');
      await expect(configLabel).toBeVisible({ timeout: 5000 });

      // The MultiAsyncCombobox renders a button[role="combobox"]
      const configCombobox = configLabel
        .locator("..")
        .locator('button[role="combobox"]');
      await expect(configCombobox).toBeVisible({ timeout: 5000 });

      // Click to open and verify config is available
      await configCombobox.click();
      const configOption = page.locator(
        `[role="option"]:has-text("${configName}")`
      );
      await expect(configOption).toBeVisible({ timeout: 10000 });
    });
  });

  test("should select multiple configurations and show badges", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const config1Name = `Chrome ${ts}`;
    const config2Name = `Firefox ${ts}`;

    let projectId: number | undefined;
    await test.step("Create a project with two configurations", async () => {
      projectId = await api.createProject(`E2E MultiSelect ${ts}`);
      await api.createConfiguration(config1Name, projectId);
      await api.createConfiguration(config2Name, projectId);
    });

    await test.step("Open the sessions page and the Add Session dialog", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");

      const newSessionButton = page.getByTestId("new-session-button");
      await expect(newSessionButton).toBeVisible({ timeout: 15000 });
      await newSessionButton.click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Select both configurations from the combobox", async () => {
      const dialog = page.locator('[role="dialog"]').first();

      // Open the configurations combobox
      const configLabel = dialog.locator('label:has-text("Configurations")');
      const configCombobox = configLabel
        .locator("..")
        .locator('button[role="combobox"]');
      await configCombobox.click();

      // Select first config
      const option1 = page.locator(
        `[role="option"]:has-text("${config1Name}")`
      );
      await expect(option1).toBeVisible({ timeout: 10000 });
      await option1.click({ force: true });

      // Wait for the combobox to settle after selection
      await page.waitForTimeout(500);

      // Re-open and select second config
      await configCombobox.click();
      const option2 = page.locator(
        `[role="option"]:has-text("${config2Name}")`
      );
      await expect(option2).toBeVisible({ timeout: 10000 });
      await option2.click({ force: true });

      // Close the popover
      await page.keyboard.press("Escape");
    });

    await test.step("Verify the label shows a selection count of two", async () => {
      const dialog = page.locator('[role="dialog"]').first();
      const configLabel = dialog.locator('label:has-text("Configurations")');

      // The label should show count "(2)"
      await expect(configLabel).toContainText("(2)", { timeout: 5000 });
    });
  });

  test("should create multiple sessions when multiple configs are selected", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const config1Name = `Safari ${ts}`;
    const config2Name = `Edge ${ts}`;
    const sessionName = `Multi-Config Session ${ts}`;

    let projectId: number | undefined;
    await test.step("Create a project with two configurations", async () => {
      projectId = await api.createProject(`E2E MultiCreate ${ts}`);
      await api.createConfiguration(config1Name, projectId);
      await api.createConfiguration(config2Name, projectId);
    });

    await test.step("Open the sessions page and the Add Session dialog", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");

      const newSessionButton = page.getByTestId("new-session-button");
      await expect(newSessionButton).toBeVisible({ timeout: 15000 });
      await newSessionButton.click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill the session name and select both configurations", async () => {
      const dialog = page.locator('[role="dialog"]').first();

      // Fill session name
      const nameInput = dialog.locator('input[name="name"]');
      await nameInput.fill(sessionName);

      // Select both configurations
      const configLabel = dialog.locator('label:has-text("Configurations")');
      const configCombobox = configLabel
        .locator("..")
        .locator('button[role="combobox"]');
      await configCombobox.click();
      const opt1 = page.locator(`[role="option"]:has-text("${config1Name}")`);
      await expect(opt1).toBeVisible({ timeout: 10000 });
      await opt1.click({ force: true });
      await page.waitForTimeout(500);
      await configCombobox.click();
      const opt2 = page.locator(`[role="option"]:has-text("${config2Name}")`);
      await expect(opt2).toBeVisible({ timeout: 10000 });
      await opt2.click({ force: true });
      await page.keyboard.press("Escape");
    });

    await test.step("Submit the form and wait for the dialog to close", async () => {
      const dialog = page.locator('[role="dialog"]').first();

      // Submit the form
      const submitButton = dialog.locator('button[type="submit"]');
      await submitButton.click();

      // Dialog should close
      await expect(dialog).not.toBeVisible({ timeout: 15000 });
    });

    let sessions: any[] | undefined;
    await test.step("Verify two sessions were created sharing a configuration group", async () => {
      // Verify two sessions were created with the same name
      const sessionsResponse = await page.request.get(
        `/api/model/sessions/findMany?q=${encodeURIComponent(
          JSON.stringify({
            where: { projectId, name: sessionName, isDeleted: false },
            select: { id: true, configId: true, configurationGroupId: true },
          })
        )}`
      );
      expect(sessionsResponse.ok()).toBeTruthy();
      const sessionsData = await sessionsResponse.json();
      sessions = sessionsData.data;

      // Should have created 2 sessions
      expect(sessions).toHaveLength(2);

      // Both should share the same configurationGroupId
      const groupIds = sessions!.map((s: any) => s.configurationGroupId);
      expect(groupIds[0]).not.toBeNull();
      expect(groupIds[0]).toBe(groupIds[1]);

      // Each should have a different configId
      const configIds = sessions!.map((s: any) => s.configId);
      expect(configIds[0]).not.toBe(configIds[1]);
    });

    // Cleanup
    for (const s of sessions!) {
      await api.deleteSession(s.id);
    }
  });

  test("should clear all configurations from the dropdown", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const configName = `ClearMe ${ts}`;

    let projectId: number | undefined;
    await test.step("Create a project with one configuration", async () => {
      projectId = await api.createProject(`E2E ClearAll ${ts}`);
      await api.createConfiguration(configName, projectId);
    });

    await test.step("Open the sessions page and the Add Session dialog", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");

      const newSessionButton = page.getByTestId("new-session-button");
      await expect(newSessionButton).toBeVisible({ timeout: 15000 });
      await newSessionButton.click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Select a configuration by searching for it", async () => {
      const dialog = page.locator('[role="dialog"]').first();

      // Select a configuration
      const configLabel = dialog.locator('label:has-text("Configurations")');
      const configCombobox = configLabel
        .locator("..")
        .locator('button[role="combobox"]');
      await configCombobox.click();

      // Search for the specific config to filter out configs from other tests
      const searchInput = page.locator("[cmdk-input]");
      await expect(searchInput).toBeVisible({ timeout: 5000 });
      await searchInput.fill(configName);
      await page.waitForTimeout(500);

      const option = page.locator(`[role="option"]:has-text("${configName}")`);
      await expect(option).toBeVisible({ timeout: 10000 });
      await option.click({ force: true });
      await page.keyboard.press("Escape");

      // Verify count shows "(1)"
      await expect(configLabel).toContainText("(1)", { timeout: 5000 });
    });

    await test.step("Click Clear All and verify the selection is cleared", async () => {
      const dialog = page.locator('[role="dialog"]').first();
      const configLabel = dialog.locator('label:has-text("Configurations")');

      // Clear All lives in the dropdown, so reopen it first
      await configLabel
        .locator("..")
        .locator('button[role="combobox"]')
        .click();

      const clearAll = page.getByTestId("multi-async-combobox-clear-all");
      await expect(clearAll).toBeVisible({ timeout: 5000 });
      await clearAll.click();
      await page.keyboard.press("Escape");

      // Count should no longer be visible
      await expect(configLabel).not.toContainText("(1)", { timeout: 5000 });
    });
  });
});
