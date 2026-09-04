import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * Bulk actions on the sessions list: select rows, then complete, edit the
 * state, or delete them through the bulk bar dialogs.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function selectSessions(page: Page, ids: number[]) {
  for (const id of ids) {
    const box = page.getByTestId(`session-select-${id}`);
    await expect(box).toBeVisible({ timeout: 15000 });
    await box.click();
  }
  await expect(page.getByTestId("session-bulk-bar")).toBeVisible({
    timeout: 10000,
  });
}

async function sessionField<T>(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
  id: number,
  select: Record<string, boolean>
): Promise<T> {
  const res = await request.get(`${baseURL}/api/model/sessions/findFirst`, {
    params: { q: JSON.stringify({ where: { id }, select }) },
  });
  return (await res.json()).data as T;
}

test.describe("Session bulk actions", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Session Bulk ${uid()}`);
  });

  test("completes several sessions at once", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const a = await api.createSession(projectId, `Bulk complete A ${ts}`);
    const b = await api.createSession(projectId, `Bulk complete B ${ts}`);
    const open = await api.createSession(projectId, `Stays open ${ts}`);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await selectSessions(page, [a, b]);
    await page.getByTestId("session-bulk-complete").click();
    await expect(
      page.getByTestId("bulk-complete-sessions-confirm")
    ).toBeVisible({ timeout: 10000 });
    await page.getByTestId("bulk-complete-sessions-confirm").click();
    await expect(page.getByTestId("session-bulk-bar")).toBeHidden({
      timeout: 15000,
    });

    for (const id of [a, b]) {
      await expect
        .poll(
          async () =>
            (
              await sessionField<{ isCompleted: boolean }>(
                request,
                baseURL!,
                id,
                { isCompleted: true }
              )
            )?.isCompleted,
          { timeout: 15000 }
        )
        .toBe(true);
    }
    expect(
      (
        await sessionField<{ isCompleted: boolean }>(request, baseURL!, open, {
          isCompleted: true,
        })
      ).isCompleted
    ).toBe(false);
  });

  test("bulk-edits the state of selected sessions", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const a = await api.createSession(projectId, `Bulk state A ${ts}`);
    const b = await api.createSession(projectId, `Bulk state B ${ts}`);
    const before = (
      await sessionField<{ stateId: number }>(request, baseURL!, a, {
        stateId: true,
      })
    ).stateId;

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await selectSessions(page, [a, b]);
    await page.getByTestId("session-bulk-edit").click();
    await page.getByTestId("bulk-edit-sessions-apply-state").click();
    await page.getByTestId("bulk-edit-sessions-state-trigger").click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 10000 });
    await options.last().click();
    await page.getByTestId("bulk-edit-sessions-apply").click();
    await expect(page.getByTestId("session-bulk-bar")).toBeHidden({
      timeout: 15000,
    });

    await expect
      .poll(
        async () =>
          (
            await sessionField<{ stateId: number }>(request, baseURL!, a, {
              stateId: true,
            })
          )?.stateId,
        { timeout: 15000 }
      )
      .not.toBe(before);
    const rowA = await sessionField<{ stateId: number }>(request, baseURL!, a, {
      stateId: true,
    });
    const rowB = await sessionField<{ stateId: number }>(request, baseURL!, b, {
      stateId: true,
    });
    expect(rowB.stateId).toBe(rowA.stateId);
  });

  test("bulk-deletes selected sessions (soft delete)", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const gone = await api.createSession(projectId, `Bulk delete ${ts}`);
    const keep = await api.createSession(projectId, `Kept session ${ts}`);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await selectSessions(page, [gone]);
    await page.getByTestId("session-bulk-delete").click();
    await expect(page.getByTestId("bulk-delete-sessions-confirm")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("bulk-delete-sessions-confirm").click();
    await expect(page.getByTestId(`session-select-${gone}`)).toBeHidden({
      timeout: 15000,
    });
    await expect(page.getByTestId(`session-select-${keep}`)).toBeVisible();
    const row = await sessionField<{ isDeleted: boolean }>(
      request,
      baseURL!,
      gone,
      {
        isDeleted: true,
      }
    );
    expect(row.isDeleted).toBe(true);
  });
});
