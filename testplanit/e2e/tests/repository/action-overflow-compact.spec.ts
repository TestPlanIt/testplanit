import { expect, test } from "../../fixtures";
import { clickOverflowAction } from "../../utils/action-overflow";

/**
 * Repository action bars — compact (kebab) mode.
 *
 * Below the 768px container threshold both repository toolbars collapse into
 * kebab menus (components/ui/action-bar.tsx). Every other spec runs wide or
 * adapts via clickOverflowAction; this spec pins the compact rendering itself:
 * the individual action buttons must NOT exist, the kebab triggers must, and
 * actions launched from the menu must still work end to end.
 */
test.describe("Repository action bars — compact mode", () => {
  test("toolbars collapse to kebab menus and actions still launch", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId: number | undefined;
    let folderId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a project with one case", async () => {
      projectId = await api.createProject(`E2E CompactBars ${ts}`);
      folderId = await api.createFolder(projectId, `Compact Folder ${ts}`);
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Compact Case ${ts}`
      );
    });

    await test.step("Open the repository at a narrow viewport", async () => {
      await page.setViewportSize({ width: 900, height: 720 });
      await page.goto(`/en-US/projects/repository/${projectId}`);
      await page.waitForLoadState("networkidle");

      const folderNode = page.getByTestId(`folder-node-${folderId}`).first();
      await expect(folderNode).toBeVisible({ timeout: 15000 });

      // The page's async folder auto-select can override an explicit click
      // that lands first — re-click until the case row sticks.
      await expect(async () => {
        await folderNode.click();
        await expect(
          page.locator(`[data-testid="case-checkbox-${caseId}"]`)
        ).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
    });

    await test.step("Both bars render kebab triggers instead of buttons", async () => {
      await expect(page.getByTestId("repository-actions-menu")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByTestId("cases-actions-menu")).toBeVisible({
        timeout: 10000,
      });
      // Wide-mode buttons must not exist while their menus are closed.
      await expect(page.getByTestId("add-case-button")).toHaveCount(0);
      await expect(page.getByTestId("export-cases-button")).toHaveCount(0);
    });

    await test.step("A selection action launched from the kebab still works", async () => {
      await page.locator(`[data-testid="case-checkbox-${caseId}"]`).click();
      await clickOverflowAction(page, "bulk-edit-button", "cases-actions-menu");
      await expect(
        page.getByRole("dialog", { name: /bulk edit/i })
      ).toBeVisible({ timeout: 10000 });
      await page.keyboard.press("Escape");
    });

    await test.step("A header action launched from the kebab still works", async () => {
      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );
      await expect(page.getByRole("dialog").first()).toBeVisible({
        timeout: 10000,
      });
      await page.keyboard.press("Escape");
    });
  });
});
