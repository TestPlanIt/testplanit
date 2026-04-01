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
    const projectId = await api.createProject(
      `E2E MultiConfig Session ${Date.now()}`
    );
    const configName = `MultiConfig ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // The Configurations field should have a MultiAsyncCombobox
    // Look for the label "Configurations" (plural, indicating multi-select)
    const configLabel = dialog.locator(
      'label:has-text("Configurations")'
    );
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

  test("should select multiple configurations and show badges", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(
      `E2E MultiSelect ${ts}`
    );
    const config1Name = `Chrome ${ts}`;
    const config2Name = `Firefox ${ts}`;
    await api.createConfiguration(config1Name);
    await api.createConfiguration(config2Name);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the configurations combobox
    const configLabel = dialog.locator(
      'label:has-text("Configurations")'
    );
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await configCombobox.click();

    // Select first config
    const option1 = page.locator(`[role="option"]:has-text("${config1Name}")`);
    await expect(option1).toBeVisible({ timeout: 10000 });
    await option1.click({ force: true });

    // Wait for the combobox to settle after selection
    await page.waitForTimeout(500);

    // Re-open and select second config
    await configCombobox.click();
    const option2 = page.locator(`[role="option"]:has-text("${config2Name}")`);
    await expect(option2).toBeVisible({ timeout: 10000 });
    await option2.click({ force: true });

    // Close the popover
    await page.keyboard.press("Escape");

    // The label should show count "(2)"
    await expect(configLabel).toContainText("(2)", { timeout: 5000 });
  });

  test("should create multiple sessions when multiple configs are selected", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(
      `E2E MultiCreate ${ts}`
    );
    const config1Name = `Safari ${ts}`;
    const config2Name = `Edge ${ts}`;
    await api.createConfiguration(config1Name);
    await api.createConfiguration(config2Name);
    const sessionName = `Multi-Config Session ${ts}`;

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill session name
    const nameInput = dialog.locator('input[name="name"]');
    await nameInput.fill(sessionName);

    // Select both configurations
    const configLabel = dialog.locator(
      'label:has-text("Configurations")'
    );
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

    // Submit the form
    const submitButton = dialog.locator('button[type="submit"]');
    await submitButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

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
    const sessions = sessionsData.data;

    // Should have created 2 sessions
    expect(sessions).toHaveLength(2);

    // Both should share the same configurationGroupId
    const groupIds = sessions.map(
      (s: any) => s.configurationGroupId
    );
    expect(groupIds[0]).not.toBeNull();
    expect(groupIds[0]).toBe(groupIds[1]);

    // Each should have a different configId
    const configIds = sessions.map((s: any) => s.configId);
    expect(configIds[0]).not.toBe(configIds[1]);

    // Cleanup
    for (const s of sessions) {
      await api.deleteSession(s.id);
    }
  });

  test("should clear all configurations via Clear All link", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(
      `E2E ClearAll ${ts}`
    );
    const configName = `ClearMe ${ts}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Select a configuration
    const configLabel = dialog.locator(
      'label:has-text("Configurations")'
    );
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await configCombobox.click();

    // Search for the specific config to filter out configs from other tests
    const searchInput = page.locator('[cmdk-input]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill(configName);
    await page.waitForTimeout(500);

    const option = page.locator(`[role="option"]:has-text("${configName}")`);
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click({ force: true });
    await page.keyboard.press("Escape");

    // Verify count shows "(1)"
    await expect(configLabel).toContainText("(1)", { timeout: 5000 });

    // Click "Clear All" link
    const clearAll = configLabel
      .locator("..")
      .locator('span:has-text("Clear All")');
    await expect(clearAll).toBeVisible({ timeout: 5000 });
    await clearAll.click();

    // Count should no longer be visible
    await expect(configLabel).not.toContainText("(1)", { timeout: 5000 });
  });
});
