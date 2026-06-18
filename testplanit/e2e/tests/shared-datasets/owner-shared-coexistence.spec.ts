import { expect, test } from "../../fixtures";

/**
 * E2E spec — Amendment A regression: owner + shared coexistence
 *
 * Locked CONTEXT.md amendment: a case may carry an owner (local) dataset
 * AND a shared-dataset assignment simultaneously. The shared assignment
 * is preserved for reference and becomes active if the local dataset is
 * later removed. While both exist, iteration uses the local rows
 * (owner-wins), and the assign-shared dialog renders an info banner
 * explaining the coexistence.
 *
 * This spec exercises:
 *   - Local dataset rows present on a case.
 *   - Switching to Shared opens AssignSharedDatasetDialog with the
 *     `assign-shared-owner-banner` visible (the ONLY surface that
 *     proves the owner-aware branch ran).
 *   - The PUT succeeds (no 422 owner-refusal — the original draft
 *     refused; Amendment A reverses that).
 *   - The Dataset tab afterward shows the coexistence banner
 *     (`dataset-owner-shared-banner`) in BOTH Local and Shared views.
 */
test.describe("Shared datasets - owner + shared coexistence (Amendment A) @shared-datasets", () => {
  test("assign a shared dataset to a case with a local dataset; both coexist", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    let projectId: number | undefined;
    let caseId: number | undefined;
    let dataSet: { id: number } | undefined;

    await test.step("Create project, folder, and test case", async () => {
      projectId = await api.createProject(`E2E Owner+Shared ${Date.now()}`);
      const folderId = await api.createFolder(projectId, "Coexist");
      caseId = await api.createTestCase(
        projectId,
        folderId,
        "Login (owner+shared)"
      );
    });

    await test.step("Open the case and declare email and password parameters", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}/${caseId}`);
      await page.waitForLoadState("load");

      await page.getByTestId("configure-parameters-button").click();
      await expect(
        page.getByTestId("configure-parameters-sheet")
      ).toBeVisible();
      for (const name of ["email", "password"]) {
        await page.getByTestId("parameter-form-name").fill(name);
        await page.getByTestId("parameter-form-submit").click();
        await expect(page.getByText(`@${name}`).first()).toBeVisible();
      }
    });

    await test.step("Add two local dataset rows", async () => {
      await page.getByTestId("tab-dataset").click();
      // Default source mode is Local (or shared-ref-not-set).
      await page.getByTestId("dataset-add-row-button").click();
      await page.getByTestId("dataset-add-row-button").click();
    });

    await test.step("Create a shared dataset with versions in the same project", async () => {
      const createRes = await request.post(
        `${baseURL}/api/projects/${projectId}/datasets`,
        {
          data: { name: `Shared dataset ${Date.now()}` },
        }
      );
      expect(createRes.status()).toBe(200);
      ({ dataSet } = await createRes.json());

      // Save a v1+v2 for the dataset so the assignment dialog has a
      // version to pin to. The save endpoint handles the lazy v1
      // backfill + v2 post-edit per W5 lock.
      const saveRes = await request.post(
        `${baseURL}/api/projects/${projectId}/datasets/${dataSet!.id}/save`,
        {
          data: {
            parametersJson: [
              { name: "email", type: "STRING", order: 0, required: true },
              { name: "password", type: "STRING", order: 1, required: true },
            ],
            rowsJson: [
              { valuesJson: { email: "alice@x", password: "p1" } },
              { valuesJson: { email: "bob@x", password: "p2" } },
              { valuesJson: { email: "carol@x", password: "p3" } },
              { valuesJson: { email: "dan@x", password: "p4" } },
              { valuesJson: { email: "eve@x", password: "p5" } },
            ],
          },
        }
      );
      expect(saveRes.status()).toBe(200);
    });

    await test.step("Switch to Shared and confirm the owner-aware banner appears", async () => {
      // The `dataset-source-shared` toggle MUST open the assign dialog
      // with the owner-aware info banner visible. This is the regression
      // assertion: the original draft rejected this PUT with 422; the
      // Amendment A path renders the banner and lets the save succeed.
      await page.getByTestId("dataset-source-shared").click();

      await expect(
        page.getByTestId("assign-shared-dataset-dialog")
      ).toBeVisible();
      // Amendment A regression guard.
      await expect(
        page.getByTestId("assign-shared-owner-banner")
      ).toBeVisible();
    });

    await test.step("Pick the shared dataset and save the assignment", async () => {
      // Pick the freshly-created dataset. The Select only renders once the
      // datasets list resolves, so wait for it explicitly.
      const datasetSelect = page.getByTestId("assign-shared-dataset-select");
      await expect(datasetSelect).toBeVisible({ timeout: 10_000 });
      await datasetSelect.click();
      await page
        .getByRole("option", { name: new RegExp(`Shared dataset`, "i") })
        .first()
        .click();

      // Save (auto-mapped). The save MUST succeed (no 422 owner-refusal).
      const save = page.getByTestId("assign-shared-save");
      await expect(save).toBeEnabled({ timeout: 10_000 });
      await save.click();

      await expect(
        page.getByTestId("assign-shared-dataset-dialog")
      ).not.toBeVisible({ timeout: 10_000 });
    });

    await test.step("Verify the coexistence banner shows in both Shared and Local views", async () => {
      // After save, the page is in Shared mode and the coexistence banner
      // should be visible.
      await expect(
        page.getByTestId("dataset-owner-shared-banner")
      ).toBeVisible();

      // Switch back to Local and verify the coexistence banner is also
      // present there (the owner-wins messaging).
      await page.getByTestId("dataset-source-local").click();
      await expect(
        page.getByTestId("dataset-owner-shared-banner")
      ).toBeVisible();
    });
  });
});
