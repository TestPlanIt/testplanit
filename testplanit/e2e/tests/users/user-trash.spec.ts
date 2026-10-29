import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../fixtures";
import {
  sameOriginRequestHeaders,
  signInSecondaryContext,
} from "../../utils/secondary-context-login";

/**
 * User Trash (profile > Trash): a user sees the items they deleted inside the
 * self-service restore window and restores them without an admin. The window
 * is a system setting (`user_trash_restore_window_days`, 0 = off) that binds
 * users but never Admin > Trash.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const WINDOW_KEY = "user_trash_restore_window_days";

async function setWindowDays(
  request: APIRequestContext,
  baseURL: string,
  days: number | null
) {
  if (days === null) {
    await request
      .delete(`${baseURL}/api/model/appConfig/delete`, {
        data: { where: { key: WINDOW_KEY } },
      })
      .catch(() => {});
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

async function completeOnboarding(
  request: APIRequestContext,
  baseURL: string,
  userId: string
) {
  await request
    .patch(`${baseURL}/api/model/userPreferences/update`, {
      data: {
        where: { userId },
        data: { hasCompletedInitialPreferencesSetup: true },
      },
    })
    .catch(() => {});
}

// Serial: the window test flips the system-wide restore setting, which would
// otherwise race the other tests' reads of the same profile section.
test.describe.configure({ mode: "serial" });

test.describe("User trash", () => {
  test("lists what I deleted by name and restores it with its steps", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const tag = uid();
    const projectId = await api.createProject(`Trash Project ${tag}`);
    const folderId = await api.createFolder(projectId, `Trash Folder ${tag}`);
    const caseName = `Trash Case ${tag}`;
    const caseId = await api.createTestCase(projectId, folderId, caseName);
    const me = await api.getCurrentUserId();

    await test.step("Soft-delete the case and one of its steps", async () => {
      const step = await request.post(`${baseURL}/api/model/steps/create`, {
        data: { data: { testCase: { connect: { id: caseId } }, order: 0 } },
      });
      expect(step.ok()).toBeTruthy();
      const stepId = (await step.json()).data.id as number;
      for (const [model, id] of [
        ["steps", stepId],
        ["repositoryCases", caseId],
      ] as const) {
        const res = await request.patch(
          `${baseURL}/api/model/${model}/update`,
          { data: { where: { id }, data: { isDeleted: true } } }
        );
        expect(res.ok()).toBeTruthy();
      }
    });

    await test.step("It appears in my profile's Trash under its name, not its id", async () => {
      await page.goto(`/en-US/users/profile/${me}`);
      await page.getByTestId("profile-trash-trigger").click();
      const row = page.getByTestId(`user-trash-row-${caseId}`);
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row).toContainText(caseName);
      await expect(row).toContainText(`Trash Project ${tag}`);
      await expect(row).toContainText(`Trash Folder ${tag}`);
      await expect(row).toContainText(/day/);
    });

    await test.step("Restore it and confirm", async () => {
      await page
        .getByTestId(`user-trash-restore-RepositoryCases:${caseId}`)
        .click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toBeVisible({ timeout: 10000 });
      await alert.getByTestId("user-trash-confirm-restore").click();
      await expect(alert).toBeHidden({ timeout: 15000 });
      await expect(page.getByTestId(`user-trash-row-${caseId}`)).toBeHidden({
        timeout: 15000,
      });
    });

    await test.step("The case and its step are live again", async () => {
      const res = await request.get(
        `${baseURL}/api/model/repositoryCases/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: caseId },
              select: {
                isDeleted: true,
                steps: { where: { isDeleted: true }, select: { id: true } },
              },
            }),
          },
        }
      );
      const data = (await res.json()).data;
      expect(data.isDeleted).toBe(false);
      expect(data.steps).toEqual([]);
    });
  });

  test("restores a folder deleted from the repository under its original name, cases included", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const tag = uid();
    const projectId = await api.createProject(`Trash Project ${tag}`);
    const folderName = `Trash Folder ${tag}`;
    const folderId = await api.createFolder(projectId, folderName);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Trash Case ${tag}`
    );
    const me = await api.getCurrentUserId();

    await test.step("Delete the folder the way the repository does", async () => {
      // The subtree route renames the folder to `<name>_deleted_<ts>` so the
      // name frees up under the folder unique index.
      const res = await request.post(
        `${baseURL}/api/projects/${projectId}/folders/delete-subtree`,
        { data: { folderId } }
      );
      expect(res.ok()).toBeTruthy();
      expect(await res.json()).toEqual({ deletedFolders: 1, deletedCases: 1 });
    });

    await test.step("The Trash shows the original name and hides the case inside", async () => {
      await page.goto(`/en-US/users/profile/${me}`);
      await page.getByTestId("profile-trash-trigger").click();
      const row = page.getByTestId(`user-trash-row-${folderId}`);
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row).toContainText(folderName);
      await expect(row).not.toContainText("_deleted_");
      // The case comes back with its folder, so it is not a row of its own.
      await expect(page.getByTestId(`user-trash-row-${caseId}`)).toHaveCount(0);
    });

    await test.step("Restore it", async () => {
      await page
        .getByTestId(`user-trash-restore-RepositoryFolders:${folderId}`)
        .click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toBeVisible({ timeout: 10000 });
      await alert.getByTestId("user-trash-confirm-restore").click();
      await expect(alert).toBeHidden({ timeout: 15000 });
      await expect(page.getByTestId(`user-trash-row-${folderId}`)).toBeHidden({
        timeout: 15000,
      });
    });

    await test.step("The folder has its original name back and the case is live", async () => {
      const res = await request.get(
        `${baseURL}/api/model/repositoryFolders/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { id: folderId },
              select: {
                name: true,
                isDeleted: true,
                cases: {
                  where: { id: caseId },
                  select: { isDeleted: true },
                },
              },
            }),
          },
        }
      );
      const data = (await res.json()).data;
      expect(data).toMatchObject({ name: folderName, isDeleted: false });
      expect(data.cases).toEqual([{ isDeleted: false }]);
    });
  });

  test("restores several items at once", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const tag = uid();
    const projectId = await api.createProject(`Trash Project ${tag}`);
    const folderId = await api.createFolder(projectId, `Trash Folder ${tag}`);
    const caseIds = [
      await api.createTestCase(projectId, folderId, `Trash Bulk A ${tag}`),
      await api.createTestCase(projectId, folderId, `Trash Bulk B ${tag}`),
    ];
    const me = await api.getCurrentUserId();
    for (const id of caseIds) {
      const res = await request.patch(
        `${baseURL}/api/model/repositoryCases/update`,
        { data: { where: { id }, data: { isDeleted: true } } }
      );
      expect(res.ok()).toBeTruthy();
    }

    await test.step("Select both and restore them together", async () => {
      await page.goto(`/en-US/users/profile/${me}`);
      await page.getByTestId("profile-trash-trigger").click();
      for (const id of caseIds) {
        await expect(page.getByTestId(`user-trash-row-${id}`)).toBeVisible({
          timeout: 15000,
        });
      }
      // Narrow to this test's rows before select-all; serial mode keeps the
      // other tests' leftovers out, the filter keeps the assertion honest.
      await page.getByTestId("user-trash-search").fill(`Trash Bulk`);
      for (const id of caseIds) {
        await expect(page.getByTestId(`user-trash-row-${id}`)).toBeVisible();
      }
      await page.getByTestId("user-trash-select-all").click();
      const bulk = page.getByTestId("user-trash-restore-selected");
      await expect(bulk).toHaveText("Restore (2)");
      await bulk.click();
      const alert = page.getByRole("alertdialog");
      await expect(alert).toBeVisible({ timeout: 10000 });
      await alert.getByTestId("user-trash-confirm-restore").click();
      await expect(alert).toBeHidden({ timeout: 15000 });
      for (const id of caseIds) {
        await expect(page.getByTestId(`user-trash-row-${id}`)).toBeHidden({
          timeout: 15000,
        });
      }
    });

    await test.step("Both cases are live again", async () => {
      const res = await request.get(
        `${baseURL}/api/model/repositoryCases/findMany`,
        {
          params: {
            q: JSON.stringify({
              where: { id: { in: caseIds } },
              select: { id: true, isDeleted: true },
            }),
          },
        }
      );
      const data = (await res.json()).data as Array<{ isDeleted: boolean }>;
      expect(data).toHaveLength(2);
      expect(data.every((row) => row.isDeleted === false)).toBe(true);
    });
  });

  test("other users' deletes stay out of my Trash and off limits to the API", async ({
    api,
    browser,
    request,
    baseURL,
  }) => {
    const tag = uid();
    const password = "Password123!";
    const projectId = await api.createProject(`Trash Other ${tag}`);
    const folderId = await api.createFolder(projectId, `F ${tag}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Admin's case ${tag}`
    );
    await api.deleteTestCase(caseId);

    const viewer = await api.createUser({
      name: `Trash Viewer ${tag}`,
      email: `trash-viewer-${tag}@testplanit.com`,
      password,
    });
    await completeOnboarding(request, baseURL!, viewer.data.id);

    const context = await signInSecondaryContext(
      browser,
      baseURL!,
      viewer.data.email,
      password
    );
    try {
      const viewerPage = await context.newPage();
      await viewerPage.goto(`${baseURL}/en-US/users/profile/${viewer.data.id}`);
      await viewerPage.getByTestId("profile-trash-trigger").click();
      await expect(viewerPage.getByTestId("user-trash-empty")).toBeVisible({
        timeout: 15000,
      });

      // context.request calls only authenticate when they look same-origin
      // to the proxy (see secondary-context-login.ts).
      const headers = sameOriginRequestHeaders();
      const listed = await context.request.get(`${baseURL}/api/trash`, {
        headers,
      });
      expect(listed.ok()).toBeTruthy();
      expect((await listed.json()).items).toEqual([]);

      const peek = await context.request.get(
        `${baseURL}/api/trash?userId=${await api.getCurrentUserId()}`,
        { headers }
      );
      expect(peek.status()).toBe(403);

      const restore = await context.request.patch(
        `${baseURL}/api/trash/RepositoryCases/${caseId}`,
        { headers }
      );
      expect(restore.status()).toBe(403);
      expect((await restore.json()).code).toBe("not_owner");
    } finally {
      await context.close();
    }
  });

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
        await expect(
          page.getByTestId(`trash-RepositoryCases-row-${caseId}`)
        ).toBeVisible({ timeout: 15000 });
      });

      await test.step("Setting it back to 30 from the admin row re-enables the Trash", async () => {
        await page.getByTestId("user-trash-window-input").fill("30");
        await page.getByTestId("user-trash-window-save").click();
        await page.goto(`/en-US/users/profile/${me}`);
        await page.getByTestId("profile-trash-trigger").click();
        await expect(page.getByTestId(`user-trash-row-${caseId}`)).toBeVisible({
          timeout: 15000,
        });
      });
    } finally {
      await setWindowDays(request, baseURL!, null);
    }
  });
});
