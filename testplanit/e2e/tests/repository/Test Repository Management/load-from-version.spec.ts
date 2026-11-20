import { randomUUID } from "crypto";
import { expect, test } from "../../../fixtures";

/**
 * Load values from version
 *
 * The test case edit form can be filled with the content of an earlier
 * version. Nothing is written until the user saves, and saving creates a new
 * version on top of the history.
 */
test.describe("Load values from an earlier version", () => {
  test("loads version 1 into the edit form, asks before replacing edits, and saves a new version", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const uid = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const originalName = `Original case ${uid}`;
    const renamedName = `Renamed case ${uid}`;
    const projectId = await api.createProject(`E2E Load Version ${uid}`);
    const folderId = await api.createFolder(projectId, `Versions ${uid}`);
    const caseId = await api.createTestCase(projectId, folderId, originalName);
    // Version 2: the case as it is now.
    await api.updateTestCaseName(caseId, renamedName);

    const nameInput = page.locator('textarea[name="name"]');
    const loadButton = page.getByTestId("load-from-version-button");
    const notice = page.getByTestId("loaded-from-version-alert");
    const confirmDialog = page.getByTestId("load-from-version-confirm");
    const versionOne = page.getByTestId("load-from-version-1");
    // The menu stays in the page while it animates shut, and a click on its
    // button during that time counts as a click outside it. Open it only once
    // the previous one is gone.
    const openMenu = async () => {
      await expect(versionOne).toHaveCount(0);
      await loadButton.click();
      await expect(versionOne).toBeVisible();
    };

    await test.step("Open the case for editing", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("networkidle");
      await page.getByTestId("edit-test-case-button").first().click();
      await expect(nameInput).toHaveValue(renamedName, { timeout: 15000 });
    });

    await test.step("The menu lists every version but the current one", async () => {
      await openMenu();
      await expect(page.getByTestId("load-from-version-2")).toHaveCount(0);
    });

    await test.step("Loading with no edits fills the form without asking", async () => {
      await versionOne.click();
      await expect(nameInput).toHaveValue(originalName, { timeout: 10000 });
      await expect(confirmDialog).toHaveCount(0);
      await expect(notice).toContainText("version 1");
    });

    await test.step("After an edit, loading asks first and Cancel keeps the edit", async () => {
      await nameInput.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Scratch edit");
      await expect(nameInput).toHaveValue("Scratch edit");

      await openMenu();
      await versionOne.click();
      await expect(confirmDialog).toBeVisible();
      await page.getByTestId("load-from-version-cancel").click();
      await expect(confirmDialog).toBeHidden();
      await expect(nameInput).toHaveValue("Scratch edit");
    });

    await test.step("Confirming replaces the edit with the version's values", async () => {
      await openMenu();
      await versionOne.click();
      await page.getByTestId("load-from-version-confirm-action").click();
      await expect(nameInput).toHaveValue(originalName, { timeout: 10000 });
    });

    await test.step("Saving creates version 3 with version 1's content", async () => {
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(nameInput).toBeHidden({ timeout: 20000 });
      await expect(notice).toHaveCount(0);

      const found = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId },
              select: { name: true, currentVersion: true, folderId: true },
            }),
          },
        }
      );
      expect(found.ok()).toBeTruthy();
      expect((await found.json()).data).toEqual({
        name: originalName,
        currentVersion: 3,
        folderId,
      });

      const versions = await request.get(
        `${baseURL}/api/model/repositoryCaseVersions/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { repositoryCaseId: caseId },
              orderBy: { version: "asc" },
              select: { version: true, name: true },
            }),
          },
        }
      );
      expect(versions.ok()).toBeTruthy();
      expect((await versions.json()).data).toEqual([
        { version: 1, name: originalName },
        { version: 2, name: renamedName },
        { version: 3, name: originalName },
      ]);
    });
  });
});
