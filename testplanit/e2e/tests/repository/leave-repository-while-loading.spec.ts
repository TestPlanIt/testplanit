import { expect, test } from "../../fixtures";

/**
 * The Repository writes its state into the address while it settles (the first
 * folder, the column set, paging). A write that lands after the person has
 * clicked another menu entry must not keep them on the Repository.
 *
 * The folder list is held back until after the click and the destination is
 * slowed down, so the folder write always falls between the click and the
 * arrival.
 */
test("leaving the Repository before its folders load reaches the next page", async ({
  page,
  baseURL,
  api,
}) => {
  const projectId = await api.createProject(`Leave early ${Date.now()}`);
  try {
    await api.createFolder(projectId, "First folder");

    let releaseFolders: () => void = () => {};
    const foldersReleased = new Promise<void>((resolve) => {
      releaseFolders = resolve;
    });
    await page.route(/\/api\/model\/repositoryFolders\/find/, async (route) => {
      await foldersReleased;
      await route.continue();
    });
    await page.route(/\/projects\/shared-steps\//, async (route) => {
      if (route.request().headers()["rsc"]) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      await route.continue();
    });

    await page.goto(`${baseURL}/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("load");
    const sharedSteps = page.locator("#shared-steps-link");
    await expect(sharedSteps).toBeVisible();
    await expect(page).toHaveURL(/pageSize=/);

    await sharedSteps.click();
    releaseFolders();

    await expect(page).toHaveURL(
      new RegExp(`/projects/shared-steps/${projectId}`),
      { timeout: 20000 }
    );
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(
      new RegExp(`/projects/shared-steps/${projectId}`)
    );
  } finally {
    await api.deleteProject(projectId);
  }
});
