import { expect, test } from "../../fixtures";
import { clickOverflowAction } from "../../utils/action-overflow";

/**
 * Repository export dialog: CSV and PDF exports of the whole project are
 * produced in the browser and offered as downloads.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Repository export dialog", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    const ts = uid();
    projectId = await api.createProject(`E2E Export ${ts}`);
    const folderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, folderId, `Export case one ${ts}`);
    await api.createTestCase(projectId, folderId, `Export case two ${ts}`);
  });

  for (const format of ["csv", "pdf"] as const) {
    test(`exports the project as ${format.toUpperCase()}`, async ({ page }) => {
      await page.goto(`/en-US/projects/repository/${projectId}`);
      await expect(
        page.getByText("Export case one", { exact: false }).first()
      ).toBeVisible({
        timeout: 20000,
      });
      await clickOverflowAction(
        page,
        "export-cases-button",
        "cases-actions-menu"
      );
      await expect(page.getByTestId("export-scope-radio-group")).toBeVisible({
        timeout: 10000,
      });
      await page.getByTestId("export-scope-allProject").click();
      await page.getByTestId(`export-format-${format}`).click();
      if (format === "csv") {
        await page.getByTestId("export-rowMode-multi").click();
      }
      const download = page.waitForEvent("download", { timeout: 30000 });
      await page.getByTestId("export-modal-export-button").click();
      expect((await download).suggestedFilename()).toMatch(
        new RegExp(`\\.${format}$`)
      );
    });
  }
});
