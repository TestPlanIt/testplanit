import { expect, test } from "../../fixtures";

/**
 * Traceability snapshots captured from the requirements workspace header:
 * save one, open it in the Reports page, and delete it again.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Requirement traceability snapshots", () => {
  test("captures, opens and deletes a snapshot", async ({ api, page }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Req Snapshots ${ts}`);
    await api.enableRequirements(projectId);
    const folderId = await api.getRootFolderId(projectId);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Snapshot case ${ts}`
    );
    const requirementId = await api.createRequirement(
      projectId,
      `REQ-${ts}`,
      `Snapshot requirement ${ts}`
    );
    await api.linkIssueToTestCase(requirementId, caseId);
    const snapshotName = `Snapshot ${ts}`;

    const openMenu = async () => {
      await page.getByTestId("requirements-snapshots-trigger").click();
      await expect(page.getByTestId("requirements-snapshots-menu")).toBeVisible(
        {
          timeout: 10000,
        }
      );
    };

    await test.step("Save a snapshot from the header menu", async () => {
      await page.goto(`/en-US/projects/requirements/${projectId}`);
      await expect(
        page.getByTestId(`requirement-row-${requirementId}`)
      ).toBeVisible({ timeout: 15000 });
      await openMenu();
      await page.getByTestId("requirements-snapshots-save").click();
      const dialog = page.getByTestId("requirement-snapshot-save-dialog");
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await dialog.getByTestId("requirement-snapshot-name").fill(snapshotName);
      await dialog.getByTestId("requirement-snapshot-submit").click();
      await expect(dialog).toBeHidden({ timeout: 20000 });
    });

    await test.step("The snapshot is listed and opens in the traceability report", async () => {
      await openMenu();
      const entry = page
        .locator('[data-testid^="requirements-snapshots-open-"]')
        .filter({ hasText: snapshotName })
        .first();
      await expect(entry).toBeVisible({ timeout: 15000 });
      await entry.click();
      await expect(page).toHaveURL(
        new RegExp(
          `/projects/reports/${projectId}\\?(?=.*reportType=requirement-traceability)(?=.*snapshotId=\\d+)`
        ),
        { timeout: 20000 }
      );
      await expect(
        page.getByTestId("requirement-snapshot-trigger")
      ).toBeVisible({
        timeout: 20000,
      });
    });

    await test.step("Delete the snapshot from the menu", async () => {
      await page.goto(`/en-US/projects/requirements/${projectId}`);
      await expect(page.getByTestId("requirements-page-header")).toBeVisible({
        timeout: 15000,
      });
      await openMenu();
      const menu = page.getByTestId("requirements-snapshots-menu");
      const deleteButton = menu
        .locator('[data-testid^="requirements-snapshots-delete-"]')
        .first();
      await expect(deleteButton).toBeVisible({ timeout: 10000 });
      await deleteButton.click();
      const dialog = page.getByTestId("requirements-snapshots-delete-dialog");
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await dialog.getByTestId("requirements-snapshots-delete-confirm").click();
      await expect(dialog).toBeHidden({ timeout: 15000 });
      await expect(
        page
          .locator('[data-testid^="requirements-snapshots-open-"]')
          .filter({ hasText: snapshotName })
      ).toHaveCount(0, { timeout: 15000 });
    });
  });
});
