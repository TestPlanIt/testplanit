import type { Locator } from "@playwright/test";
import { expect, test } from "../../fixtures";

/**
 * Automatically tracked execution time
 *
 * Opening a case in a test run starts a clock for it without the tester
 * pressing anything. The Add Result dialog shows the same clock, still
 * running, and the tracked time is saved as the result's elapsed time by the
 * dialog and by Pass & Next alike.
 */

/** Whole seconds shown on a time tracker. */
async function shownSeconds(tracker: Locator): Promise<number> {
  const minutes = await tracker
    .getByTestId("time-tracker-minutes")
    .inputValue();
  const seconds = await tracker
    .getByTestId("time-tracker-seconds")
    .inputValue();
  return Number(minutes) * 60 + Number(seconds);
}

test.describe("Execution time tracking", () => {
  test("times an open case and saves the time from the Add Result dialog", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const sheet = page.locator(".test-run-details-sheet");
    const sheetTracker = sheet
      .getByTestId("case-result-bar")
      .getByTestId("time-tracker");
    let projectId: number | undefined;
    let runId: number | undefined;
    let caseId: number | undefined;

    await test.step("Seed a project, case and run", async () => {
      projectId = await api.createProject(`E2E Timer Dialog ${ts}`);
      const folderId = await api.createFolder(projectId, `Timer Folder ${ts}`);
      caseId = await api.createTestCase(
        projectId,
        folderId,
        `Timer Case ${ts}`
      );
      runId = await api.createTestRun(projectId, `Timer Run ${ts}`);
      await api.addTestCaseToTestRun(runId, caseId);
    });

    await test.step("Open the case: its clock is already running", async () => {
      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${caseId}`
      );
      await expect(sheet).toBeVisible({ timeout: 15000 });
      await expect(sheetTracker).toHaveAttribute("data-running", "true", {
        timeout: 15000,
      });
      await expect
        .poll(() => shownSeconds(sheetTracker), { timeout: 15000 })
        .toBeGreaterThanOrEqual(2);
    });

    await test.step("Add Result shows the tracked time, still counting", async () => {
      await sheet.getByRole("button", { name: "Add Result" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId("elapsed-input")).toBeVisible({
        timeout: 15000,
      });

      const dialogTracker = dialog.getByTestId("time-tracker");
      await expect(dialogTracker).toHaveAttribute("data-running", "true");
      expect(await shownSeconds(dialogTracker)).toBeGreaterThanOrEqual(2);
      await expect(dialog.getByTestId("elapsed-input")).toHaveValue(/second/);
    });

    await test.step("Saving the result stores the tracked seconds", async () => {
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog.getByTestId("elapsed-input")).toBeHidden({
        timeout: 20000,
      });

      await expect
        .poll(async () => (await api.getTestRunResults(runId!)).length, {
          timeout: 15000,
        })
        .toBe(1);
      const [result] = await api.getTestRunResults(runId!);
      expect(result.elapsed).toBeGreaterThanOrEqual(2);
      expect(result.elapsed).toBeLessThan(120);
    });
  });

  test("saves the tracked time with Pass & Next and starts the next case from zero", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const sheet = page.locator(".test-run-details-sheet");
    const sheetTracker = sheet
      .getByTestId("case-result-bar")
      .getByTestId("time-tracker");
    let projectId: number | undefined;
    let runId: number | undefined;
    let case1Id: number | undefined;
    let case2Id: number | undefined;
    let runCase1Id: number | undefined;

    await test.step("Seed a project, two cases and a run", async () => {
      projectId = await api.createProject(`E2E Timer Pass ${ts}`);
      const folderId = await api.createFolder(projectId, `Timer Folder ${ts}`);
      case1Id = await api.createTestCase(
        projectId,
        folderId,
        `Timer Case 1 ${ts}`
      );
      case2Id = await api.createTestCase(
        projectId,
        folderId,
        `Timer Case 2 ${ts}`
      );
      runId = await api.createTestRun(projectId, `Timer Pass Run ${ts}`);
      runCase1Id = await api.addTestCaseToTestRun(runId, case1Id);
      await api.addTestCaseToTestRun(runId, case2Id, { order: 1 });
    });

    await test.step("Open the first case and let its clock run", async () => {
      await page.goto(
        `/en-US/projects/runs/${projectId}/${runId}?selectedCase=${case1Id}`
      );
      await expect(sheet).toBeVisible({ timeout: 15000 });
      await expect(sheetTracker).toHaveAttribute("data-running", "true", {
        timeout: 15000,
      });
      await expect
        .poll(() => shownSeconds(sheetTracker), { timeout: 15000 })
        .toBeGreaterThanOrEqual(3);
    });

    await test.step("Pass & Next records the result with its time", async () => {
      await sheet.getByRole("button", { name: "Pass & Next" }).click();

      await expect
        .poll(async () => (await api.getTestRunResults(runId!)).length, {
          timeout: 20000,
        })
        .toBe(1);
      const [result] = await api.getTestRunResults(runId!);
      expect(result.testRunCaseId).toBe(runCase1Id);
      expect(result.elapsed).toBeGreaterThanOrEqual(3);
      expect(result.elapsed).toBeLessThan(120);
    });

    await test.step("The next case opens with its own clock near zero", async () => {
      await expect(page).toHaveURL(new RegExp(`selectedCase=${case2Id}`), {
        timeout: 15000,
      });
      await expect(sheetTracker).toHaveAttribute("data-running", "true", {
        timeout: 15000,
      });
      expect(await shownSeconds(sheetTracker)).toBeLessThan(3);
    });
  });
});
