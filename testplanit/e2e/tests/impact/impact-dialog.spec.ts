import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  MOCK_BASE_SHA,
  MOCK_HEAD_SHA,
  MOCK_PINNED_FILE,
  MOCK_UNCOVERED_FILE,
  mockAnalysisCases,
  mockImpactApi,
} from "../../utils/impact-mocks";

/**
 * The Impact dialog in the test-run composer (Add Test Run, step 2).
 *
 * Provider and job APIs are mocked with production-shaped payloads (see
 * e2e/utils/impact-mocks.ts); the project, repository, config and cases are
 * real rows, so the accepted suggestions land on real table checkboxes.
 */

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Open Add Test Run, fill the name, advance to the case-selection step and
 * return that step's dialog. Mirrors the Magic Select spec's approach to the
 * react-hook-form input and the Next button.
 */
async function openCaseSelectionStep(
  page: Page,
  projectId: number,
  runName: string
): Promise<Locator> {
  await page.goto(`/en-US/projects/runs/${projectId}`);
  await page.waitForLoadState("load");

  const newRunButton = page.getByTestId("new-run-button");
  await expect(newRunButton).toBeVisible({ timeout: 15000 });
  await newRunButton.click();

  const nameInput = page.getByTestId("run-name-input").first();
  await expect(nameInput).toBeVisible({ timeout: 10000 });
  await nameInput.evaluate((el: HTMLInputElement, value) => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    nativeInputValueSetter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, runName);

  const nextButton = page.getByTestId("run-next-button").first();
  await expect(nextButton).toBeVisible({ timeout: 5000 });
  await nextButton.dispatchEvent("click");

  await expect(page.getByTestId("run-save-button").first()).toBeVisible({
    timeout: 15000,
  });
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: "Select Test Cases" })
    .last();
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

/**
 * The ImpactButton renders nothing until its project query (impactEnabled +
 * the IMPACT config) resolves, so negative assertions wait for that
 * response before checking the button is absent or disabled.
 */
function waitForImpactGate(page: Page) {
  return page.waitForResponse(
    (res) => {
      if (!res.url().includes("/api/model/projects/findFirst")) return false;
      try {
        return decodeURIComponent(res.url()).includes("codeRepositoryConfigs");
      } catch {
        return false;
      }
    },
    { timeout: 20000 }
  );
}

test.describe("Impact dialog", () => {
  test("walks pick → compare → analyze → review and merges the accepted cases into the selection", async ({
    page,
    api,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Impact Dialog ${ts}`);
    await api.enableImpact(projectId);
    const repositoryId = await api.createCodeRepository(
      `E2E Impact Repo ${ts}`
    );
    await api.createImpactConfig(projectId, repositoryId, { branch: "main" });
    const folderId = await api.createFolder(projectId, `Impact Folder ${ts}`);
    const pinnedName = `Checkout cart ${ts}`;
    const affectedName = `Checkout totals ${ts}`;
    const pinnedCaseId = await api.createTestCase(
      projectId,
      folderId,
      pinnedName
    );
    const affectedCaseId = await api.createTestCase(
      projectId,
      folderId,
      affectedName
    );
    const manualCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Manual pick ${ts}`
    );

    const calls = await mockImpactApi(page, {
      configuredBranch: "main",
      analysisCases: mockAnalysisCases([
        { id: pinnedCaseId, name: pinnedName },
        { id: affectedCaseId, name: affectedName },
      ]),
    });

    const dialog =
      await test.step("Open the case-selection step and hand-pick one case", async () => {
        const step = await openCaseSelectionStep(
          page,
          projectId,
          `Impact Run ${ts}`
        );
        // The root folder is selected by default and holds no cases; open
        // the seeded folder so its rows (and checkboxes) render.
        const folderNode = step.getByTestId(`folder-node-${folderId}`);
        await expect(folderNode).toBeVisible({ timeout: 15000 });
        const manualCheckbox = step.getByTestId(
          `case-checkbox-${manualCaseId}`
        );
        // The repository's async folder auto-select can override a click
        // that lands first, and the selection-mode table re-mounts its rows
        // while it settles (a real click keeps finding a detached element).
        // Re-open the folder until the row sticks, then dispatch the click
        // the way the Magic Select spec drives this modal.
        await expect(async () => {
          await folderNode.click();
          await expect(manualCheckbox).toBeVisible({ timeout: 3000 });
          if (!(await manualCheckbox.isChecked())) {
            await manualCheckbox.dispatchEvent("click");
          }
          await expect(manualCheckbox).toBeChecked({ timeout: 2000 });
        }).toPass({ timeout: 30000 });
        return step;
      });

    await test.step("The Impact button is enabled and opens the dialog", async () => {
      const impactButton = dialog.getByTestId("impact-button");
      await expect(impactButton).toBeVisible({ timeout: 15000 });
      await expect(impactButton).toBeEnabled();
      await impactButton.dispatchEvent("click");
      await expect(page.getByTestId("impact-dialog")).toBeVisible({
        timeout: 10000,
      });
    });

    const impactDialog = page.getByTestId("impact-dialog");
    const baseShort = MOCK_BASE_SHA.slice(0, 7);
    const headShort = MOCK_HEAD_SHA.slice(0, 7);

    await test.step("Pick: the branch comes from the config; base and head come from the mocked commit log", async () => {
      await expect(impactDialog.getByTestId("impact-branch")).toContainText(
        "main",
        { timeout: 10000 }
      );
      await expect(impactDialog.getByTestId("impact-compare")).toBeDisabled();

      await impactDialog.getByTestId("impact-base-commit").click();
      await page.getByRole("option", { name: new RegExp(baseShort) }).click();
      await expect(
        impactDialog.getByTestId("impact-base-commit")
      ).toContainText(baseShort);

      await impactDialog.getByTestId("impact-head-commit").click();
      await page.getByRole("option", { name: new RegExp(headShort) }).click();
      await expect(
        impactDialog.getByTestId("impact-head-commit")
      ).toContainText(headShort);

      await expect(impactDialog.getByTestId("impact-same-commit")).toHaveCount(
        0
      );
      await expect(impactDialog.getByTestId("impact-compare")).toBeEnabled();
    });

    await test.step("Compare: the changed files list and a file's diff expand", async () => {
      await impactDialog.getByTestId("impact-compare").click();
      await expect(impactDialog.getByTestId("impact-diff-summary")).toBeVisible(
        { timeout: 10000 }
      );
      await expect(
        impactDialog.getByTestId("impact-diff-summary")
      ).toContainText("2 files changed");

      const firstFile = impactDialog.getByTestId("impact-diff-file-0");
      await expect(firstFile).toBeVisible();
      await expect(firstFile).toContainText(MOCK_PINNED_FILE);
      await expect(
        impactDialog.getByTestId("impact-diff-file-1")
      ).toContainText(MOCK_UNCOVERED_FILE);

      await firstFile.click();
      const patchRow = impactDialog.getByTestId("impact-diff-patch-0");
      await expect(patchRow).toBeVisible();
      await expect(patchRow.getByTestId("diff-view")).toBeVisible();

      expect(calls.compares).toEqual([
        { base: MOCK_BASE_SHA, head: MOCK_HEAD_SHA },
      ]);
    });

    await test.step("Analyze: the progress step shows the job phase, then the review renders", async () => {
      await impactDialog.getByTestId("impact-analyze").click();
      await expect(impactDialog.getByTestId("impact-progress")).toBeVisible({
        timeout: 10000,
      });
      await expect(impactDialog.getByTestId("impact-progress")).toContainText(
        "Matching Code Pins"
      );
      await expect(
        impactDialog.getByTestId("impact-cancel-analysis")
      ).toBeVisible();

      // One RUNNING poll, then COMPLETED (the hook polls every 2s).
      await expect(
        impactDialog.getByTestId("impact-affected-title")
      ).toBeVisible({ timeout: 20000 });
      expect(calls.analysisPosts).toHaveLength(1);
      expect(calls.analysisPosts[0]).toMatchObject({
        base: MOCK_BASE_SHA,
        head: MOCK_HEAD_SHA,
        excludeCaseIds: [manualCaseId],
      });
    });

    await test.step("Review: both suggestions are pre-selected with their reasons; the uncovered file is called out", async () => {
      await expect(
        impactDialog.getByTestId("impact-affected-title")
      ).toContainText("2 affected tests");
      await expect(impactDialog.getByTestId("impact-summary")).toBeVisible();

      const pinnedRow = impactDialog.getByTestId(
        `impact-recommendation-${pinnedCaseId}`
      );
      const affectedRow = impactDialog.getByTestId(
        `impact-recommendation-${affectedCaseId}`
      );
      await expect(pinnedRow).toBeVisible();
      await expect(pinnedRow).toHaveAttribute("data-selected", "true");
      await expect(pinnedRow).toContainText(pinnedName);
      await expect(
        pinnedRow.getByTestId(`impact-recommendation-checkbox-${pinnedCaseId}`)
      ).toBeChecked();
      await expect(affectedRow).toBeVisible();
      await expect(affectedRow).toHaveAttribute("data-selected", "true");
      await expect(affectedRow).toContainText(affectedName);

      // Expanding a row reveals the reason detail for its layer.
      await pinnedRow
        .getByTestId(`impact-recommendation-toggle-${pinnedCaseId}`)
        .click();
      await expect(
        impactDialog.getByTestId(`impact-reason-${pinnedCaseId}-PIN`)
      ).toBeVisible();

      const uncovered = impactDialog.getByTestId("impact-uncovered");
      await expect(uncovered).toBeVisible();
      await expect(uncovered).toContainText("1 changed file has no test");
      await expect(uncovered).toContainText(MOCK_UNCOVERED_FILE);
      await expect(
        uncovered.getByTestId("impact-uncovered-pin-0")
      ).toBeVisible();

      await expect(impactDialog.getByTestId("impact-accept")).toHaveText(
        /Add 2 cases/
      );
    });

    await test.step("Accept: the suggestions join the hand-picked case in the run's selection", async () => {
      await impactDialog.getByTestId("impact-accept").click();
      await expect(impactDialog).toBeHidden({ timeout: 10000 });

      // The selection itself is folder-independent: 1 hand-picked + 2 accepted.
      await expect(
        dialog.getByRole("button", { name: /Selected Test Cases/ })
      ).toContainText("3", { timeout: 10000 });

      // The rows reflect it too — re-open the folder if the auto-select
      // moved away from it in the meantime.
      await expect(async () => {
        const manualCheckbox = dialog.getByTestId(
          `case-checkbox-${manualCaseId}`
        );
        if (!(await manualCheckbox.isVisible())) {
          await dialog.getByTestId(`folder-node-${folderId}`).click();
        }
        for (const caseId of [pinnedCaseId, affectedCaseId, manualCaseId]) {
          await expect(
            dialog.getByTestId(`case-checkbox-${caseId}`)
          ).toBeChecked({ timeout: 3000 });
        }
      }).toPass({ timeout: 20000 });
    });
  });

  test("is hidden while Impact is off for the project", async ({
    page,
    api,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Impact Off ${ts}`);

    const gate = waitForImpactGate(page);
    const dialog = await openCaseSelectionStep(
      page,
      projectId,
      `Off Run ${ts}`
    );
    await gate;

    await expect(
      dialog.getByRole("button", { name: "Magic Select" }).first()
    ).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByTestId("impact-button")).toHaveCount(0);
  });

  test("is disabled with a hint when Impact is on but no repository is connected", async ({
    page,
    api,
  }) => {
    const ts = uid();
    const projectId = await api.createProject(`E2E Impact No Repo ${ts}`);
    await api.enableImpact(projectId);

    const gate = waitForImpactGate(page);
    const dialog = await openCaseSelectionStep(
      page,
      projectId,
      `No Repo Run ${ts}`
    );
    await gate;

    const impactButton = dialog.getByTestId("impact-button");
    await expect(impactButton).toBeVisible({ timeout: 15000 });
    await expect(impactButton).toBeDisabled();

    // A disabled button ignores pointer events; the tooltip trigger is the
    // wrapping span.
    await impactButton.locator("xpath=..").hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toContainText(
      "Connect the application repository in project settings to use Impact."
    );
  });
});
