import { expect, test } from "../../fixtures";

/**
 * Prioritize by risk — the run-composition picker.
 *
 * Risk scores are written only by the scorer (the columns are update-locked
 * in the schema), so these specs queue a real backfill and wait for the
 * worker rather than planting numbers. That makes the whole path part of the
 * test: route, queue, worker, scorer, column, filter, selection.
 */
test.describe("Prioritize by risk", () => {
  test("filters by kind, sorts both ways, and adds what is selected", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId!: number;
    let folderId!: number;
    let manualCaseId!: number;
    let automatedCaseId!: number;

    await test.step("Seed one manual and one automated case, then score them", async () => {
      projectId = await api.createProject(`E2E Risk Picker ${ts}`);
      folderId = await api.createFolder(projectId, `Risk Folder ${ts}`);
      manualCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Risk Manual ${ts}`
      );
      automatedCaseId = await api.createTestCase(
        projectId,
        folderId,
        `Risk Automated ${ts}`
      );
      await api.setCaseAutomated(automatedCaseId, true);

      // Two untouched cases both score zero — no failures, no flips, no age,
      // nothing linked — and a tie cannot demonstrate an ordering. A linked
      // defect gives the manual one a real signal to be ranked by.
      const defectId = await api.createIssue(
        projectId,
        `RISK-${ts}`,
        `Risk defect ${ts}`
      );
      await api.linkIssueToTestCase(defectId, manualCaseId);

      await api.backfillRiskScores(projectId);
      // The scorer runs in a worker; a never-executed case still scores, on
      // staleness and the absence of history.
      await expect(async () => {
        expect(await api.getRiskScore(manualCaseId)).not.toBeNull();
        expect(await api.getRiskScore(automatedCaseId)).not.toBeNull();
      }).toPass({ timeout: 60_000 });
    });

    await test.step("Open the picker from the run's case-selection step", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.getByTestId("new-run-button").click();
      await page.getByTestId("run-name-input").first().fill(`Risk Run ${ts}`);
      await page.getByTestId("run-next-button").click();

      // Wide header: the sources render as icon buttons rather than a menu.
      await page.getByTestId("risk-button").click();
      await expect(page.getByTestId("risk-min-score")).toBeVisible({
        timeout: 15000,
      });
    });

    const row = (caseId: number) =>
      page.getByTestId(`risk-candidate-${caseId}`);

    await test.step("Both kinds are offered to start", async () => {
      await expect(page.getByTestId("risk-kind-manual")).toBeChecked();
      await expect(page.getByTestId("risk-kind-automated")).toBeChecked();
      await expect(row(manualCaseId)).toBeVisible({ timeout: 15000 });
      await expect(row(automatedCaseId)).toBeVisible();
    });

    await test.step("Unchecking a kind narrows the candidates to the other", async () => {
      await page.getByTestId("risk-kind-automated").click();

      await expect(row(automatedCaseId)).toHaveCount(0);
      await expect(row(manualCaseId)).toBeVisible();
      // The last kind checked cannot be unchecked: a list that can never hold
      // a row is a dead end rather than a filter.
      await expect(page.getByTestId("risk-kind-manual")).toBeDisabled();

      await page.getByTestId("risk-kind-automated").click();
      await expect(row(automatedCaseId)).toBeVisible();
    });

    await test.step("Changing a kind clears what was selected", async () => {
      await page.getByTestId(`risk-candidate-checkbox-${manualCaseId}`).click();
      await expect(page.getByTestId("risk-accept")).toContainText("1");

      await page.getByTestId("risk-kind-automated").click();

      await expect(page.getByTestId("risk-accept")).not.toContainText("1");
      await page.getByTestId("risk-kind-automated").click();
    });

    await test.step("The Risk score column sorts both ways", async () => {
      const sortButton = page
        .getByRole("columnheader")
        .filter({ hasText: "Risk score" })
        .getByRole("button", { name: /sort/i });

      // The riskier case leads to start; sorting puts the quieter one first,
      // which is the whole point of letting a run take the low-risk cases.
      const firstRow = page.locator('[data-testid^="risk-candidate-"]').first();
      await expect(firstRow).toContainText(`Risk Manual ${ts}`);

      await sortButton.click();

      await expect(firstRow).toContainText(`Risk Automated ${ts}`, {
        timeout: 15000,
      });
    });

    await test.step("Accepting merges the choice into the run", async () => {
      await page.getByTestId(`risk-candidate-checkbox-${manualCaseId}`).click();
      await page.getByTestId("risk-accept").click();

      // The dialog closes and the run's own counter picks the case up.
      await expect(page.getByTestId("risk-min-score")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /Selected Test Cases/i })
      ).toContainText("1", { timeout: 15000 });
    });
  });
});
