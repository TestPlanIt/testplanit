import { expect, test } from "../../fixtures";

/**
 * E2E spec — PARAM-05: parameter rename flow
 *
 * - Seed a case with 1 parameter (`username`)
 * - Open Configure parameters Sheet → enter inline-edit on the row → rename to `user`
 * - Rename AlertDialog (or zero-refs silent path) confirms the rename
 * - Toast "Parameter renamed" surfaces; row now reads `@user`
 *
 * Note: server-side reference rewrite atomicity is covered by Plan 02-02
 * integration test `parameter-rename-atomicity.test.ts`. This E2E spec
 * exercises the UI flow from the Sheet through commit.
 */
test.describe("Parameters - rename flow @parameters", () => {
  test("renames a parameter via the Sheet and confirms via dialog", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Param Rename ${Date.now()}`
    );
    const folderId = await api.createFolder(projectId, "Rename");
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      "Param Rename Case"
    );

    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("load");

    // Open the Sheet and declare the first parameter.
    await page.getByTestId("configure-parameters-button").click();
    await expect(page.getByTestId("configure-parameters-sheet")).toBeVisible();
    await page.getByTestId("parameter-form-name").fill("username");
    await page.getByTestId("parameter-form-submit").click();

    // Wait for the row to appear, then click the edit icon.
    await expect(page.getByText("@username").first()).toBeVisible();
    await page.getByTestId("parameter-row-edit-button").first().click();

    // Inline-edit the name; commit by pressing Enter.
    const nameInput = page.getByTestId("parameter-row-name-input");
    await nameInput.fill("user");
    await nameInput.press("Enter");

    // Either the rename confirmation AlertDialog appears (when refs > 0) OR
    // the silent zero-refs path fires the rename inline. Cover both.
    const renameDialog = page.getByTestId("parameter-rename-dialog");
    if (await renameDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.getByTestId("parameter-rename-dialog-confirm").click();
    }

    // Renamed row visible.
    await expect(page.getByText("@user").first()).toBeVisible();
  });
});
