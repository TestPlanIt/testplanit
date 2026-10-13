import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * Bulk actions on the test runs list: select rows, then complete, edit the
 * state, or delete them through the bulk bar dialogs.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function selectRuns(page: Page, ids: number[]) {
  for (const id of ids) {
    const box = page.getByTestId(`testrun-select-${id}`);
    await expect(box).toBeVisible({ timeout: 15000 });
    await box.click();
  }
  await expect(page.getByTestId("testrun-bulk-bar")).toBeVisible({
    timeout: 10000,
  });
}

async function runField<T>(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
  id: number,
  select: Record<string, boolean>
): Promise<T> {
  const res = await request.get(`${baseURL}/api/model/testRuns/findFirst`, {
    params: { q: JSON.stringify({ where: { id }, select }) },
  });
  return (await res.json()).data as T;
}

test.describe("Test run bulk actions", () => {
  let projectId: number;

  test.beforeEach(async ({ api }) => {
    projectId = await api.createProject(`E2E Run Bulk ${uid()}`);
  });

  test("completes several runs at once", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const runA = await api.createTestRun(projectId, `Bulk complete A ${ts}`);
    const runB = await api.createTestRun(projectId, `Bulk complete B ${ts}`);
    const runC = await api.createTestRun(projectId, `Stays open ${ts}`);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await selectRuns(page, [runA, runB]);
    await page.getByTestId("testrun-bulk-complete").click();
    await expect(page.getByTestId("bulk-complete-runs-confirm")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("bulk-complete-runs-confirm").click();
    await expect(page.getByTestId("testrun-bulk-bar")).toBeHidden({
      timeout: 15000,
    });

    for (const id of [runA, runB]) {
      await expect
        .poll(
          async () =>
            (
              await runField<{ isCompleted: boolean }>(request, baseURL!, id, {
                isCompleted: true,
              })
            )?.isCompleted,
          { timeout: 15000 }
        )
        .toBe(true);
    }
    expect(
      (
        await runField<{ isCompleted: boolean }>(request, baseURL!, runC, {
          isCompleted: true,
        })
      ).isCompleted
    ).toBe(false);
  });

  test("bulk-edits the state of selected runs", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const runA = await api.createTestRun(projectId, `Bulk state A ${ts}`);
    const runB = await api.createTestRun(projectId, `Bulk state B ${ts}`);
    const before = (
      await runField<{ stateId: number }>(request, baseURL!, runA, {
        stateId: true,
      })
    ).stateId;

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await selectRuns(page, [runA, runB]);
    await page.getByTestId("testrun-bulk-edit").click();
    await page.getByTestId("bulk-edit-runs-apply-state").click();
    await page.getByTestId("bulk-edit-runs-state-trigger").click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 10000 });
    // Pick the last state so the change is observable regardless of the
    // default the runs were created with.
    await options.last().click();
    await page.getByTestId("bulk-edit-runs-apply").click();
    await expect(page.getByTestId("testrun-bulk-bar")).toBeHidden({
      timeout: 15000,
    });

    await expect
      .poll(
        async () =>
          (
            await runField<{ stateId: number }>(request, baseURL!, runA, {
              stateId: true,
            })
          )?.stateId,
        { timeout: 15000 }
      )
      .not.toBe(before);
    const b = await runField<{ stateId: number }>(request, baseURL!, runB, {
      stateId: true,
    });
    const a = await runField<{ stateId: number }>(request, baseURL!, runA, {
      stateId: true,
    });
    expect(b.stateId).toBe(a.stateId);
  });

  test("bulk-deletes selected runs (soft delete)", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = uid();
    const runA = await api.createTestRun(projectId, `Bulk delete A ${ts}`);
    const keep = await api.createTestRun(projectId, `Kept run ${ts}`);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await selectRuns(page, [runA]);
    await page.getByTestId("testrun-bulk-delete").click();
    await expect(page.getByTestId("bulk-delete-runs-confirm")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("bulk-delete-runs-confirm").click();
    await expect(page.getByTestId(`testrun-select-${runA}`)).toBeHidden({
      timeout: 15000,
    });
    await expect(page.getByTestId(`testrun-select-${keep}`)).toBeVisible();

    const row = await runField<{ isDeleted: boolean }>(
      request,
      baseURL!,
      runA,
      {
        isDeleted: true,
      }
    );
    expect(row.isDeleted).toBe(true);
  });
});
