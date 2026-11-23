import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures";

/**
 * The self-service restore window (`user_trash_restore_window_days`, 0 = off)
 * is a setting for the whole install: while it is 0 nobody's profile Trash
 * works. This spec is in the instance-settings project, so it runs after the
 * parallel suite instead of beside the other Trash specs.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const WINDOW_KEY = "user_trash_restore_window_days";

async function setWindowDays(
  request: APIRequestContext,
  baseURL: string,
  days: number | null
) {
  if (days === null) {
    // The model route reads DELETE args from `q`, not the body — a body-only
    // call fails and would leave the window at whatever the test set.
    const res = await request.delete(`${baseURL}/api/model/appConfig/delete`, {
      params: { q: JSON.stringify({ where: { key: WINDOW_KEY } }) },
    });
    expect(res.ok() || res.status() === 404).toBeTruthy();
    return;
  }
  const res = await request.post(`${baseURL}/api/model/appConfig/upsert`, {
    data: {
      where: { key: WINDOW_KEY },
      create: { key: WINDOW_KEY, value: days },
      update: { value: days },
    },
  });
  expect(res.ok()).toBeTruthy();
}

test.describe("User trash restore window", () => {
  test("a window of 0 turns self-service restore off, admins are unaffected", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const tag = uid();
    const projectId = await api.createProject(`Trash Window ${tag}`);
    const folderId = await api.createFolder(projectId, `F ${tag}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Windowed ${tag}`
    );
    await api.deleteTestCase(caseId);
    const me = await api.getCurrentUserId();

    await setWindowDays(request, baseURL!, 0);
    try {
      await test.step("The profile Trash reports it is off", async () => {
        await page.goto(`/en-US/users/profile/${me}`);
        await page.getByTestId("profile-trash-trigger").click();
        await expect(page.getByTestId("user-trash-disabled")).toBeVisible({
          timeout: 15000,
        });
      });

      await test.step("Admin > Trash still shows the setting and the item", async () => {
        await page.goto("/en-US/admin/trash");
        await expect(page.getByTestId("user-trash-window-input")).toHaveValue(
          "0"
        );
        // The rail button's accessible name carries its count badge once the
        // counts load ("Repository Cases 1"), so match the label as a prefix.
        await page.getByRole("button", { name: /^Repository Cases/ }).click();
        // Under a full suite run this type holds hundreds of rows, so narrow
        // the table to ours rather than expecting it on the first page.
        await page.getByTestId("trash-item-filter").fill(`Windowed ${tag}`);
        await expect(
          page.getByTestId(`trash-RepositoryCases-row-${caseId}`)
        ).toBeVisible({ timeout: 15000 });
      });

      await test.step("Setting it back to 30 from the admin row re-enables the Trash", async () => {
        await page.getByTestId("user-trash-window-input").fill("30");
        // Loading another page right away aborts the unfinished save in
        // Safari, so let it land first.
        const saved = page.waitForResponse(
          (response) =>
            response.url().includes("/api/model/appConfig/upsert") &&
            response.request().method() !== "GET"
        );
        await page.getByTestId("user-trash-window-save").click();
        expect((await saved).ok()).toBe(true);
        await page.goto(`/en-US/users/profile/${me}`);
        // A click that lands before the section is interactive is lost in
        // Firefox and WebKit, so open it until the row shows.
        const row = page.getByTestId(`user-trash-row-${caseId}`);
        await expect(async () => {
          if (!(await row.isVisible())) {
            await page.getByTestId("profile-trash-trigger").click();
          }
          await expect(row).toBeVisible({ timeout: 4000 });
        }).toPass({ timeout: 30000 });
      });
    } finally {
      await setWindowDays(request, baseURL!, null);
    }
  });
});
