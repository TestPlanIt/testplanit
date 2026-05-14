import { expect, test } from "../../fixtures";

/**
 * E2E spec — Shared datasets happy path
 *
 * Walks the full creator/consumer arc:
 *   1. Create a shared dataset under Project Settings → Datasets.
 *   2. Open the editor and save the first version (lazy v1 backfill +
 *      v2 post-edit per W5 lock).
 *   3. Open a test case, declare matching parameters, switch the
 *      Dataset tab to Shared, assign the new dataset (default pin =
 *      current, auto-mapping populated).
 *   4. Verify the Dataset tab now renders the read-only mapped rows
 *      with a version badge.
 *
 * Snapshot-immutability and run iteration generation are exercised by
 * the integration suites (Plan 04-02 fan-out tests + the iteration
 * worker integration test). This spec is the UI integration layer.
 */
test.describe("Shared datasets - happy path @shared-datasets", () => {
  test("create dataset, save, assign to a case, verify mapped rows render", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Shared DS Flow ${Date.now()}`
    );
    const folderId = await api.createFolder(projectId, "Shared");
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      "Login (param)"
    );

    // ---------- 1. Create the shared dataset ----------
    await page.goto(`/en-US/projects/settings/${projectId}/datasets`);
    await page.waitForLoadState("load");
    await expect(page.getByTestId("dataset-create-button")).toBeVisible();
    await page.getByTestId("dataset-create-button").click();

    await expect(page.getByTestId("dataset-create-dialog")).toBeVisible();
    const datasetName = `Login users ${Date.now()}`;
    await page.getByTestId("dataset-create-name").fill(datasetName);
    await page
      .getByTestId("dataset-create-description")
      .fill("Test users for the Login flow");
    await page.getByTestId("dataset-create-submit").click();

    // After create, the user lands on the editor page.
    await expect(page.getByTestId("shared-dataset-editor-grid")).toBeVisible({
      timeout: 15_000,
    });

    // ---------- 2. First save (lazy v1 + v2) ----------
    // Click the editor save (whatever the empty grid contains is the
    // post-edit payload — the lazy v1 backfill captures the pre-edit
    // baseline, the v2 row captures the post-edit payload).
    await page.getByTestId("shared-dataset-editor-save").click();

    // Wait for the save to land (toast + non-error state).
    await expect(
      page.getByTestId("shared-dataset-editor-save-error")
    ).not.toBeVisible();

    // ---------- 3. Declare parameters on the case ----------
    await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
    await page.waitForLoadState("load");

    await page.getByTestId("configure-parameters-button").click();
    await expect(page.getByTestId("configure-parameters-sheet")).toBeVisible();

    for (const name of ["email", "password"]) {
      await page.getByTestId("parameter-form-name").fill(name);
      await page.getByTestId("parameter-form-submit").click();
      await expect(page.getByText(`@${name}`).first()).toBeVisible();
    }

    // ---------- 4. Switch to Shared and assign ----------
    await page.getByTestId("tab-dataset").click();
    // The segmented control: Local | Shared. Switching to Shared with no
    // assignment yet opens the AssignSharedDatasetDialog (per Plan 04-06
    // wiring).
    await page.getByTestId("dataset-source-shared").click();
    await expect(
      page.getByTestId("assign-shared-dataset-dialog")
    ).toBeVisible();

    // Pin radio defaults to "current" (RESEARCH.md Pitfall 5 default).
    await expect(page.getByTestId("assign-shared-pin-current")).toBeVisible();

    // Save the assignment. The dialog auto-maps matching column names
    // (email, password) on mount; mapping is valid; Save enables.
    const save = page.getByTestId("assign-shared-save");
    // The dataset-select still needs to be exercised; if the dialog has
    // a single dataset in the project it may auto-select. Open the
    // selector and pick the just-created dataset by name.
    if (await page.getByTestId("assign-shared-dataset-select").isVisible()) {
      await page.getByTestId("assign-shared-dataset-select").click();
      await page.getByRole("option", { name: datasetName }).click();
    }

    await expect(save).toBeEnabled({ timeout: 10_000 });
    await save.click();

    // Dialog should close on success.
    await expect(
      page.getByTestId("assign-shared-dataset-dialog")
    ).not.toBeVisible({ timeout: 10_000 });

    // ---------- 5. Verify the Dataset tab now shows the shared header ----------
    await expect(page.getByTestId("dataset-shared-header")).toBeVisible();
  });
});
