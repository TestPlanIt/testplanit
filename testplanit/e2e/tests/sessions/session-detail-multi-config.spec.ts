import { randomUUID } from "crypto";
import { expect, test } from "../../fixtures";

/**
 * Session Detail Multi-Configuration Selector Tests
 *
 * Tests the AsyncCombobox configuration selector that appears on the session
 * detail page when the session is part of a multi-configuration group
 * (i.e., multiple sibling sessions share the same configurationGroupId).
 *
 * Covers:
 * - Configuration selector appears for multi-config sessions
 * - Configuration selector does NOT appear for single-config sessions
 * - Selecting a different configuration navigates to that sibling session
 */
test.describe("Session Detail Multi-Config Selector", () => {
  test("should show configuration selector for multi-config sessions", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E SessMultiCfg ${ts}`);
    const config1Id = await api.createConfiguration(`Chrome ${ts}`);
    const config2Id = await api.createConfiguration(`Firefox ${ts}`);

    const groupId = randomUUID();
    const session1Id = await api.createSession(
      projectId,
      `Chrome Session ${ts}`,
      { configId: config1Id, configurationGroupId: groupId }
    );
    await api.createSession(projectId, `Firefox Session ${ts}`, {
      configId: config2Id,
      configurationGroupId: groupId,
    });

    // Navigate to session1's detail page
    await page.goto(
      `/en-US/projects/sessions/${projectId}/${session1Id}`
    );
    await page.waitForLoadState("load");

    // The "Configurations:" label should be visible
    const configurationsLabel = page
      .locator('span:has-text("Configurations:")')
      .first();
    await expect(configurationsLabel).toBeVisible({ timeout: 15000 });

    // The combobox should be visible next to it
    const configContainer = configurationsLabel.locator("../..");
    const configSelector = configContainer
      .locator('button[role="combobox"]')
      .first();
    await expect(configSelector).toBeVisible({ timeout: 5000 });

    // It should show the current session's configuration name
    await expect(configSelector).toContainText(`Chrome ${ts}`, {
      timeout: 5000,
    });

    // Cleanup
    await api.deleteSession(session1Id);
  });

  test("should not show configuration selector for single-config sessions", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E SessSingleCfg ${ts}`);
    const configId = await api.createConfiguration(`Solo Config ${ts}`);

    // Create a single session (no configurationGroupId)
    const sessionId = await api.createSession(
      projectId,
      `Solo Session ${ts}`,
      { configId }
    );

    await page.goto(
      `/en-US/projects/sessions/${projectId}/${sessionId}`
    );
    await page.waitForLoadState("load");

    // Wait for the page to fully load
    await page.waitForTimeout(3000);

    // The "Configurations:" label should NOT be visible
    await expect(
      page.locator('text="Configurations:"')
    ).not.toBeVisible({ timeout: 5000 });

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should navigate to sibling session when selecting a different configuration", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E SessNavCfg ${ts}`);
    const config1Name = `Safari ${ts}`;
    const config2Name = `Edge ${ts}`;
    const config1Id = await api.createConfiguration(config1Name);
    const config2Id = await api.createConfiguration(config2Name);

    const groupId = randomUUID();
    const session1Id = await api.createSession(
      projectId,
      `Safari Session ${ts}`,
      { configId: config1Id, configurationGroupId: groupId }
    );
    const session2Id = await api.createSession(
      projectId,
      `Edge Session ${ts}`,
      { configId: config2Id, configurationGroupId: groupId }
    );

    // Navigate to session1
    await page.goto(
      `/en-US/projects/sessions/${projectId}/${session1Id}`
    );
    await page.waitForLoadState("load");

    // Wait for the configuration selector
    const configurationsLabel = page
      .locator('span:has-text("Configurations:")')
      .first();
    await expect(configurationsLabel).toBeVisible({ timeout: 15000 });

    const configContainer = configurationsLabel.locator("../..");
    const configCombobox = configContainer
      .locator('button[role="combobox"]')
      .first();
    await expect(configCombobox).toBeVisible({ timeout: 5000 });

    // Open the combobox
    await configCombobox.click();

    // Select the other configuration (Edge)
    const edgeOption = page.locator(
      `[role="option"]:has-text("${config2Name}")`
    );
    await expect(edgeOption).toBeVisible({ timeout: 10000 });
    await edgeOption.click();

    // Should navigate to session2's detail page
    await page.waitForURL(`**/sessions/${projectId}/${session2Id}`, {
      timeout: 10000,
    });

    // Verify we're on the correct session
    await expect(page.locator(`text="Edge Session ${ts}"`)).toBeVisible({
      timeout: 10000,
    });

    // Cleanup
    await api.deleteSession(session1Id);
    await api.deleteSession(session2Id);
  });
});
