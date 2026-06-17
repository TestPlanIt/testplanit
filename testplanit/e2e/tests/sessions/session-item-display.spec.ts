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
    const configName = `Item Config ${ts}`;
    let sessionId: number | undefined;

    await test.step("Create a project, configuration, and session with that config", async () => {
      const projectId = await api.createProject(`E2E ItemConfig ${ts}`);
      const configId = await api.createConfiguration(configName, projectId);
      sessionId = await api.createSession(projectId, `Config Session ${ts}`, {
        configId,
      });

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Verify the config name appears in the session item", async () => {
      // Find the session item
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });

      // The config name should be visible within the session item
      await expect(sessionItem.locator(`text="${configName}"`)).toBeVisible({
        timeout: 5000,
      });
    });

    // Cleanup
    await api.deleteSession(sessionId!);
  });

  test("should show dash when session has no configuration", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let sessionId: number | undefined;

    await test.step("Create a project and a session with no configuration", async () => {
      const projectId = await api.createProject(`E2E ItemNoConfig ${ts}`);
      sessionId = await api.createSession(projectId, `No Config Session ${ts}`);

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Verify the config column shows a dash", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });

      // Should show a dash (—) for no configuration
      await expect(sessionItem.locator('text="—"')).toBeVisible({
        timeout: 5000,
      });
    });

    // Cleanup
    await api.deleteSession(sessionId!);
  });

  test("should show multi-config indicator for sessions with configurationGroupId", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const groupId = randomUUID();
    let session1Id: number | undefined;
    let session2Id: number | undefined;

    await test.step("Create a project with two configs and two grouped sessions", async () => {
      const projectId = await api.createProject(`E2E ItemMulti ${ts}`);
      const config1Id = await api.createConfiguration(
        `Multi1 ${ts}`,
        projectId
      );
      const config2Id = await api.createConfiguration(
        `Multi2 ${ts}`,
        projectId
      );

      session1Id = await api.createSession(projectId, `Multi Session 1 ${ts}`, {
        configId: config1Id,
        configurationGroupId: groupId,
      });
      session2Id = await api.createSession(projectId, `Multi Session 2 ${ts}`, {
        configId: config2Id,
        configurationGroupId: groupId,
      });

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Verify the multi-config combine indicator appears in the name heading", async () => {
      // Both session items should be visible
      const sessionItem1 = page.locator(`#session-${session1Id}`);
      await expect(sessionItem1).toBeVisible({ timeout: 15000 });

      // The multi-config indicator is a Combine icon rendered inside the name
      // heading; it only appears for sessions in a configuration group.
      const nameArea = sessionItem1.locator("h3").first();
      await expect(nameArea).toBeVisible({ timeout: 5000 });
      await expect(nameArea.locator("svg.lucide-combine")).toHaveCount(1);
    });

    // Cleanup
    await api.deleteSession(session1Id!);
    await api.deleteSession(session2Id!);
  });

  test("should NOT show multi-config indicator for single sessions", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let sessionId: number | undefined;

    await test.step("Create a project and a single-config session", async () => {
      const projectId = await api.createProject(`E2E ItemSingle ${ts}`);
      const configId = await api.createConfiguration(`Single ${ts}`, projectId);
      sessionId = await api.createSession(projectId, `Single Session ${ts}`, {
        configId,
      });

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Verify the combine indicator is absent from the name heading", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });

      // A single-config session does not belong to a configuration group, so the
      // multi-config Combine indicator must not appear in the name heading.
      // (The heading may still contain a compass icon, a link icon, and a
      // "recently created" flame, so assert on the indicator specifically rather
      // than a raw SVG count.)
      const nameArea = sessionItem.locator("h3").first();
      await expect(nameArea.locator("svg.lucide-combine")).toHaveCount(0);
    });

    // Cleanup
    await api.deleteSession(sessionId!);
  });

  test("should show duplicate option in context menu for active sessions", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let sessionId: number | undefined;

    await test.step("Create a project and session, then open the sessions list", async () => {
      const projectId = await api.createProject(`E2E ItemDupMenu ${ts}`);
      sessionId = await api.createSession(projectId, `Menu Session ${ts}`);

      await page.goto(`/en-US/projects/sessions/${projectId}`);
      await page.waitForLoadState("load");
    });

    await test.step("Open the session three-dot menu", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });

      // Open the three-dot menu
      const moreButton = sessionItem.locator("button:has(svg)").last();
      await moreButton.click();
    });

    await test.step("Verify the Duplicate option is visible in the menu", async () => {
      // Duplicate option should be visible
      const duplicateItem = page.getByTestId(`session-duplicate-${sessionId}`);
      await expect(duplicateItem).toBeVisible({ timeout: 5000 });
      await expect(duplicateItem).toContainText("Duplicate", { timeout: 3000 });
    });

    // Cleanup
    await api.deleteSession(sessionId!);
  });
});
