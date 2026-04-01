import { randomUUID } from "crypto";
import { expect, test } from "../../fixtures";

/**
 * Session Item Display Tests
 *
 * Tests the SessionItem component display features:
 * - Configuration column shows config name or dash
 * - Multi-config indicator (Combine icon) appears next to session name
 * - Configuration tooltip shows full name on hover
 */
test.describe("Session Item Display", () => {
  test("should show configuration name in config column", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E ItemConfig ${ts}`);
    const configName = `Item Config ${ts}`;
    const configId = await api.createConfiguration(configName);
    const sessionId = await api.createSession(
      projectId,
      `Config Session ${ts}`,
      { configId }
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Find the session item
    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });

    // The config name should be visible within the session item
    await expect(sessionItem.locator(`text="${configName}"`)).toBeVisible({
      timeout: 5000,
    });

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should show dash when session has no configuration", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E ItemNoConfig ${ts}`);
    const sessionId = await api.createSession(
      projectId,
      `No Config Session ${ts}`
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });

    // Should show a dash (—) for no configuration
    await expect(sessionItem.locator('text="—"')).toBeVisible({
      timeout: 5000,
    });

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should show multi-config indicator for sessions with configurationGroupId", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E ItemMulti ${ts}`);
    const config1Id = await api.createConfiguration(`Multi1 ${ts}`);
    const config2Id = await api.createConfiguration(`Multi2 ${ts}`);

    const groupId = randomUUID();
    const session1Id = await api.createSession(
      projectId,
      `Multi Session 1 ${ts}`,
      { configId: config1Id, configurationGroupId: groupId }
    );
    const session2Id = await api.createSession(
      projectId,
      `Multi Session 2 ${ts}`,
      { configId: config2Id, configurationGroupId: groupId }
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Both session items should be visible
    const sessionItem1 = page.locator(`#session-${session1Id}`);
    await expect(sessionItem1).toBeVisible({ timeout: 15000 });

    // The session name link area should contain a Combine icon (the multi-config indicator)
    // The Combine icon is an SVG within the h3 that contains the session name
    const nameArea = sessionItem1.locator("h3").first();
    await expect(nameArea).toBeVisible({ timeout: 5000 });

    // The Combine icon is rendered as an SVG next to the name
    // Check that there are at least 2 SVGs in the name area (compass icon + combine icon + link icon)
    const svgCount = await nameArea.locator("svg").count();
    // compass icon + combine icon + link icon = 3 SVGs minimum
    expect(svgCount).toBeGreaterThanOrEqual(3);

    // Cleanup
    await api.deleteSession(session1Id);
    await api.deleteSession(session2Id);
  });

  test("should NOT show multi-config indicator for single sessions", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E ItemSingle ${ts}`);
    const configId = await api.createConfiguration(`Single ${ts}`);
    const sessionId = await api.createSession(
      projectId,
      `Single Session ${ts}`,
      { configId }
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });

    // Single sessions should have only 2 SVGs in name area (compass + link icon)
    // No Combine icon since there's no configurationGroupId
    const nameArea = sessionItem.locator("h3").first();
    const svgCount = await nameArea.locator("svg").count();
    // compass icon + link icon = 2 SVGs (no combine icon)
    expect(svgCount).toBe(2);

    // Cleanup
    await api.deleteSession(sessionId);
  });

  test("should show duplicate option in context menu for active sessions", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E ItemDupMenu ${ts}`);
    const sessionId = await api.createSession(
      projectId,
      `Menu Session ${ts}`
    );

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const sessionItem = page.locator(`#session-${sessionId}`);
    await expect(sessionItem).toBeVisible({ timeout: 15000 });

    // Open the three-dot menu
    const moreButton = sessionItem.locator('button:has(svg)').last();
    await moreButton.click();

    // Duplicate option should be visible
    const duplicateItem = page.getByTestId(
      `session-duplicate-${sessionId}`
    );
    await expect(duplicateItem).toBeVisible({ timeout: 5000 });
    await expect(duplicateItem).toContainText("Duplicate", { timeout: 3000 });

    // Cleanup
    await api.deleteSession(sessionId);
  });
});
