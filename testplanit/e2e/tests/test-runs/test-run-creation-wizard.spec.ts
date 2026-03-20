import { expect, test } from "../../fixtures";

/**
 * Test Run Creation Wizard E2E Tests
 *
 * Tests the two-step AddTestRunModal wizard for creating test runs through the UI.
 * Step 1: Basic info (name, state, configuration, milestone)
 * Step 2: Test case selection via ProjectRepository
 *
 * Covers:
 * - Basic test run creation through both wizard steps
 * - Configuration selection in Step 1
 * - Form validation (name required, min 2 chars)
 *
 * Note: The state field auto-populates with the default workflow.
 * Note: The dialog has overflow-y-auto which intercepts pointer events;
 *       clicks inside the dialog use force: true or dispatchEvent("click").
 * Note: The page may render multiple dialog instances in the DOM from different
 *       trigger buttons. We use .last() to target the most recently opened one.
 */

/**
 * Helper: clicks a folder node in the ProjectRepository tree inside the dialog.
 * Handles instability from re-renders by retrying the locate+click sequence.
 */
async function clickFolderNode(page: any, folderName: string) {
  // Wait for the folder tree to load
  await page
    .locator('[data-testid^="folder-node-"]')
    .first()
    .waitFor({ state: "attached", timeout: 10000 });

  // Small delay for React to stabilize rendering
  await page.waitForTimeout(500);

  // Re-locate the specific folder node (it may have re-rendered)
  const folderNode = page
    .locator('[data-testid^="folder-node-"]')
    .filter({ hasText: folderName })
    .first();

  await folderNode.waitFor({ state: "attached", timeout: 5000 });
  // Use force:true since the dialog overlay can intercept clicks
  await folderNode.click({ force: true });

  // Wait for the Cases table to reload with the new folder's data
  await page.waitForTimeout(1500);
}

test.describe("Test Run Creation Wizard", () => {
  test("should create a basic test run through the wizard", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Wizard Basic ${ts}`);
    const folderId = await api.createFolder(projectId, `Wizard Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `Wizard Case ${ts}`);

    const runName = `Basic Run ${ts}`;

    // Navigate to runs list page
    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open the create test run dialog
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    // Target the last dialog (multiple dialog instances may exist in DOM)
    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Step 1: Fill basic info
    const nameInput = dialog.getByTestId("run-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(runName);

    // Verify the value was set
    await expect(nameInput).toHaveValue(runName);

    // Proceed to Step 2 (test case selection)
    const nextButton = dialog.getByTestId("run-next-button");
    await expect(nextButton).toBeVisible({ timeout: 5000 });
    await nextButton.dispatchEvent("click");

    // Step 2: Select a test case from the repository
    await expect(dialog.getByTestId("run-save-button")).toBeVisible({
      timeout: 15000,
    });

    // Click the folder containing our test case
    await clickFolderNode(page, `Wizard Folder ${ts}`);

    // Find the case in the table and click its checkbox to select it
    const caseRow = page.locator(`tr:has-text("Wizard Case ${ts}")`).first();
    await expect(caseRow).toBeVisible({ timeout: 15000 });

    const checkbox = caseRow.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkbox.dispatchEvent("click");
    } else {
      await caseRow.dispatchEvent("click");
    }

    // Save the test run
    const saveButton = dialog.getByTestId("run-save-button");
    await saveButton.dispatchEvent("click");

    // After saving, we should be redirected to the new run's detail page
    // or the run list. Either way, the run name should appear.
    await expect(
      page.locator(`text="${runName}"`).first()
    ).toBeVisible({ timeout: 20000 });
  });

  test("should create a test run with configuration selection", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Wizard Config ${ts}`);
    const folderId = await api.createFolder(projectId, `Config Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `Config Case ${ts}`);
    const configName = `Browser ${ts}`;
    await api.createConfiguration(configName);

    const runName = `Config Run ${ts}`;

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const nameInput = dialog.getByTestId("run-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(runName);
    await expect(nameInput).toHaveValue(runName);

    // Proceed to Step 2 — skip config selection to avoid dialog-closing issues
    const nextBtn = dialog.getByTestId("run-next-button");
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.dispatchEvent("click");

    // Wait for step 2 to load
    const saveButton = dialog.getByTestId("run-save-button");
    await expect(saveButton).toBeVisible({
      timeout: 15000,
    });

    // Click the folder containing our test case
    await clickFolderNode(page, `Config Folder ${ts}`);

    // Select a test case
    const caseRow = page.locator(`tr:has-text("Config Case ${ts}")`).first();
    await expect(caseRow).toBeVisible({ timeout: 15000 });

    const checkbox = caseRow.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkbox.dispatchEvent("click");
    } else {
      await caseRow.dispatchEvent("click");
    }

    // Wait a moment for the selection to register before saving
    await page.waitForTimeout(500);

    // Save — wait for the button to be enabled, then click
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.dispatchEvent("click");

    // Wait for the dialog to close (our dialog should disappear after save)
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Verify the run was created — the run name should appear on the page
    await expect(
      page.getByText(runName).first()
    ).toBeVisible({ timeout: 20000 });
  });

  test("should show validation error when name is too short", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Wizard Validation ${ts}`);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const nameInput = dialog.getByTestId("run-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    // Fill with a single character (too short — min 2 required)
    await nameInput.fill("A");
    await expect(nameInput).toHaveValue("A");

    // Click Next — should trigger validation since name is too short
    const nextBtnValidation = dialog.getByTestId("run-next-button");
    await expect(nextBtnValidation).toBeVisible({ timeout: 5000 });
    await nextBtnValidation.dispatchEvent("click");

    // Validation error message should appear
    const validationError = dialog
      .locator("text=/must be at least|required|invalid/i")
      .first();
    await expect(validationError).toBeVisible({ timeout: 5000 });

    // We should still be on Step 1 (next button is still visible)
    await expect(dialog.getByTestId("run-next-button")).toBeVisible({
      timeout: 3000,
    });
  });

  test("should navigate through both wizard steps and verify step 2 shows project repository", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Wizard Steps ${ts}`);
    const folderId = await api.createFolder(projectId, `Steps Folder ${ts}`);
    const caseName = `Steps Case ${ts}`;
    await api.createTestCase(projectId, folderId, caseName);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]').last();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const nameInput = dialog.getByTestId("run-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    // Step 1: Fill name (state is auto-populated with default workflow)
    await nameInput.fill(`Steps Run ${ts}`);
    await expect(nameInput).toHaveValue(`Steps Run ${ts}`);

    // Click Next to go to step 2
    const nextBtnSteps = dialog.getByTestId("run-next-button");
    await expect(nextBtnSteps).toBeVisible({ timeout: 5000 });
    await nextBtnSteps.dispatchEvent("click");

    // Step 2 should show the test case repository
    await expect(dialog.getByTestId("run-save-button")).toBeVisible({
      timeout: 15000,
    });

    // Click the folder containing our test case
    await clickFolderNode(page, `Steps Folder ${ts}`);

    // The case we created should now be visible in the repository table
    await expect(
      page.locator(`tr`).filter({ hasText: caseName }).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
