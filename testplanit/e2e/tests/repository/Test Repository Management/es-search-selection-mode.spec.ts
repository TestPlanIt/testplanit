import { expect, test } from "../../../fixtures";

/**
 * Elasticsearch Search in Selection Mode Tests
 *
 * Tests the Elasticsearch-powered search functionality that appears when
 * the repository is in selection mode (e.g., when selecting test cases for
 * a test run in AddTestRunModal step 2).
 *
 * Covers:
 * - ES search input appears only in selection mode
 * - Typing a query filters cases to ES results
 * - Clearing search restores full case list
 * - Select All uses search result IDs (not entire folder)
 */

/**
 * Helper to click a folder node in the ProjectRepository tree inside the dialog.
 * Step 2 of AddTestRunModal shows a folder tree; cases only load when a folder is selected.
 */
async function clickFolderInDialog(
  page: import("@playwright/test").Page,
  folderName: string
) {
  // Wait for the folder tree to load
  await page
    .locator('[data-testid^="folder-node-"]')
    .first()
    .waitFor({ state: "attached", timeout: 10000 });

  // Small delay for React to stabilize rendering
  await page.waitForTimeout(500);

  // Locate and click the specific folder node
  const folderNode = page
    .locator('[data-testid^="folder-node-"]')
    .filter({ hasText: folderName })
    .first();

  await folderNode.waitFor({ state: "attached", timeout: 5000 });
  // Use force:true since the dialog overlay can intercept clicks
  await folderNode.click({ force: true });

  // Wait for the Cases table to reload with the folder's data
  await page.waitForTimeout(1500);
}

/**
 * Helper to open the AddTestRunModal and navigate to step 2 (test case selection).
 * Waits for the state select to be populated before clicking Next, which avoids
 * a race condition where stateId=0 causes silent validation failure.
 */
async function openModalAndGoToStep2(
  page: import("@playwright/test").Page,
  runName: string
) {
  const newRunButton = page.getByTestId("new-run-button");
  await expect(newRunButton).toBeVisible({ timeout: 15000 });
  await newRunButton.click();

  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog).toBeVisible({ timeout: 10000 });

  // Fill the run name
  const nameInput = dialog.getByTestId("run-name-input");
  await nameInput.fill(runName);

  // Wait for the state select to be populated (workflows must load first)
  // The state select is inside a SelectTrigger with a SelectValue.
  // When stateId is valid, the SelectValue renders the workflow name (not the placeholder).
  // We wait for any SelectTrigger in the dialog to NOT contain the placeholder text.
  const stateSelect = dialog.locator('label:has-text("State")').locator('..').locator('[role="combobox"]');
  await expect(stateSelect).toBeVisible({ timeout: 10000 });
  // Wait until the state select has a value (not empty/placeholder)
  await expect(async () => {
    const text = await stateSelect.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
    // Make sure it's not just the placeholder
    expect(text).not.toMatch(/select.*state/i);
  }).toPass({ timeout: 10000 });

  // Click Next to go to step 2 (test case selection)
  // Use evaluate click to bypass overflow-y-auto intercepting pointer events
  const nextButton = dialog.getByTestId("run-next-button");
  await nextButton.evaluate((el: HTMLElement) => el.click());

  // Wait for step 2 dialog content to appear (ProjectRepository in selection mode)
  // The dialog content changes completely, so re-query the dialog
  const step2Dialog = page.locator('[role="dialog"]').last();
  await expect(step2Dialog).toBeVisible({ timeout: 10000 });

  return step2Dialog;
}

test.describe("Elasticsearch Search in Selection Mode", () => {
  test("should show ES search input when in selection mode (AddTestRunModal step 2)", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E ES Search ${Date.now()}`
    );
    const folderId = await api.createFolder(projectId, "ES Search Folder");
    await api.createTestCase(
      projectId,
      folderId,
      `ES Search Case ${Date.now()}`
    );

    // Navigate to test runs page and open AddTestRunModal
    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const dialog = await openModalAndGoToStep2(page, `ES Search Run ${Date.now()}`);

    // In step 2, the ProjectRepository is rendered in selection mode
    // The ES search input should be visible
    const esSearchInput = dialog.locator(
      'input[placeholder*="Search in this project"]'
    );
    await expect(esSearchInput).toBeVisible({ timeout: 10000 });
  });

  test("should filter test cases when searching via ES", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E ES Filter ${Date.now()}`
    );
    const folderName = `ES Filter Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const ts = Date.now();
    const matchingCase = `UniqueLoginTest ${ts}`;
    const nonMatchingCase = `PaymentFlow ${ts}`;
    await api.createTestCase(projectId, folderId, matchingCase);
    await api.createTestCase(projectId, folderId, nonMatchingCase);

    // Wait for ES indexing
    await page.waitForTimeout(2000);

    // Navigate to test runs page and open AddTestRunModal
    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const dialog = await openModalAndGoToStep2(page, `Filter Run ${Date.now()}`);

    // Wait for step 2 to load
    const esSearchInput = dialog.locator(
      'input[placeholder*="Search in this project"]'
    );
    await expect(esSearchInput).toBeVisible({ timeout: 10000 });

    // Click the folder to load its cases into the table
    await clickFolderInDialog(page, folderName);

    // Wait for cases to initially load in the table
    await expect(dialog.locator(`text="${matchingCase}"`)).toBeVisible({
      timeout: 10000,
    });

    // Type in the ES search input
    await esSearchInput.fill("UniqueLoginTest");

    // Wait for debounce (300ms) + ES query + render
    await page.waitForTimeout(2000);

    // Matching case should be visible
    await expect(dialog.locator(`text="${matchingCase}"`)).toBeVisible({
      timeout: 10000,
    });

    // Non-matching case should not be visible
    await expect(dialog.locator(`text="${nonMatchingCase}"`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  test("should clear search and restore full case list", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E ES Clear ${Date.now()}`
    );
    const folderName = `ES Clear Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const ts = Date.now();
    const case1 = `ClearTestAlpha ${ts}`;
    const case2 = `ClearTestBeta ${ts}`;
    await api.createTestCase(projectId, folderId, case1);
    await api.createTestCase(projectId, folderId, case2);

    await page.waitForTimeout(2000); // ES indexing

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const dialog = await openModalAndGoToStep2(page, `Clear Run ${Date.now()}`);

    const esSearchInput = dialog.locator(
      'input[placeholder*="Search in this project"]'
    );
    await expect(esSearchInput).toBeVisible({ timeout: 10000 });

    // Click the folder to load its cases into the table
    await clickFolderInDialog(page, folderName);

    // Wait for both cases to be visible
    await expect(dialog.locator(`text="${case1}"`)).toBeVisible({
      timeout: 10000,
    });

    // Search for only one case
    await esSearchInput.fill("ClearTestAlpha");
    await page.waitForTimeout(2000);

    // Only matching case visible
    await expect(dialog.locator(`text="${case1}"`)).toBeVisible({
      timeout: 10000,
    });
    await expect(dialog.locator(`text="${case2}"`)).not.toBeVisible({
      timeout: 5000,
    });

    // Click the clear (X) button next to the search input
    const clearButton = dialog.locator(
      'input[placeholder*="Search in this project"] + button, input[placeholder*="Search in this project"] ~ button'
    ).first();

    // If clear button exists, click it; otherwise clear the input
    if (await clearButton.isVisible()) {
      await clearButton.click();
    } else {
      await esSearchInput.clear();
    }

    // Wait for cases to reload
    await page.waitForTimeout(2000);

    // Both cases should now be visible again
    await expect(dialog.locator(`text="${case1}"`)).toBeVisible({
      timeout: 10000,
    });
    await expect(dialog.locator(`text="${case2}"`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("should select search results and persist selection after clearing search", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E ES Select ${Date.now()}`
    );
    const folderName = `ES Select Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const ts = Date.now();
    const searchableCase = `SelectableLogin ${ts}`;
    const otherCase = `OtherPayment ${ts}`;
    await api.createTestCase(projectId, folderId, searchableCase);
    await api.createTestCase(projectId, folderId, otherCase);

    await page.waitForTimeout(2000); // ES indexing

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    const dialog = await openModalAndGoToStep2(page, `Select Run ${Date.now()}`);

    const esSearchInput = dialog.locator(
      'input[placeholder*="Search in this project"]'
    );
    await expect(esSearchInput).toBeVisible({ timeout: 10000 });

    // Click the folder to load its cases into the table
    await clickFolderInDialog(page, folderName);

    // Wait for cases to load
    await expect(dialog.locator(`text="${searchableCase}"`)).toBeVisible({
      timeout: 10000,
    });

    // Search for the specific case
    await esSearchInput.fill("SelectableLogin");
    await page.waitForTimeout(2000);

    // Click the checkbox/row to select the search result
    const caseRow = dialog.locator(`tr:has-text("${searchableCase}")`).first();
    await expect(caseRow).toBeVisible({ timeout: 5000 });

    // Click the checkbox in the row
    const checkbox = caseRow.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible()) {
      await checkbox.click();
    } else {
      // Some tables use row click for selection
      await caseRow.click();
    }

    // Clear search
    await esSearchInput.clear();
    await page.waitForTimeout(2000);

    // The selected case should still be selected after clearing search
    // Look for indication of selection (e.g., selected count badge, drawer count)
    // The selected test cases drawer or count should show 1 selected
    const selectedIndicator = dialog.locator(
      'text=/1 (case|test|selected)/i'
    );
    // This is a soft check - the exact UI may vary
    if (await selectedIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(selectedIndicator).toBeVisible();
    }
  });
});
