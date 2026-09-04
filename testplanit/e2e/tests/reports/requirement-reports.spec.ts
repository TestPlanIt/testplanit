import { expect, test } from "../../fixtures";

/**
 * The requirement report types in the report builder: coverage gaps,
 * traceability (with CSV export), and coverage changes against a baseline
 * snapshot.
 */
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe("Requirement reports", () => {
  let projectId: number;
  let coveredId: number;
  let uncoveredId: number;
  let caseId: number;

  test.beforeEach(async ({ api }) => {
    const ts = uid();
    projectId = await api.createProject(`E2E Req Reports ${ts}`);
    await api.enableRequirements(projectId);
    const folderId = await api.getRootFolderId(projectId);
    caseId = await api.createTestCase(
      projectId,
      folderId,
      `Covered case ${ts}`
    );
    coveredId = await api.createRequirement(
      projectId,
      `COV-${ts}`,
      `Covered ${ts}`
    );
    uncoveredId = await api.createRequirement(
      projectId,
      `GAP-${ts}`,
      `Uncovered ${ts}`
    );
    await api.linkIssueToTestCase(coveredId, caseId);
    const runId = await api.createTestRun(projectId, `Coverage run ${ts}`);
    const runCaseId = await api.addTestCaseToTestRun(runId, caseId);
    await api.createTestResult(
      runId,
      runCaseId,
      await api.getStatusId("passed")
    );
  });

  test("the coverage gaps report lists only the uncovered requirement", async ({
    page,
  }) => {
    await page.goto(
      `/en-US/projects/reports/${projectId}?tab=builder&reportType=requirement-coverage-gaps`
    );
    const run = page.getByTestId("run-report-button").first();
    await expect(run).toBeEnabled({ timeout: 15000 });
    await run.click();
    await expect(
      page.getByTestId(`requirement-report-link-${uncoveredId}`)
    ).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByTestId(`requirement-report-link-${coveredId}`)
    ).toHaveCount(0);
  });

  test("the traceability report shows both requirements and exports CSV", async ({
    page,
  }) => {
    await page.goto(
      `/en-US/projects/reports/${projectId}?tab=builder&reportType=requirement-traceability`
    );
    const run = page.getByTestId("run-report-button").first();
    await expect(run).toBeEnabled({ timeout: 15000 });
    await run.click();
    await expect(
      page.getByTestId(`requirement-report-link-${coveredId}`)
    ).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByTestId(`requirement-report-link-${uncoveredId}`)
    ).toBeVisible();
    await expect(
      page.getByTestId("requirement-report-coverage-passed").first()
    ).toBeVisible();
    await expect(
      page.getByTestId("requirement-report-coverage-uncovered").first()
    ).toBeVisible();

    const download = page.waitForEvent("download", { timeout: 30000 });
    await page.getByTestId("report-export-csv-button").click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });

  test("the coverage changes report shows what changed since a baseline", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const snapshot = await request.post(
      `${baseURL}/api/projects/${projectId}/requirements/snapshots`,
      { data: { name: `Baseline ${uid()}` } }
    );
    expect(snapshot.status()).toBe(201);
    const snapshotBody = await snapshot.json();
    const snapshotId = snapshotBody.id ?? snapshotBody.snapshot?.id;
    // Change coverage after the baseline: the uncovered requirement gains a link.
    await api.linkIssueToTestCase(uncoveredId, caseId);

    await page.goto(
      // The snapshot pickers live in the pre-built Reports pane, not the builder.
      `/en-US/projects/reports/${projectId}?reportType=requirement-coverage-changes`
    );
    const baselineTrigger = page.getByTestId(
      "requirement-baseline-snapshot-trigger"
    );
    await expect(baselineTrigger).toBeVisible({ timeout: 15000 });
    await baselineTrigger.click();
    const option = snapshotId
      ? page.getByTestId(`requirement-baseline-snapshot-option-${snapshotId}`)
      : page
          .locator('[data-testid^="requirement-baseline-snapshot-option-"]')
          .first();
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click();
    const run = page.getByTestId("run-report-button").first();
    await expect(run).toBeEnabled({ timeout: 15000 });
    await run.click();
    await expect(
      page.getByTestId("requirement-coverage-changes-overview")
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByTestId(`requirement-report-link-${uncoveredId}`)
    ).toBeVisible({ timeout: 20000 });
  });
});
