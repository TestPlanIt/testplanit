import { expect, test } from "../../fixtures";

/**
 * A result recorded by someone else refreshes the run page through its live
 * stream. While the run is being edited, that refresh must leave the typed
 * name alone.
 *
 * The shared `page` fixture stubs every SSE stream; this spec puts the run
 * stream back, since the refresh under test arrives through it.
 */

/** Must match the pattern fixtures/index.ts registers. */
const RUN_STREAM = /\/api\/test-runs\/[^/]+\/stream/;

test.describe("Test run edit and live refresh", () => {
  test("a result recorded during an edit keeps the typed name", async ({
    page,
    api,
  }) => {
    const label = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runName = `Live edit run ${label}`;
    const typedName = `Renamed while live ${label}`;
    let runId: number | undefined;
    let runCaseId: number | undefined;

    await test.step("Create a run with one case", async () => {
      const projectId = await api.createProject(`Live edit ${label}`);
      const folderId = await api.getRootFolderId(projectId);
      const caseId = await api.createTestCase(
        projectId,
        folderId,
        `Live edit case ${label}`
      );
      runId = await api.createTestRun(projectId, runName);
      runCaseId = await api.addTestCaseToTestRun(runId, caseId);

      await page.unroute(RUN_STREAM);
      const streamConnected = page.waitForRequest(
        (request) => RUN_STREAM.test(request.url()),
        { timeout: 30_000 }
      );
      await page.goto(`/en-US/projects/runs/${projectId}/${runId}?edit=true`);
      await streamConnected;
    });

    const nameField = page.locator('textarea[name="name"]');

    await test.step("Type a new name without saving", async () => {
      await expect(nameField).toHaveValue(runName, { timeout: 30_000 });
      await nameField.fill(typedName);
      await expect(nameField).toHaveValue(typedName);
    });

    await test.step("Record a result from outside the page and wait for the run to refresh", async () => {
      const runRefetched = page.waitForResponse(
        (response) =>
          response.url().includes("/api/model/testRuns/findUnique") &&
          response.ok(),
        { timeout: 30_000 }
      );
      await api.createTestResult(
        runId!,
        runCaseId!,
        await api.getStatusId("passed")
      );
      await (await runRefetched).finished();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
    });

    await test.step("The typed name is still in the field", async () => {
      await expect(nameField).toHaveValue(typedName);
    });
  });
});
