import { randomUUID } from "crypto";
import { expect, test } from "../../fixtures";

/**
 * Multi-Config Run — Result Submission and Checkbox Selection
 *
 * These tests cover two bugs that existed when multiple configurations are
 * selected on a test run page (the ?configs=run1Id,run2Id view):
 *
 * BUG 1 — Wrong testRunId on result submission
 *   The status dropdown in each table row always sent testRunId = the URL's
 *   primary run, regardless of which config's row was clicked. When Config B's
 *   row was clicked, the POST went to Config A's run.
 *
 * BUG 2 — Checkbox ID collision in shift-select and select-all
 *   The shift-click range and "select all on page" paths used repositoryCaseId
 *   as the row identifier. In multi-config mode the same repo case appears once
 *   per config, so all copies shared an ID — causing incorrect range boundaries
 *   and duplicate entries in the selection set.
 */
test.describe("Multi-Config Run Interaction", () => {
  /**
   * Set up a minimal multi-config test run:
   *   - 2 configurations, 2 sibling runs sharing a configurationGroupId
   *   - 1 repo case added to BOTH runs
   * Returns the run IDs and the testRunCaseId for run2's copy of the case
   * so the result submission test can verify the payload.
   */
  async function setupMultiConfigRun(
    api: any,
    ts: number,
    caseCount = 1
  ): Promise<{
    projectId: number;
    config1Name: string;
    config2Name: string;
    run1Id: number;
    run2Id: number;
    caseIds: number[];
    run1CaseIds: number[];
    run2CaseIds: number[];
  }> {
    const projectId = await api.createProject(`E2E MC ${ts}`);
    const config1Name = `Chrome-${ts}`;
    const config2Name = `Firefox-${ts}`;
    const config1Id = await api.createConfiguration(config1Name, projectId);
    const config2Id = await api.createConfiguration(config2Name, projectId);

    const groupId = randomUUID();
    const run1Id = await api.createTestRun(projectId, `Chrome Run ${ts}`, {
      configId: config1Id,
      configurationGroupId: groupId,
    });
    const run2Id = await api.createTestRun(projectId, `Firefox Run ${ts}`, {
      configId: config2Id,
      configurationGroupId: groupId,
    });

    const folderId = await api.createFolder(projectId, `MC Folder ${ts}`);
    const caseIds: number[] = [];
    const run1CaseIds: number[] = [];
    const run2CaseIds: number[] = [];

    for (let i = 0; i < caseCount; i++) {
      const caseId = await api.createTestCase(
        projectId,
        folderId,
        `MC Case ${i + 1} ${ts}`
      );
      caseIds.push(caseId);
      const rc1Id = await api.addTestCaseToTestRun(run1Id, caseId, {
        order: i,
      });
      const rc2Id = await api.addTestCaseToTestRun(run2Id, caseId, {
        order: i,
      });
      run1CaseIds.push(rc1Id);
      run2CaseIds.push(rc2Id);
    }

    return {
      projectId,
      config1Name,
      config2Name,
      run1Id,
      run2Id,
      caseIds,
      run1CaseIds,
      run2CaseIds,
    };
  }

  // ---------------------------------------------------------------------------
  // BUG 1: result submission must go to the row's own run, not the URL run
  // ---------------------------------------------------------------------------
  test("submits result to the correct testRunId for the clicked config row", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const { projectId, config2Name, run1Id, run2Id, run2CaseIds } =
      await setupMultiConfigRun(api, ts, 1);
    const rc2Id = run2CaseIds[0]; // testRunCaseId that belongs to run2

    // Capture POST bodies sent to the submit-result endpoint
    const submitted: Array<{ testRunId: number; testRunCaseId: number }> = [];
    await page.route("**/api/test-runs/submit-result", async (route) => {
      const body = route.request().postDataJSON();
      submitted.push({
        testRunId: body.testRunId,
        testRunCaseId: body.testRunCaseId,
      });
      await route.continue();
    });

    // Navigate to run1 with both runs' configs selected
    await page.goto(
      `/en-US/projects/runs/${projectId}/${run1Id}?configs=${run1Id},${run2Id}`
    );
    await page.waitForLoadState("load");
    await page.waitForTimeout(3000);

    // Table should show 2 rows — one row per config for the shared case
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(2, { timeout: 10000 });

    // Find run2's row by the Firefox config badge text and click its status button
    const run2Row = rows.filter({ hasText: config2Name });
    await expect(run2Row).toBeVisible({ timeout: 8000 });

    const statusButton = run2Row
      .locator("button")
      .filter({ hasText: /untested/i })
      .first();
    await expect(statusButton).toBeVisible({ timeout: 8000 });
    await statusButton.click();

    // Status dropdown menu opens; pick the first available status
    const dropdownMenu = page.locator('[role="menu"]');
    await expect(dropdownMenu).toBeVisible({ timeout: 8000 });
    const firstStatusOption = dropdownMenu.locator('[role="menuitem"]').first();
    await expect(firstStatusOption).toBeVisible({ timeout: 5000 });
    await firstStatusOption.click();

    // AddResultModal dialog should open
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Submit the result (Save button)
    const saveButton = dialog
      .locator('button[type="submit"], button:has-text("Save")')
      .last();
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Wait for the request to fire and be captured
    await page.waitForTimeout(2000);

    // The submitted payload must target run2, not run1
    expect(submitted.length).toBeGreaterThan(0);
    const payload = submitted[submitted.length - 1];
    expect(payload.testRunId).toBe(run2Id);
    expect(payload.testRunCaseId).toBe(rc2Id);
    expect(payload.testRunId).not.toBe(run1Id);
  });

  // ---------------------------------------------------------------------------
  // BUG 2a: select-all header checkbox must mark every row as selected
  // ---------------------------------------------------------------------------
  test("select-all header checkbox checks all rows independently in multi-config mode", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    // 2 cases × 2 configs = 4 rows
    const { projectId, run1Id, run2Id } = await setupMultiConfigRun(api, ts, 2);

    await page.goto(
      `/en-US/projects/runs/${projectId}/${run1Id}?configs=${run1Id},${run2Id}`
    );
    await page.waitForLoadState("load");
    await page.waitForTimeout(3000);

    // All 4 rows must be visible before we start
    const bodyRows = page.locator("tbody tr");
    await expect(bodyRows).toHaveCount(4, { timeout: 10000 });

    // Click the "Select Case" header checkbox (select-all)
    const headerCheckbox = page
      .locator("thead")
      .getByRole("checkbox", { name: /select case/i });
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();

    // Every row checkbox must now be checked
    const rowCheckboxes = page.locator("tbody").getByRole("checkbox");
    const count = await rowCheckboxes.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      await expect(rowCheckboxes.nth(i)).toBeChecked({ timeout: 5000 });
    }
  });

  // ---------------------------------------------------------------------------
  // BUG 2a-deselect: clicking header checkbox again must uncheck all rows
  // ---------------------------------------------------------------------------
  test("select-all header checkbox unchecks all rows on second click", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const { projectId, run1Id, run2Id } = await setupMultiConfigRun(api, ts, 2);

    await page.goto(
      `/en-US/projects/runs/${projectId}/${run1Id}?configs=${run1Id},${run2Id}`
    );
    await page.waitForLoadState("load");
    await page.waitForTimeout(3000);

    await expect(page.locator("tbody tr")).toHaveCount(4, { timeout: 10000 });

    const headerCheckbox = page
      .locator("thead")
      .getByRole("checkbox", { name: /select case/i });
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });

    // First click: select all
    await headerCheckbox.click();
    const rowCheckboxes = page.locator("tbody").getByRole("checkbox");
    for (let i = 0; i < 4; i++) {
      await expect(rowCheckboxes.nth(i)).toBeChecked({ timeout: 5000 });
    }

    // Second click: deselect all
    await headerCheckbox.click();
    await page.waitForTimeout(500); // let useLayoutEffect settle
    for (let i = 0; i < 4; i++) {
      await expect(rowCheckboxes.nth(i)).not.toBeChecked({ timeout: 5000 });
    }
  });

  // ---------------------------------------------------------------------------
  // BUG 2b: shift-click range must check every row between the two clicks
  // ---------------------------------------------------------------------------
  test("shift-click selects the correct range of rows in multi-config mode", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    // 2 cases × 2 configs = 4 rows — expect rows ordered: C1/cfg1, C1/cfg2, C2/cfg1, C2/cfg2
    // (actual order depends on server sort, but we need ≥4 rows to test a range)
    const { projectId, run1Id, run2Id } = await setupMultiConfigRun(api, ts, 2);

    await page.goto(
      `/en-US/projects/runs/${projectId}/${run1Id}?configs=${run1Id},${run2Id}`
    );
    await page.waitForLoadState("load");
    await page.waitForTimeout(3000);

    const bodyRows = page.locator("tbody tr");
    await expect(bodyRows).toHaveCount(4, { timeout: 10000 });

    const rowCheckboxes = page.locator("tbody").getByRole("checkbox");
    await expect(rowCheckboxes).toHaveCount(4, { timeout: 5000 });

    // Click row 0 (first row)
    await rowCheckboxes.nth(0).click();
    await expect(rowCheckboxes.nth(0)).toBeChecked({ timeout: 3000 });

    // Shift-click row 2 to select rows 0–2
    await page.keyboard.down("Shift");
    await rowCheckboxes.nth(2).click();
    await page.keyboard.up("Shift");

    // Rows 0, 1, and 2 should all be checked
    await expect(rowCheckboxes.nth(0)).toBeChecked({ timeout: 5000 });
    await expect(rowCheckboxes.nth(1)).toBeChecked({ timeout: 5000 });
    await expect(rowCheckboxes.nth(2)).toBeChecked({ timeout: 5000 });
    // Row 3 should remain unchecked
    await expect(rowCheckboxes.nth(3)).not.toBeChecked({ timeout: 3000 });
  });
});
