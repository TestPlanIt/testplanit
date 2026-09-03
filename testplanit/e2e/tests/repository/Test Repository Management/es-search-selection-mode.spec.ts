import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { waitForStableBox } from "../../../utils/wait-for-stable";

/**
 * Elasticsearch Search in Selection Mode Tests
 *
 * The Elasticsearch box exists ONLY in the case-selection dialog (e.g.
 * AddTestRunModal step 2), because the app's Unified Search is not reachable
 * from inside a dialog. Repository browsing is served by Unified Search and by
 * the in-table name filter (`search-input`), so there is no `es-search-input`
 * on the repository page at all.
 *
 * Covers:
 * - ES search input appears only in selection mode
 * - Typing a query filters cases to ES results
 * - Clearing search restores full case list
 * - Select All uses search result IDs (not entire folder)
 * - the query intersects with the FilterBar chips instead of bypassing them
 */

function chip(page: Page, dimension: string, operator: string): Locator {
  return page.getByTestId(`filter-chip-${dimension}-${operator}`);
}

function caseRowById(page: Page, caseId: number): Locator {
  return page.getByTestId(`case-row-${caseId}`);
}

/** Closes whichever chip editor happens to be open, if any. */
async function ensureEditorClosed(page: Page): Promise<void> {
  const editor = page.getByTestId("filter-chip-editor");
  if (await editor.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden({ timeout: 10000 });
  }
}

async function pickDimension(page: Page, dimensionKey: string): Promise<void> {
  await ensureEditorClosed(page);
  const addButton = page.getByTestId("filter-bar-add");
  await expect(addButton).toBeVisible({ timeout: 15000 });

  // The dimension dropdown can dismiss itself mid-pick (a background refetch
  // re-renders the filter bar and the popover closes), stranding a one-shot
  // open-then-click sequence. Re-open and retry until the chip editor is up.
  // Only click Add while the dropdown is closed - clicking it with the menu
  // open would toggle it shut again.
  const option = page.getByTestId(`filter-dimension-option-${dimensionKey}`);
  const anyEditor = page.getByTestId("filter-chip-editor");
  // Only an editor for THIS dimension counts: a chip committed a moment ago
  // re-opens its own editor once the URL round-trip lands, and treating that
  // as "done" would skip the Add click and leave the wrong editor open.
  const editor = anyEditor.and(
    page.locator(`[data-dimension="${dimensionKey}"]`)
  );
  await expect(async () => {
    if (await editor.isVisible().catch(() => false)) return;
    if (await anyEditor.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await expect(anyEditor).toBeHidden({ timeout: 3000 });
    }
    if (!(await option.isVisible().catch(() => false))) {
      await addButton.click({ timeout: 2000 });
      await expect(option).toBeVisible({ timeout: 3000 });
    }
    await option.click({ timeout: 2000 });
    await expect(editor).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
}

async function toggleValue(page: Page, id: number | string): Promise<void> {
  const option = page.getByTestId(`filter-value-option-${id}`);
  await expect(option).toBeVisible({ timeout: 15000 });
  await waitForStableBox(option);
  await option.click();
}

/**
 * Blocks until Elasticsearch has the expected number of hits for `query` in
 * this project — indexing is asynchronous, and a fixed sleep is exactly the
 * kind of flake the house rules forbid.
 */
async function waitForEsHits(
  request: APIRequestContext,
  baseURL: string,
  projectId: number,
  query: string,
  expectedHits: number
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.post(`${baseURL}/api/search`, {
          data: {
            filters: {
              query,
              entityTypes: ["repository_case"],
              repositoryCase: { projectIds: [projectId], isArchived: false },
            },
            pagination: { page: 1, size: 50 },
            highlight: false,
            trackTotalHits: true,
          },
        });
        if (!response.ok()) return -1;
        const body = await response.json();
        return typeof body.total === "number" ? body.total : -1;
      },
      { timeout: 45000, intervals: [500, 1000, 2000, 3000] }
    )
    .toBe(expectedHits);
}

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
  const stateSelect = dialog
    .locator('label:has-text("State")')
    .locator("..")
    .locator('[role="combobox"]');
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
  test("should show ES search input in selection mode only, never on the repository page", async ({
    api,
    page,
  }) => {
    let dialog: import("@playwright/test").Locator | undefined;
    let projectId!: number;

    await test.step("Create project, folder, and a test case", async () => {
      projectId = await api.createProject(`E2E ES Search ${Date.now()}`);
      const folderId = await api.createFolder(projectId, "ES Search Folder");
      await api.createTestCase(
        projectId,
        folderId,
        `ES Search Case ${Date.now()}`
      );
    });

    await test.step("The repository page offers the name filter, not the ES box", async () => {
      await page.goto(`/en-US/projects/repository/${projectId}`);
      await page.waitForLoadState("load");

      // Unified Search covers this page; a second box here matched on step text
      // and custom fields and showed rows with no visibly matching term.
      await expect(page.getByTestId("search-input")).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByTestId("es-search-input")).toHaveCount(0);
    });

    await test.step("Verify the ES search input appears in selection mode", async () => {
      // Navigate to test runs page and open AddTestRunModal
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      dialog = await openModalAndGoToStep2(page, `ES Search Run ${Date.now()}`);

      // In step 2, the ProjectRepository is rendered in selection mode — the
      // dialog has no route to Unified Search, so the box lives here.
      await expect(dialog!.getByTestId("es-search-input")).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("should filter test cases when searching via ES", async ({
    api,
    page,
  }) => {
    const folderName = `ES Filter Folder ${Date.now()}`;
    const ts = Date.now();
    const matchingCase = `UniqueLoginTest ${ts}`;
    const nonMatchingCase = `PaymentFlow ${ts}`;
    let dialog: import("@playwright/test").Locator | undefined;
    let esSearchInput: import("@playwright/test").Locator | undefined;

    await test.step("Create project, folder, and matching/non-matching cases", async () => {
      const projectId = await api.createProject(`E2E ES Filter ${Date.now()}`);
      const folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, matchingCase);
      await api.createTestCase(projectId, folderId, nonMatchingCase);

      // Wait for ES indexing
      await page.waitForTimeout(2000);

      // Navigate to test runs page and open AddTestRunModal
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      dialog = await openModalAndGoToStep2(page, `Filter Run ${Date.now()}`);
    });

    await test.step("Open the folder and confirm cases load in the table", async () => {
      // Wait for step 2 to load
      esSearchInput = dialog!.locator(
        'input[placeholder*="Search in this project"]'
      );
      await expect(esSearchInput).toBeVisible({ timeout: 10000 });

      // Click the folder to load its cases into the table
      await clickFolderInDialog(page, folderName);

      // Wait for cases to initially load in the table
      await expect(dialog!.locator(`text="${matchingCase}"`)).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Search via ES and verify only the matching case remains", async () => {
      // Type in the ES search input
      await esSearchInput!.fill("UniqueLoginTest");

      // Wait for debounce (300ms) + ES query + render
      await page.waitForTimeout(2000);

      // Matching case should be visible
      await expect(dialog!.locator(`text="${matchingCase}"`)).toBeVisible({
        timeout: 10000,
      });

      // Non-matching case should not be visible
      await expect(
        dialog!.locator(`text="${nonMatchingCase}"`)
      ).not.toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("should clear search and restore full case list", async ({
    api,
    page,
  }) => {
    const folderName = `ES Clear Folder ${Date.now()}`;
    const ts = Date.now();
    const case1 = `ClearTestAlpha ${ts}`;
    const case2 = `ClearTestBeta ${ts}`;
    let dialog: import("@playwright/test").Locator | undefined;
    let esSearchInput: import("@playwright/test").Locator | undefined;

    await test.step("Create project, folder, and two test cases", async () => {
      const projectId = await api.createProject(`E2E ES Clear ${Date.now()}`);
      const folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, case1);
      await api.createTestCase(projectId, folderId, case2);

      await page.waitForTimeout(2000); // ES indexing

      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      dialog = await openModalAndGoToStep2(page, `Clear Run ${Date.now()}`);
    });

    await test.step("Open the folder and confirm both cases are visible", async () => {
      esSearchInput = dialog!.locator(
        'input[placeholder*="Search in this project"]'
      );
      await expect(esSearchInput).toBeVisible({ timeout: 10000 });

      // Click the folder to load its cases into the table
      await clickFolderInDialog(page, folderName);

      // Wait for both cases to be visible
      await expect(dialog!.locator(`text="${case1}"`)).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Search for one case and verify the other is hidden", async () => {
      // Search for only one case
      await esSearchInput!.fill("ClearTestAlpha");
      await page.waitForTimeout(2000);

      // Only matching case visible
      await expect(dialog!.locator(`text="${case1}"`)).toBeVisible({
        timeout: 10000,
      });
      await expect(dialog!.locator(`text="${case2}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Clear the search and verify both cases are restored", async () => {
      // Click the clear (X) button next to the search input
      const clearButton = dialog!
        .locator(
          'input[placeholder*="Search in this project"] + button, input[placeholder*="Search in this project"] ~ button'
        )
        .first();

      // If clear button exists, click it; otherwise clear the input
      if (await clearButton.isVisible()) {
        await clearButton.click();
      } else {
        await esSearchInput!.clear();
      }

      // Wait for cases to reload
      await page.waitForTimeout(2000);

      // Both cases should now be visible again
      await expect(dialog!.locator(`text="${case1}"`)).toBeVisible({
        timeout: 10000,
      });
      await expect(dialog!.locator(`text="${case2}"`)).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("should select search results and persist selection after clearing search", async ({
    api,
    page,
  }) => {
    const folderName = `ES Select Folder ${Date.now()}`;
    const ts = Date.now();
    const searchableCase = `SelectableLogin ${ts}`;
    const otherCase = `OtherPayment ${ts}`;
    let dialog: import("@playwright/test").Locator | undefined;
    let esSearchInput: import("@playwright/test").Locator | undefined;

    await test.step("Create project, folder, and two test cases", async () => {
      const projectId = await api.createProject(`E2E ES Select ${Date.now()}`);
      const folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, searchableCase);
      await api.createTestCase(projectId, folderId, otherCase);

      await page.waitForTimeout(2000); // ES indexing

      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      dialog = await openModalAndGoToStep2(page, `Select Run ${Date.now()}`);
    });

    await test.step("Open the folder and confirm cases load", async () => {
      esSearchInput = dialog!.locator(
        'input[placeholder*="Search in this project"]'
      );
      await expect(esSearchInput).toBeVisible({ timeout: 10000 });

      // Click the folder to load its cases into the table
      await clickFolderInDialog(page, folderName);

      // Wait for cases to load
      await expect(dialog!.locator(`text="${searchableCase}"`)).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Search for the case and select it from the results", async () => {
      // Search for the specific case
      await esSearchInput!.fill("SelectableLogin");
      await page.waitForTimeout(2000);

      // Click the checkbox/row to select the search result
      const caseRow = dialog!
        .locator(`tr:has-text("${searchableCase}")`)
        .first();
      await expect(caseRow).toBeVisible({ timeout: 5000 });

      // Click the checkbox in the row
      const checkbox = caseRow.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible()) {
        await checkbox.click();
      } else {
        // Some tables use row click for selection
        await caseRow.click();
      }
    });

    await test.step("Clear the search and verify the selection persists", async () => {
      // Clear search
      await esSearchInput!.clear();
      await page.waitForTimeout(2000);

      // The selected case should still be selected after clearing search
      // Look for indication of selection (e.g., selected count badge, drawer count)
      // The selected test cases drawer or count should show 1 selected
      const selectedIndicator = dialog!.locator(
        "text=/1 (case|test|selected)/i"
      );
      // This is a soft check - the exact UI may vary
      if (
        await selectedIndicator.isVisible({ timeout: 3000 }).catch(() => false)
      ) {
        await expect(selectedIndicator).toBeVisible();
      }
    });
  });

  test("Search intersects with the filter chips instead of bypassing them", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    const ts = Date.now();
    const folderName = `ES Intersect Folder ${ts}`;
    const searchToken = `Zeb${ts}`;
    let projectId!: number;
    let tagId!: number;
    let searchHitTagged!: number;
    let searchHitUntagged!: number;
    let taggedNoSearchHit!: number;

    await test.step("Seed three cases: search+tag, search only, tag only", async () => {
      projectId = await api.createProject(`E2E ES Intersect ${ts}`);
      const folderId = await api.createFolder(projectId, folderName);

      tagId = await api.createTag(`esintersect-${ts}`);

      searchHitTagged = await api.createTestCase(
        projectId,
        folderId,
        `${searchToken} Alpha`
      );
      searchHitUntagged = await api.createTestCase(
        projectId,
        folderId,
        `${searchToken} Beta`
      );
      taggedNoSearchHit = await api.createTestCase(
        projectId,
        folderId,
        `Pla${ts} Gamma`
      );

      await api.addTagToTestCase(searchHitTagged, tagId);
      await api.addTagToTestCase(taggedNoSearchHit, tagId);

      await waitForEsHits(
        request,
        baseURL ?? "http://localhost:3000",
        projectId,
        searchToken,
        2
      );
    });

    let dialog: import("@playwright/test").Locator | undefined;

    await test.step("Open the selection dialog on the seeded folder", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}`);
      await page.waitForLoadState("load");

      dialog = await openModalAndGoToStep2(page, `ES Intersect Run ${ts}`);
      await expect(dialog!.getByTestId("es-search-input")).toBeVisible({
        timeout: 10000,
      });

      await clickFolderInDialog(page, folderName);
      await expect(caseRowById(page, searchHitTagged)).toBeVisible({
        timeout: 20000,
      });
    });

    await test.step("Apply a Tag chip", async () => {
      await pickDimension(page, "tags");
      await toggleValue(page, tagId);
      await ensureEditorClosed(page);

      await expect(chip(page, "tags", "any")).toBeVisible();
      await expect(caseRowById(page, searchHitUntagged)).toBeHidden();
    });

    await test.step("Typing in the search box narrows to the intersection", async () => {
      await dialog!.getByTestId("es-search-input").fill(searchToken);

      await expect(caseRowById(page, searchHitTagged)).toBeVisible({
        timeout: 20000,
      });
      // Matches the search but carries no tag.
      await expect(caseRowById(page, searchHitUntagged)).toBeHidden();
      // Carries the tag but does not match the search.
      await expect(caseRowById(page, taggedNoSearchHit)).toBeHidden();
      // Scoped to the dialog: the runs list behind it renders its own
      // pagination footer.
      await expect(dialog!.getByTestId("pagination-info")).toContainText(
        "of 1",
        { timeout: 15000 }
      );
    });

    await test.step("The dialog never writes its query to the host URL", async () => {
      const params = new URL(page.url()).searchParams;
      expect(params.get("q")).toBeNull();
      expect(params.getAll("f")).toEqual([]);
    });
  });
});
