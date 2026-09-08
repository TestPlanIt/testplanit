import { expect, test } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";
import { clickOverflowAction } from "../../utils/action-overflow";

/**
 * Add Case — Inline Parameters & Dataset
 *
 * The Add Case modal exposes a Configure Parameters button above the Steps
 * field (mirrors the case details page). Clicking opens a Sheet that hosts
 * an InlineDatasetEditor; on submit the parameters + dataset rows land
 * atomically through the same `importGeneratedTestCases` server action
 * that the plain (no-parameters) path uses.
 *
 * These tests guard against regressions in three high-blast-radius
 * scenarios that the unit tests in
 * `lib/services/inlineParamsGate.test.ts` and
 * `components/parameters/__tests__/InlineDatasetEditor.test.tsx` can't
 * cover end-to-end:
 *
 *   1. The Configure Parameters affordance appears at all and the Sheet
 *      opens with the editor wired up (UI rendering + dependency chain
 *      from React state down to the test ids that downstream automation
 *      keys off).
 *   2. The full save path round-trips: case + parameter + dataset +
 *      dataset version + dataset row all land in the database from a
 *      single Submit click, with `hasParameters` flipped on the case.
 *   3. The plain happy path (no Sheet interaction) still creates a
 *      non-parameterized case so the new code paths can't silently
 *      regress AddCase — the biggest feature in the product.
 */

async function setupProjectAndFolder(
  api: import("../../fixtures/api.fixture").ApiHelper
): Promise<{ projectId: number; folderId: number }> {
  const projectId = await api.createProject(
    `E2E Inline Params ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const folderId = await api.createFolder(projectId, `Folder ${Date.now()}`);
  return { projectId, folderId };
}

async function findCaseIdByName(
  api: import("../../fixtures/api.fixture").ApiHelper,
  folderId: number,
  name: string
): Promise<number | null> {
  const resp = await (api as any).request.get(
    `${(api as any).baseURL}/api/model/repositoryCases/findFirst?q=` +
      encodeURIComponent(
        JSON.stringify({
          where: { folderId, name, isDeleted: false },
          select: { id: true },
        })
      )
  );
  if (!resp.ok()) return null;
  const json = await resp.json();
  return json?.data?.id ?? null;
}

async function getCaseSnapshot(
  api: import("../../fixtures/api.fixture").ApiHelper,
  caseId: number
): Promise<{
  hasParameters: boolean | null;
  parameterCount: number;
  datasetCount: number;
  datasetVersionCount: number;
  datasetRowCount: number;
  firstParamName: string | null;
  firstRowLabel: string | null;
  firstRowValues: Record<string, unknown> | null;
}> {
  // RepositoryCases.hasParameters
  const caseResp = await (api as any).request.get(
    `${(api as any).baseURL}/api/model/repositoryCases/findFirst?q=` +
      encodeURIComponent(
        JSON.stringify({
          where: { id: caseId },
          select: { id: true, hasParameters: true },
        })
      )
  );
  const caseRow = caseResp.ok() ? (await caseResp.json()).data : null;

  const paramResp = await (api as any).request.get(
    `${(api as any).baseURL}/api/model/testCaseParameter/findMany?q=` +
      encodeURIComponent(
        JSON.stringify({
          where: { testCaseId: caseId, isDeleted: false },
          orderBy: { order: "asc" },
          select: { id: true, name: true, type: true },
        })
      )
  );
  const params = paramResp.ok() ? ((await paramResp.json()).data ?? []) : [];

  const datasetResp = await (api as any).request.get(
    `${(api as any).baseURL}/api/model/dataSet/findMany?q=` +
      encodeURIComponent(
        JSON.stringify({
          where: { ownerCaseId: caseId, isDeleted: false },
          select: { id: true },
        })
      )
  );
  const datasets = datasetResp.ok()
    ? ((await datasetResp.json()).data ?? [])
    : [];
  const datasetIds = datasets.map((d: { id: number }) => d.id);

  let datasetVersions: any[] = [];
  let datasetRows: any[] = [];
  if (datasetIds.length) {
    const vResp = await (api as any).request.get(
      `${(api as any).baseURL}/api/model/dataSetVersion/findMany?q=` +
        encodeURIComponent(
          JSON.stringify({
            where: { dataSetId: { in: datasetIds } },
            select: { id: true, version: true },
          })
        )
    );
    datasetVersions = vResp.ok() ? ((await vResp.json()).data ?? []) : [];

    const rResp = await (api as any).request.get(
      `${(api as any).baseURL}/api/model/dataSetRow/findMany?q=` +
        encodeURIComponent(
          JSON.stringify({
            where: { dataSetId: { in: datasetIds }, isDeleted: false },
            orderBy: { rowIndex: "asc" },
            select: {
              id: true,
              rowIndex: true,
              label: true,
              valuesJson: true,
            },
          })
        )
    );
    datasetRows = rResp.ok() ? ((await rResp.json()).data ?? []) : [];
  }

  return {
    hasParameters: caseRow?.hasParameters ?? null,
    parameterCount: params.length,
    datasetCount: datasets.length,
    datasetVersionCount: datasetVersions.length,
    datasetRowCount: datasetRows.length,
    firstParamName: params[0]?.name ?? null,
    firstRowLabel: datasetRows[0]?.label ?? null,
    firstRowValues: datasetRows[0]?.valuesJson ?? null,
  };
}

test.describe("Add Case — Inline Parameters & Dataset", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  test("Configure Parameters button is visible on a Steps-bearing template and the Sheet opens with the editor wired @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);

    const dialog = page.getByTestId("add-case-dialog");

    await test.step("Open the Add Case dialog in the target folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Click Configure parameters and confirm the editor Sheet opens wired up", async () => {
      // The seeded "Default Template" has a Steps field, so the button
      // renders by default. Label is "Configure parameters" when the
      // editor has nothing authored yet.
      const configureBtn = dialog
        .getByRole("button", { name: /^configure parameters$/i })
        .first();
      await expect(configureBtn).toBeVisible({ timeout: 10000 });
      await configureBtn.click();

      // The Sheet renders the editor with its add-parameter affordance
      // and the dataset Add-row button disabled until a parameter exists.
      const editorRoot = page.getByTestId("addcase-inline-dataset-root");
      await expect(editorRoot).toBeVisible({ timeout: 5000 });
      await expect(
        page.getByTestId("addcase-inline-dataset-add-parameter")
      ).toBeVisible();
      await expect(
        page.getByTestId("addcase-inline-dataset-add-row")
      ).toBeDisabled();
    });
  });

  test("Inline parameters and a dataset row persist on save (full round-trip)", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Inline Params ${Date.now()}`;

    const dialog = page.getByTestId("add-case-dialog");

    await test.step("Open the Add Case dialog and name the case", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );
      await expect(dialog).toBeVisible({ timeout: 10000 });

      await dialog.getByTestId("case-name-input").fill(caseName);
    });

    await test.step("Author one parameter column and one dataset row in the Sheet", async () => {
      // Open the Configure Parameters sheet, author a single column + row.
      await dialog
        .getByRole("button", { name: /^configure parameters$/i })
        .first()
        .click();
      await expect(page.getByTestId("addcase-inline-dataset-root")).toBeVisible(
        {
          timeout: 5000,
        }
      );

      await page.getByTestId("addcase-inline-dataset-add-parameter").click();
      const nameInput = page.getByTestId(
        "addcase-inline-dataset-parameter-name-0"
      );
      await expect(nameInput).toHaveValue("param", { timeout: 5000 });
      await nameInput.fill("user");

      await page.getByTestId("addcase-inline-dataset-add-row").click();
      await page
        .getByTestId("addcase-inline-dataset-row-label-0")
        .fill("happy path");
      await page
        .getByTestId("addcase-inline-dataset-row-0-col-0")
        .fill("alice");
    });

    await test.step("Close the Sheet with Escape and confirm the parameter count badge", async () => {
      // Close the Sheet via Escape — Dialog must stay open and the button
      // label updates to reflect the new column count.
      await page.keyboard.press("Escape");
      await expect(
        page.getByTestId("addcase-inline-dataset-root")
      ).not.toBeVisible({ timeout: 5000 });
      await expect(
        dialog.getByRole("button", { name: /^parameters \(1\)$/i })
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step("Submit the case and confirm it appears in the table", async () => {
      await page.getByTestId("case-submit-button").click();
      await expect(dialog).not.toBeVisible({ timeout: 15000 });

      // Case must appear in the table, and the DB row must have its
      // parameter + dataset + dataset version + dataset row all written
      // in the single atomic save.
      const caseRow = repositoryPage.getTestCaseByName(caseName);
      await expect(caseRow).toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify parameter, dataset, version, and row all persisted atomically", async () => {
      const caseId = await findCaseIdByName(api, folderId, caseName);
      expect(caseId).not.toBeNull();
      const snapshot = await getCaseSnapshot(api, caseId!);
      expect(snapshot.hasParameters).toBe(true);
      expect(snapshot.parameterCount).toBe(1);
      expect(snapshot.firstParamName).toBe("user");
      expect(snapshot.datasetCount).toBe(1);
      expect(snapshot.datasetVersionCount).toBe(1);
      expect(snapshot.datasetRowCount).toBe(1);
      expect(snapshot.firstRowLabel).toBe("happy path");
      expect(snapshot.firstRowValues).toEqual({ user: "alice" });
    });
  });

  test("Plain submit without opening the Sheet creates a non-parameterized case (regression guard) @smoke", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Plain Case ${Date.now()}`;

    const dialog = page.getByTestId("add-case-dialog");

    await test.step("Open the Add Case dialog and name the case", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await dialog.getByTestId("case-name-input").fill(caseName);
    });

    await test.step("Submit without opening the Sheet and confirm the case appears", async () => {
      // The Configure Parameters button is present (Default Template has
      // Steps) but we never click it. This is the most common user path —
      // a quick case creation with no parameter authoring.
      await page.getByTestId("case-submit-button").click();
      await expect(dialog).not.toBeVisible({ timeout: 15000 });

      const caseRow = repositoryPage.getTestCaseByName(caseName);
      await expect(caseRow).toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify the saved case is non-parameterized", async () => {
      const caseId = await findCaseIdByName(api, folderId, caseName);
      expect(caseId).not.toBeNull();
      const snapshot = await getCaseSnapshot(api, caseId!);
      expect(snapshot.hasParameters).toBe(false);
      expect(snapshot.parameterCount).toBe(0);
      expect(snapshot.datasetCount).toBe(0);
      expect(snapshot.datasetVersionCount).toBe(0);
      expect(snapshot.datasetRowCount).toBe(0);
    });
  });

  /**
   * Highest-risk regression from this PR: the `templateHasSteps` memo + the
   * effect that fires when it flips. The effect zeroes `inlineParameters`,
   * `inlineDatasetRows`, and `inlineParamsSheetOpen` so a template switch
   * can't ship orphan columns on submit. This test exercises both
   * directions of the switch (Steps -> no-Steps -> Steps) and asserts on
   * the DB to prove no orphaned state survived.
   */
  test("Switching from a Steps template to a no-Steps template clears authored inline parameters", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);
    const caseName = `Switch Test ${Date.now()}`;

    const dialog = page.getByTestId("add-case-dialog");
    const templateTrigger = dialog.getByRole("combobox").first();
    let noStepsTemplateName: string | undefined;

    await test.step("Create a sibling no-Steps template assigned to the project", async () => {
      // Build a sibling template with no Steps field and assign it to the
      // test project. `Priority` is a seeded standard field that's not Steps.
      const priorityFieldId = await api.getCaseFieldId("Priority");
      expect(priorityFieldId).not.toBeNull();
      noStepsTemplateName = `No Steps Template ${Date.now()}`;
      await api.createTemplate({
        name: noStepsTemplateName,
        isEnabled: true,
        isDefault: false,
        caseFieldIds: [priorityFieldId!],
        projectIds: [projectId],
      });
    });

    await test.step("Open the Add Case dialog and author a parameter on the Default Template", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Default Template has Steps → button is visible. Author a parameter.
      const configureBtnInitial = dialog
        .getByRole("button", { name: /^configure parameters$/i })
        .first();
      await expect(configureBtnInitial).toBeVisible({ timeout: 10000 });
      await configureBtnInitial.click();
      await page.getByTestId("addcase-inline-dataset-add-parameter").click();
      await expect(
        page.getByTestId("addcase-inline-dataset-parameter-name-0")
      ).toHaveValue("param", { timeout: 5000 });
      await page.keyboard.press("Escape");
      await expect(
        dialog.getByRole("button", { name: /^parameters \(1\)$/i })
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step("Switch to the no-Steps template and confirm the Configure button disappears", async () => {
      // Switch to the no-Steps template via the dialog's template select.
      // The Configure Parameters button must disappear because the
      // templateHasSteps memo flips to false.
      await templateTrigger.click();
      await page
        .getByRole("option", { name: noStepsTemplateName! })
        .first()
        .click();
      await expect(templateTrigger).toHaveText(noStepsTemplateName!, {
        timeout: 5000,
      });
      await expect(
        dialog.getByRole("button", {
          name: /configure parameters|parameters \(/i,
        })
      ).toHaveCount(0, { timeout: 5000 });
    });

    await test.step("Switch back to the Default Template and confirm the label reset to zero", async () => {
      // Switch BACK to Default Template. Button returns and label resets to
      // "Configure parameters" (count = 0) — proves the clear effect ran.
      await templateTrigger.click();
      await page
        .getByRole("option", { name: "Default Template" })
        .first()
        .click();
      await expect(templateTrigger).toHaveText("Default Template", {
        timeout: 5000,
      });
      await expect(
        dialog.getByRole("button", { name: /^configure parameters$/i })
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step("Submit and verify the saved case has zero parameters", async () => {
      // Submit and verify the saved case has zero parameters — the authored
      // param was discarded by the clear effect, not carried over silently.
      await dialog.getByTestId("case-name-input").fill(caseName);
      await page.getByTestId("case-submit-button").click();
      await expect(dialog).not.toBeVisible({ timeout: 15000 });

      const caseRow = repositoryPage.getTestCaseByName(caseName);
      await expect(caseRow).toBeVisible({ timeout: 15000 });
      const caseId = await findCaseIdByName(api, folderId, caseName);
      expect(caseId).not.toBeNull();
      const snapshot = await getCaseSnapshot(api, caseId!);
      expect(snapshot.hasParameters).toBe(false);
      expect(snapshot.parameterCount).toBe(0);
      expect(snapshot.datasetCount).toBe(0);
    });
  });

  /**
   * Regression guard for the Configure Parameters button injection above
   * the Steps field. The button is rendered via `React.Fragment` next to
   * `RenderField` inside the field-loop map. If the fragment key, the
   * `isStepsField` check, or the conditional render regresses, the Steps
   * field could disappear or fail to receive its props. This test asserts
   * (a) both the button and the Steps field renderer are present, and
   * (b) DOM order places the button above the Steps field.
   */
  test("Configure Parameters button sits above the Steps field renderer in DOM order (button injection regression guard)", async ({
    api,
    page,
  }) => {
    const { projectId, folderId } = await setupProjectAndFolder(api);

    const dialog = page.getByTestId("add-case-dialog");
    const configureBtn = dialog
      .getByRole("button", { name: /^configure parameters$/i })
      .first();
    const stepsHeading = dialog.getByText("Steps", { exact: true }).first();

    await test.step("Open the Add Case dialog and confirm the Configure button and Steps field render", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId);

      await clickOverflowAction(
        page,
        "add-case-button",
        "repository-actions-menu"
      );
      await expect(dialog).toBeVisible({ timeout: 10000 });

      await expect(configureBtn).toBeVisible({ timeout: 10000 });

      // The Steps field renderer surfaces an `Add Step` affordance below
      // the button. Both must be in the same scrollable region (the left
      // ResizablePanel), and the button's bounding box must be above the
      // Steps section's bounding box.
      await expect(stepsHeading).toBeVisible({ timeout: 10000 });
    });

    await test.step("Assert the Configure button sits above the Steps field in DOM order", async () => {
      const btnBox = await configureBtn.boundingBox();
      const stepsBox = await stepsHeading.boundingBox();
      expect(btnBox).not.toBeNull();
      expect(stepsBox).not.toBeNull();
      expect(btnBox!.y + btnBox!.height).toBeLessThan(stepsBox!.y);
    });
  });
});
