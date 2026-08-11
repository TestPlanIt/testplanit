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

    await test.step("Verify the config column is empty", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });

      // A session with no configuration renders an empty configuration cell
      // (no Combine icon / config name; the old dash placeholder is gone).
      await expect(sessionItem.locator("svg.lucide-combine")).toHaveCount(0);
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

    await test.step("Verify the multi-config combine indicator appears beside the name", async () => {
      // Both session items should be visible
      const sessionItem1 = page.locator(`#session-${session1Id}`);
      await expect(sessionItem1).toBeVisible({ timeout: 15000 });

      // The multi-config indicator is an ItemRow *adornment*, which renders
      // outside the name <h3> by design, so target it by test id. A session
      // with a configuration also renders a Combine glyph in its identity
      // chip — the test id is what tells the two apart.
      await expect(
        sessionItem1.getByTestId(`session-multi-config-${session1Id}`)
      ).toBeVisible({ timeout: 5000 });
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

    await test.step("Verify the multi-config indicator is absent", async () => {
      const sessionItem = page.locator(`#session-${sessionId}`);
      await expect(sessionItem).toBeVisible({ timeout: 15000 });

      // A single-config session does not belong to a configuration group, so
      // the multi-config adornment must not render. Scoping to the adornment's
      // test id rather than the <h3> subtree keeps this meaningful: the h3
      // never contains the glyph either way, so the old assertion passed even
      // when the indicator was broken.
      await expect(
        sessionItem.getByTestId(`session-multi-config-${sessionId}`)
      ).toHaveCount(0);
      // No liveness anchor is needed here: the positive test above asserts the
      // same test id IS visible for a grouped session, so a dead selector
      // would fail there rather than passing silently in both places.
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
