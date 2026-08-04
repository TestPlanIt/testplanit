import type { Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Sorting Tests
 *
 * Comprehensive test cases for sorting test cases in the repository.
 * Tests cover:
 * - All sortable columns: Name, State, ID, Version, Estimate, Template, Created At, Creator, etc.
 * - Sort direction cycles: Default → Ascending → Descending → Default
 * - Pagination with sorting
 * - Actual data order verification
 * - Sorting under an active grouping axis AND an active FilterBar chip
 */

/** The `f` params currently serialized into the URL, form-decoded. */
function filterParams(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll("f");
}

async function expectFilterParam(page: Page, pattern: RegExp): Promise<void> {
  await expect
    .poll(() => filterParams(page).join("|"), { timeout: 10000 })
    .toMatch(pattern);
}
test.describe("Sorting", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    // Add random suffix to prevent name collisions in parallel execution
    const random = Math.random().toString(36).substring(7);
    return await api.createProject(`E2E Test Project ${Date.now()}-${random}`);
  }

  /**
   * Helper function to get the text content of all rows in a specific column
   */
  async function getColumnValues(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string[]> {
    const table = page.locator("table").first();

    // Find the column index by header text
    const headers = table.locator("thead th");
    const headerCount = await headers.count();
    let columnIndex = -1;

    for (let i = 0; i < headerCount; i++) {
      const headerText = await headers.nth(i).textContent();
      if (headerText?.includes(columnName)) {
        columnIndex = i;
        break;
      }
    }

    if (columnIndex === -1) {
      throw new Error(`Column "${columnName}" not found`);
    }

    // Get all values from that column
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    const values: string[] = [];

    for (let i = 0; i < rowCount; i++) {
      const cell = rows.nth(i).locator("td").nth(columnIndex);
      const text = await cell.textContent();
      values.push(text?.trim() || "");
    }

    return values;
  }

  /**
   * Helper function to wait for table to be stable after sort
   */
  async function waitForTableStable(page: import("@playwright/test").Page) {
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    // Wait for network to settle
    await page.waitForLoadState("networkidle");
  }

  /**
   * Helper function to click sort button for a column
   */
  async function clickSortButton(
    page: import("@playwright/test").Page,
    columnName: string
  ) {
    // Advance the sort one step through the same cycle the old toggle button
    // used: Not sorted -> ascending -> descending -> Not sorted, driven through
    // the column header's "Column options" menu.
    const current = await getSortIconState(page, columnName);
    const nextItem =
      current === "Sorted ascending"
        ? "Sort descending"
        : current === "Sorted descending"
          ? "Manual sort"
          : "Sort ascending";
    const button = page
      .locator("table")
      .first()
      .locator("th")
      .filter({ hasText: columnName })
      .first()
      .getByRole("button", { name: "Column options" })
      .first();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible({ timeout: 5000 });
    // Open the menu via keyboard: a pointer click on a neighbouring header can
    // be intercepted by a sticky column (e.g. Name, z-index 21) overlapping it.
    // Keyboard activation has no such interception and also dismisses any menu
    // left open from a previous step.
    await button.focus();
    await button.press("Enter");
    // Scope to the OPEN menu: a menu closed moments earlier is still in the
    // DOM while its exit animation runs, so both it and its items match an
    // unscoped role lookup (strict mode violation).
    const openMenu = page.locator('[role="menu"][data-state="open"]').first();
    await openMenu.waitFor({ state: "visible" });
    const item = openMenu.getByRole("menuitem", { name: nextItem });
    await expect(item).toBeVisible();
    await item.click();

    await waitForTableStable(page);
  }

  /**
   * Helper function to get sort icon state
   */
  async function getSortIconState(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string> {
    // Sort state lives on the indicator icon inside the column header's
    // "Column options" menu button ("Not sorted"/"Sorted ascending"/
    // "Sorted descending"); the chevron is aria-hidden so it is excluded.
    const icon = page
      .locator("table")
      .first()
      .locator("th")
      .filter({ hasText: columnName })
      .first()
      .getByRole("button", { name: "Column options" })
      .first()
      .getByRole("img")
      .first();
    return (await icon.getAttribute("aria-label")) || "";
  }

  /**
   * Helper function to get the number of columns in the table header
   */
  async function getColumnCount(
    page: import("@playwright/test").Page
  ): Promise<number> {
    const table = page.locator("table").first();
    const headers = table.locator("thead th");
    return await headers.count();
  }

  test("Sort Test Cases by Name Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    await test.step("Create a folder with multiple test cases", async () => {
      const folderName = `Sort Name Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, `B Case ${Date.now()}`);
      await api.createTestCase(projectId, folderId, `A Case ${Date.now()}`);
      await api.createTestCase(projectId, folderId, `C Case ${Date.now()}`);
    });

    const table = repositoryPage.casesTable;
    const rows = table.locator("tbody tr");

    await test.step("Open the folder and confirm 3 cases load", async () => {
      await repositoryPage.goto(projectId);

      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Use the cases table specifically - scoped to the right data-testid
      await expect(table).toBeVisible({ timeout: 10000 });

      // Wait for exactly 3 rows (our 3 test cases in this folder)
      await expect(rows).toHaveCount(3, { timeout: 10000 });
    });

    await test.step("Sort by Name and verify rows remain", async () => {
      // Find the Name column sort button
      await clickSortButton(page, "Name");

      // Verify rows still present after sort
      await expect(rows).toHaveCount(3);
    });

    await test.step("Reverse the Name sort and verify rows remain", async () => {
      // Click again to reverse sort
      await clickSortButton(page, "Name");

      // Verify rows still present after reverse sort
      await expect(rows).toHaveCount(3);
    });
  });

  test("Sort Test Cases by State Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort State Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(
        projectId,
        folderId,
        `State Case 1 ${Date.now()}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `State Case 2 ${Date.now()}`
      );
    });

    const table = repositoryPage.casesTable;
    const rows = table.locator("tbody tr");

    await test.step("Open the folder and confirm 2 cases load", async () => {
      await repositoryPage.goto(projectId);

      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Use the cases-table testid — `page.locator("table").first()` can match
      // the folder tree or another table on the page before the cases table
      // hydrates, which produced a "Received: 10" mismatch under load.
      await expect(table).toBeVisible({ timeout: 10000 });

      await expect(rows).toHaveCount(2, { timeout: 10000 });
    });

    await test.step("Sort by State and verify rows remain", async () => {
      // Find the State column sort button
      await clickSortButton(page, "State");

      // Verify rows still present after sort
      await expect(rows).toHaveCount(2);
    });
  });

  test("Maintain Test Case Order Within Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases in specific order
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);

    let folderId: number | undefined;
    await test.step("Create a folder with three ordered test cases", async () => {
      const folderName = `Maintain Order Folder ${timestamp}-${random}`;
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(
        projectId,
        folderId,
        `First Case ${timestamp}-${random}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Second Case ${timestamp}-${random}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Third Case ${timestamp}-${random}`
      );
    });

    // Scope to the cases table (data-row-id rows only) so the count ignores
    // the `pageSize` skeleton rows the DataTable renders while a query/refetch
    // is in flight, which previously produced a "Received: 10" mismatch.
    const table = repositoryPage.casesTable;
    const rows = table.locator("tbody tr[data-row-id]");

    await test.step("Open the folder and confirm 3 rows are shown", async () => {
      await repositoryPage.goto(projectId);

      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Verify the table is visible
      await expect(table).toBeVisible({ timeout: 10000 });

      // Auto-retrying assertion waits out the loading skeleton until the
      // folder's 3 real rows render.
      await expect(rows).toHaveCount(3, { timeout: 10000 });
    });

    await test.step("Reload and confirm the order is maintained", async () => {
      // Navigate away and back
      await page.reload();
      await repositoryPage.waitForRepositoryLoad();
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Verify order is maintained (same number of rows)
      await expect(table).toBeVisible({ timeout: 10000 });
      await expect(rows).toHaveCount(3, { timeout: 10000 });
    });
  });

  test("Sort Cycles Through Default, Ascending, Descending", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort Cycle Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(projectId, folderId, `Alpha Case ${Date.now()}`);
      await api.createTestCase(projectId, folderId, `Beta Case ${Date.now()}`);
    });

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();
    const sortButton = nameHeader
      .getByRole("button", { name: "Column options" })
      .first();
    const sortIcon = sortButton.getByRole("img").first();

    await test.step("Open the folder and confirm the Name sort starts unsorted", async () => {
      await repositoryPage.goto(projectId);

      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      await expect(table).toBeVisible({ timeout: 10000 });

      await expect(rows.first()).toBeVisible({ timeout: 10000 });

      // Find the Name column header menu button
      await expect(sortButton).toBeVisible({ timeout: 5000 });

      // Initial state: "Not sorted" - check the sort icon inside the button
      await expect(sortIcon).toHaveAccessibleName("Not sorted");
    });

    await test.step("First step sorts ascending", async () => {
      await clickSortButton(page, "Name");
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
      await expect(sortIcon).toHaveAccessibleName("Sorted ascending");
    });

    await test.step("Second step sorts descending", async () => {
      await clickSortButton(page, "Name");
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
      await expect(sortIcon).toHaveAccessibleName("Sorted descending");
    });

    await test.step("Third step returns to unsorted", async () => {
      await clickSortButton(page, "Name");
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
      await expect(sortIcon).toHaveAccessibleName("Not sorted");
    });
  });

  test("Verify Name Column Sort Order - Ascending", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with predictably named test cases", async () => {
      const folderName = `Sort Verify Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      // Create cases with names that will sort alphabetically
      await api.createTestCase(
        projectId,
        folderId,
        `Charlie Test ${timestamp}`
      );
      await api.createTestCase(projectId, folderId, `Alpha Test ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Bravo Test ${timestamp}`);
    });

    await test.step("Open the folder and sort by Name ascending", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Click sort to get ascending order
      await clickSortButton(page, "Name");
    });

    await test.step("Verify the Name column is in ascending order", async () => {
      // Wait for the table to settle to exactly the 3 real data rows before
      // reading the column. The DataTable shows skeleton rows (no data-row-id)
      // during the post-sort refetch window, and getColumnValues would
      // otherwise read those placeholders (count 10 = pageSize). Mirrors the
      // toHaveCount pattern the other sorting tests use.
      await expect(
        repositoryPage.casesTable.locator("tbody tr[data-row-id]")
      ).toHaveCount(3, { timeout: 10000 });

      // Get the values from the Name column
      const nameValues = await getColumnValues(page, "Name");

      // Verify they are in ascending alphabetical order
      expect(nameValues.length).toBe(3);
      expect(nameValues[0]).toContain("Alpha");
      expect(nameValues[1]).toContain("Bravo");
      expect(nameValues[2]).toContain("Charlie");
    });
  });

  test("Verify Name Column Sort Order - Descending", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with predictably named test cases", async () => {
      const folderName = `Sort Verify Desc Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      // Create cases with names that will sort alphabetically
      await api.createTestCase(
        projectId,
        folderId,
        `Charlie Test ${timestamp}`
      );
      await api.createTestCase(projectId, folderId, `Alpha Test ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Bravo Test ${timestamp}`);
    });

    await test.step("Open the folder and sort by Name descending", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Click sort twice to get descending order
      await clickSortButton(page, "Name");
      await clickSortButton(page, "Name");
    });

    await test.step("Verify the Name column is in descending order", async () => {
      // Wait for the table to settle to exactly the 3 real data rows before
      // reading the column (skeleton rows during the post-sort refetch have no
      // data-row-id and would otherwise be read as 10 placeholders). Mirrors
      // the Ascending test + the toHaveCount pattern the other sorting tests use.
      await expect(
        repositoryPage.casesTable.locator("tbody tr[data-row-id]")
      ).toHaveCount(3, { timeout: 10000 });

      // Get the values from the Name column
      const nameValues = await getColumnValues(page, "Name");

      // Verify they are in descending alphabetical order
      expect(nameValues.length).toBe(3);
      expect(nameValues[0]).toContain("Charlie");
      expect(nameValues[1]).toContain("Bravo");
      expect(nameValues[2]).toContain("Alpha");
    });
  });

  test("Sort by ID Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with sequentially created test cases", async () => {
      const folderName = `Sort ID Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      // Create 3 test cases - they will have sequential IDs
      await api.createTestCase(projectId, folderId, `First Case ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Second Case ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Third Case ${timestamp}`);
    });

    await test.step("Open the folder and enable the ID column", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // First, we need to make the ID column visible via column selection
      // Open column selection dropdown
      const columnSelectionButton = page.getByTestId(
        "column-selection-trigger"
      );
      if (await columnSelectionButton.isVisible()) {
        await columnSelectionButton.click();

        // Look for the ID checkbox and enable it if not already
        const idCheckbox = page
          .locator("label")
          .filter({ hasText: /^ID$/ })
          .locator('input[type="checkbox"]');
        if (await idCheckbox.isVisible()) {
          const isChecked = await idCheckbox.isChecked();
          if (!isChecked) {
            await idCheckbox.click();
          }
        }

        // Close the dropdown by clicking elsewhere
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    });

    await test.step("Sort the ID column through ascending and descending", async () => {
      // Now sort by ID column
      const table = page.locator("table").first();
      const idHeader = table.locator("th").filter({ hasText: /^ID$/ }).first();

      // Check if ID column is visible
      if (await idHeader.isVisible()) {
        const sortButton = idHeader
          .getByRole("button", { name: "Column options" })
          .first();
        await expect(sortButton).toBeVisible({ timeout: 5000 });

        // Click to sort ascending
        await clickSortButton(page, "ID");
        await waitForTableStable(page);

        // Verify sort icon shows ascending
        const sortIcon = sortButton.getByRole("img").first();
        await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

        // Click again to sort descending
        await clickSortButton(page, "ID");
        await waitForTableStable(page);

        // Verify sort icon shows descending
        await expect(sortIcon).toHaveAccessibleName("Sorted descending");
      }
    });
  });

  test("Sort by Tags Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort Tags Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
    });

    await test.step("Open the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);
    });

    await test.step("Cycle the Tags column sort through all states", async () => {
      // Find and click the Tags column sort button
      const table = page.locator("table").first();
      const tagsHeader = table
        .locator("th")
        .filter({ hasText: "Tags" })
        .first();

      if (await tagsHeader.isVisible()) {
        const sortButton = tagsHeader
          .getByRole("button", { name: "Column options" })
          .first();

        if (await sortButton.isVisible()) {
          // Initial state should be "Not sorted"
          const sortIcon = sortButton.getByRole("img").first();
          await expect(sortIcon).toHaveAccessibleName("Not sorted");

          // Click to sort ascending
          await clickSortButton(page, "Tags");
          await waitForTableStable(page);
          await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

          // Click to sort descending
          await clickSortButton(page, "Tags");
          await waitForTableStable(page);
          await expect(sortIcon).toHaveAccessibleName("Sorted descending");

          // Click to return to default
          await clickSortButton(page, "Tags");
          await waitForTableStable(page);
          await expect(sortIcon).toHaveAccessibleName("Not sorted");
        }
      }
    });
  });

  test("Sorting Persists Across Pagination", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with 15 sortable test cases", async () => {
      // Create a folder with many test cases (more than one page)
      const folderName = `Sort Pagination Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      // Create 15 test cases with alphabetically sortable names
      const names = [
        "Oscar",
        "Alfa",
        "November",
        "Bravo",
        "Mike",
        "Charlie",
        "Lima",
        "Delta",
        "Kilo",
        "Echo",
        "Juliet",
        "Foxtrot",
        "India",
        "Golf",
        "Hotel",
      ];

      for (const name of names) {
        await api.createTestCase(
          projectId,
          folderId,
          `${name} Case ${timestamp}`
        );
      }
    });

    await test.step("Open the folder and sort by Name ascending", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Sort by Name ascending
      await clickSortButton(page, "Name");
      await waitForTableStable(page);
    });

    await test.step("Verify the first page is sorted ascending", async () => {
      // Wait for the table to have content (not empty rows)
      await expect(async () => {
        const firstPageNames = await getColumnValues(page, "Name");
        expect(firstPageNames.length).toBeGreaterThan(0);
        expect(firstPageNames[0]).toBeTruthy(); // Not empty
      }).toPass({ timeout: 5000 });

      // Verify first item is "Alfa" (first alphabetically)
      const firstPageNames = await getColumnValues(page, "Name");
      expect(firstPageNames[0]).toContain("Alfa");

      // Get the sort icon state
      const sortState = await getSortIconState(page, "Name");
      expect(sortState).toBe("Sorted ascending");
    });

    await test.step("Verify the sort persists onto the next page", async () => {
      // Navigate to next page if pagination is available
      const nextPageButton = page
        .getByRole("button", { name: /next|›/i })
        .first();
      if (
        (await nextPageButton.isVisible()) &&
        (await nextPageButton.isEnabled())
      ) {
        await nextPageButton.click();
        await waitForTableStable(page);

        // Verify sort is still ascending after page change
        const sortStateAfterPagination = await getSortIconState(page, "Name");
        expect(sortStateAfterPagination).toBe("Sorted ascending");
      }
    });
  });

  test("Change Sort Column Resets Previous Sort", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort Change Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Zebra Case ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Alpha Case ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Mike Case ${timestamp}`);
    });

    let nameSortState: string | undefined;
    await test.step("Open the folder and sort by Name ascending", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Sort by Name ascending
      await clickSortButton(page, "Name");

      // Verify Name column shows sorted ascending
      nameSortState = await getSortIconState(page, "Name");
      expect(nameSortState).toBe("Sorted ascending");
    });

    await test.step("Sort by State and confirm Name resets to unsorted", async () => {
      // Now sort by State column
      await clickSortButton(page, "State");

      // Verify State column shows sorted ascending
      const stateSortState = await getSortIconState(page, "State");
      expect(stateSortState).toBe("Sorted ascending");

      // Verify Name column is now "Not sorted"
      nameSortState = await getSortIconState(page, "Name");
      expect(nameSortState).toBe("Not sorted");
    });
  });

  test("Sort with Different States", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases in different states", async () => {
      // Get available states for the project
      const stateIds = await api.getStateIds(projectId, 2);

      // Create a folder with test cases having different states
      const folderName = `Sort States Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      // Create test cases with different states
      await api.createTestCaseWithState(
        projectId,
        folderId,
        `State A Case ${timestamp}`,
        stateIds[0]
      );
      if (stateIds.length > 1) {
        await api.createTestCaseWithState(
          projectId,
          folderId,
          `State B Case ${timestamp}`,
          stateIds[1]
        );
      }
      await api.createTestCaseWithState(
        projectId,
        folderId,
        `State C Case ${timestamp}`,
        stateIds[0]
      );
    });

    await test.step("Open the folder and sort by State", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Sort by State column
      await clickSortButton(page, "State");
    });

    await test.step("Verify State is sorted ascending and all rows remain", async () => {
      // Verify sort icon shows ascending
      const sortState = await getSortIconState(page, "State");
      expect(sortState).toBe("Sorted ascending");

      // Verify we still have all rows
      const table = page.locator("table").first();
      const rows = table.locator("tbody tr");
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(2);
    });
  });

  test("Multiple Column Sort Cycles", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Multi Sort Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 3 ${timestamp}`);
    });

    await test.step("Open the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);
    });

    await test.step("Cycle each column through ascending, descending, and reset", async () => {
      // Test cycling through multiple columns
      const columnsToTest = ["Name", "State"];

      for (const columnName of columnsToTest) {
        // Click to ascending
        await clickSortButton(page, columnName);
        let sortState = await getSortIconState(page, columnName);
        expect(sortState).toBe("Sorted ascending");

        // Click to descending
        await clickSortButton(page, columnName);
        sortState = await getSortIconState(page, columnName);
        expect(sortState).toBe("Sorted descending");

        // Click to reset
        await clickSortButton(page, columnName);
        sortState = await getSortIconState(page, columnName);
        expect(sortState).toBe("Not sorted");
      }
    });
  });

  test("Sort Preserves Row Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    const testCaseCount = 5;
    let folderId: number | undefined;
    await test.step("Create a folder with five test cases", async () => {
      const folderName = `Sort Count Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      for (let i = 0; i < testCaseCount; i++) {
        await api.createTestCase(
          projectId,
          folderId,
          `Case ${i + 1} ${timestamp}`
        );
      }
    });

    const table = page.locator("table").first();
    // Use [data-row-id] to count only data rows, excluding expanded sub-rows
    const rows = table.locator("tbody tr[data-row-id]");

    await test.step("Open the folder and confirm initial row count", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Auto-retrying assertion so the count is sampled after the loading
      // skeleton clears, not during the refetch window.
      await expect(rows).toHaveCount(testCaseCount, { timeout: 10000 });
    });

    await test.step("Cycle the sort and verify row count is preserved", async () => {
      // Each sort click triggers a refetch; the DataTable swaps in `pageSize`
      // skeleton rows (no data-row-id) while the query is in flight. Use the
      // auto-retrying assertion so the count is read after the rows repaint,
      // not during the empty skeleton window (which sampled 0 immediately).

      // Sort ascending
      await clickSortButton(page, "Name");
      await expect(rows).toHaveCount(testCaseCount, { timeout: 10000 });

      // Sort descending
      await clickSortButton(page, "Name");
      await expect(rows).toHaveCount(testCaseCount, { timeout: 10000 });

      // Reset sort
      await clickSortButton(page, "Name");
      await expect(rows).toHaveCount(testCaseCount, { timeout: 10000 });
    });
  });

  test("Sort with Search Filter Applied", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort Search Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Alpha Zebra ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Beta Zebra ${timestamp}`);
      await api.createTestCase(
        projectId,
        folderId,
        `Charlie Other ${timestamp}`
      );
    });

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");

    await test.step("Open the folder and search for Zebra", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Apply search filter
      const searchInput = page.getByTestId("search-input");
      await searchInput.fill("Zebra");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600); // Wait for debounce

      // Should have 2 results matching "Zebra"
      await expect(rows).toHaveCount(2, { timeout: 10000 });
    });

    await test.step("Sort the filtered results and verify order", async () => {
      // Now sort by Name
      await clickSortButton(page, "Name");

      // Should still have 2 results
      await expect(rows).toHaveCount(2);

      // Verify sort is applied
      const sortState = await getSortIconState(page, "Name");
      expect(sortState).toBe("Sorted ascending");

      // Verify order - Alpha should come before Beta
      const nameValues = await getColumnValues(page, "Name");
      expect(nameValues[0]).toContain("Alpha");
      expect(nameValues[1]).toContain("Beta");
    });
  });

  test("Sort Icon Visual States", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort Icon Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case A ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case B ${timestamp}`);
    });

    const table = page.locator("table").first();
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();
    const sortButton = nameHeader
      .getByRole("button", { name: "Column options" })
      .first();
    const sortIcon = sortButton.getByRole("img").first();

    await test.step("Open the folder and confirm the unsorted icon", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Verify all three states have correct aria-labels
      await expect(sortIcon).toHaveAccessibleName("Not sorted");
    });

    await test.step("Click through ascending, descending, and back to unsorted", async () => {
      await clickSortButton(page, "Name");
      await waitForTableStable(page);
      await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

      await clickSortButton(page, "Name");
      await waitForTableStable(page);
      await expect(sortIcon).toHaveAccessibleName("Sorted descending");

      await clickSortButton(page, "Name");
      await waitForTableStable(page);
      await expect(sortIcon).toHaveAccessibleName("Not sorted");
    });
  });

  test("Sort Button Accessibility", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with a test case", async () => {
      const folderName = `Sort Access Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
    });

    await test.step("Open the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);
    });

    await test.step("Verify the sort button and icon expose accessible names", async () => {
      const table = page.locator("table").first();
      const nameHeader = table
        .locator("th")
        .filter({ hasText: "Name" })
        .first();

      // Verify sort button has correct accessible name
      const sortButton = nameHeader.getByRole("button", {
        name: "Column options",
      });
      await expect(sortButton).toBeVisible();
      await expect(sortButton).toHaveAttribute("aria-label", "Column options");

      // Verify the sort icon has an accessible name
      const sortIcon = sortButton.getByRole("img").first();
      await expect(sortIcon).toBeVisible();
      const ariaLabel = await sortIcon.getAttribute("aria-label");
      expect(ariaLabel).toBeTruthy();
    });
  });

  test("Rapid Sort Clicks Are Handled Correctly", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Rapid Sort Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 3 ${timestamp}`);
    });

    const table = page.locator("table").first();
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();
    const sortButton = nameHeader
      .getByRole("button", { name: "Column options" })
      .first();

    await test.step("Open the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);
    });

    await test.step("Click the sort button three times in rapid succession", async () => {
      // Rapid clicks - should cycle through states correctly
      await clickSortButton(page, "Name");
      await clickSortButton(page, "Name");
      await clickSortButton(page, "Name");

      // Wait for all operations to complete
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1000);
    });

    await test.step("Verify the sort reset to unsorted and rows are intact", async () => {
      // Should be back to "Not sorted" after 3 clicks
      const sortIcon = sortButton.getByRole("img").first();
      await expect(sortIcon).toHaveAccessibleName("Not sorted");

      // Verify table still has correct number of rows
      const rows = table.locator("tbody tr");
      expect(await rows.count()).toBe(3);
    });
  });

  test("Sort Preserves Header Column Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort Column Count Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case A ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case B ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case C ${timestamp}`);
    });

    let initialHeaderColumnCount: number | undefined;
    await test.step("Open the folder and capture the header column count", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Get initial header column count
      initialHeaderColumnCount = await getColumnCount(page);
      expect(initialHeaderColumnCount).toBeGreaterThan(0);
    });

    await test.step("Cycle the sort and verify header column count is preserved", async () => {
      // Sort ascending
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

      // Sort descending
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

      // Reset sort
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);
    });
  });

  test("Header Column Count Preserved When Switching Sort Columns", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Sort Switch Column Count Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
    });

    let initialHeaderColumnCount: number | undefined;
    await test.step("Open the folder and capture the header column count", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Get initial header column count
      initialHeaderColumnCount = await getColumnCount(page);
      expect(initialHeaderColumnCount).toBeGreaterThan(0);
    });

    await test.step("Switch between columns and cycle Name while checking column count", async () => {
      // Sort by Name
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

      // Switch to State column
      await clickSortButton(page, "State");
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

      // Switch back to Name
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

      // Go through full cycle on Name
      await clickSortButton(page, "Name"); // descending
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

      await clickSortButton(page, "Name"); // reset
      expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);
    });
  });

  test("Header Column Count Preserved After Multiple Sort Operations", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `Multi Sort Column Count Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Alpha ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Beta ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Gamma ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Delta ${timestamp}`);
    });

    let initialHeaderColumnCount: number | undefined;
    await test.step("Open the folder and capture the header column count", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Get initial header column count
      initialHeaderColumnCount = await getColumnCount(page);
    });

    await test.step("Run many sort operations and verify column count after each", async () => {
      // Perform many sort operations
      const sortOperations = [
        "Name",
        "Name",
        "Name", // Full cycle on Name
        "State",
        "State", // Partial cycle on State
        "Name", // Switch back to Name
        "State",
        "State",
        "State", // Full cycle on State
      ];

      for (const column of sortOperations) {
        await clickSortButton(page, column);

        // After each sort operation, verify header column count is preserved
        const currentHeaderCount = await getColumnCount(page);
        expect(currentHeaderCount).toBe(initialHeaderColumnCount);
      }
    });
  });
});

/**
 * ViewSelector + Sorting Integration Tests
 *
 * Tests for sorting behavior when data is filtered through the ViewSelector component.
 * These tests verify that sorting works correctly when a view filter is applied.
 */
test.describe("Sorting with ViewSelector Filters", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Add random suffix to prevent name collisions in parallel execution
    const random = Math.random().toString(36).substring(7);
    return await api.createProject(
      `E2E ViewSort Project ${Date.now()}-${random}`
    );
  }

  async function waitForTableStable(page: import("@playwright/test").Page) {
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");
  }

  async function clickSortButton(
    page: import("@playwright/test").Page,
    columnName: string
  ) {
    // Advance the sort one step through the same cycle the old toggle button
    // used: Not sorted -> ascending -> descending -> Not sorted, driven through
    // the column header's "Column options" menu.
    const current = await getSortIconState(page, columnName);
    const nextItem =
      current === "Sorted ascending"
        ? "Sort descending"
        : current === "Sorted descending"
          ? "Manual sort"
          : "Sort ascending";
    const button = page
      .locator("table")
      .first()
      .locator("th")
      .filter({ hasText: columnName })
      .first()
      .getByRole("button", { name: "Column options" })
      .first();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible({ timeout: 5000 });
    // Open the menu via keyboard: a pointer click on a neighbouring header can
    // be intercepted by a sticky column (e.g. Name, z-index 21) overlapping it.
    // Keyboard activation has no such interception and also dismisses any menu
    // left open from a previous step.
    await button.focus();
    await button.press("Enter");
    // Scope to the OPEN menu: a menu closed moments earlier is still in the
    // DOM while its exit animation runs, so both it and its items match an
    // unscoped role lookup (strict mode violation).
    const openMenu = page.locator('[role="menu"][data-state="open"]').first();
    await openMenu.waitFor({ state: "visible" });
    const item = openMenu.getByRole("menuitem", { name: nextItem });
    await expect(item).toBeVisible();
    await item.click();

    await waitForTableStable(page);
  }

  async function getSortIconState(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string> {
    // Sort state lives on the indicator icon inside the column header's
    // "Column options" menu button ("Not sorted"/"Sorted ascending"/
    // "Sorted descending"); the chevron is aria-hidden so it is excluded.
    const icon = page
      .locator("table")
      .first()
      .locator("th")
      .filter({ hasText: columnName })
      .first()
      .getByRole("button", { name: "Column options" })
      .first()
      .getByRole("img")
      .first();
    return (await icon.getAttribute("aria-label")) || "";
  }

  async function getColumnCount(
    page: import("@playwright/test").Page
  ): Promise<number> {
    const table = page.locator("table").first();
    const headers = table.locator("thead th");
    return await headers.count();
  }

  async function getColumnValues(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string[]> {
    const table = page.locator("table").first();
    const headers = table.locator("thead th");
    const headerCount = await headers.count();
    let columnIndex = -1;

    for (let i = 0; i < headerCount; i++) {
      const headerText = await headers.nth(i).textContent();
      if (headerText?.includes(columnName)) {
        columnIndex = i;
        break;
      }
    }

    if (columnIndex === -1) {
      throw new Error(`Column "${columnName}" not found`);
    }

    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    const values: string[] = [];

    for (let i = 0; i < rowCount; i++) {
      const cell = rows.nth(i).locator("td").nth(columnIndex);
      const text = await cell.textContent();
      values.push(text?.trim() || "");
    }

    return values;
  }

  /**
   * Select a ViewSelector grouping axis. The trigger's test id is
   * `view-selector-trigger` — the older `view-selector` id never matched, so
   * these tests silently skipped the view switch entirely.
   */
  async function selectView(page: Page, viewName: string) {
    const viewSelector = page.getByTestId("view-selector-trigger");
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    const viewOption = page
      .getByRole("option", { name: new RegExp(`^${viewName}$`, "i") })
      .first();
    await expect(viewOption).toBeVisible({ timeout: 5000 });
    await viewOption.click();

    await expect(viewSelector).toContainText(new RegExp(viewName, "i"), {
      timeout: 10000,
    });
    await page.waitForLoadState("networkidle");
  }

  /**
   * Click the first real option row of the current axis (row 0 is the
   * "All …" row) and wait for the resulting filter chip.
   */
  async function applyFirstRowFilter(page: Page, chipTestId: string) {
    const optionRow = page
      .getByTestId("repository-left-panel")
      .locator('[role="button"]')
      .nth(1);
    await expect(optionRow).toBeVisible({ timeout: 10000 });
    await optionRow.click();

    await expect(page.getByTestId(chipTestId)).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");
  }

  test("Sort After Switching to States View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases in different states", async () => {
      // Get available states for the project
      const stateIds = await api.getStateIds(projectId, 2);

      // Create a folder with test cases having different states
      const folderName = `ViewSort States Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCaseWithState(
        projectId,
        folderId,
        `Zebra Case ${timestamp}`,
        stateIds[0]
      );
      await api.createTestCaseWithState(
        projectId,
        folderId,
        `Alpha Case ${timestamp}`,
        stateIds[0]
      );
      if (stateIds.length > 1) {
        await api.createTestCaseWithState(
          projectId,
          folderId,
          `Mike Case ${timestamp}`,
          stateIds[1]
        );
      }
    });

    let initialColumnCount: number | undefined;
    await test.step("Open the folder and switch to the States view", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Get initial column count
      initialColumnCount = await getColumnCount(page);

      // Try to switch to States view if available
      await selectView(page, "State");
      await page.waitForTimeout(500);
    });

    await test.step("Sort by Name and verify sort state and column count", async () => {
      // Sort by Name
      await clickSortButton(page, "Name");

      // Verify sort is applied
      const sortState = await getSortIconState(page, "Name");
      expect(sortState).toBe("Sorted ascending");

      // Verify column count is preserved
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Sort descending
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Sorted descending");
      expect(await getColumnCount(page)).toBe(initialColumnCount);
    });
  });

  test("Sort After Applying Templates View Filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `ViewSort Templates Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(
        projectId,
        folderId,
        `Charlie Case ${timestamp}`
      );
      await api.createTestCase(projectId, folderId, `Alpha Case ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Bravo Case ${timestamp}`);
    });

    let initialColumnCount: number | undefined;
    await test.step("Open the folder and switch to the Templates view", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      initialColumnCount = await getColumnCount(page);

      await selectView(page, "Template");
      await page.waitForTimeout(500);
    });

    await test.step("Apply a template filter chip from the sidebar", async () => {
      // Switching the axis no longer filters anything, so the filter has to
      // be applied explicitly — otherwise the rest of the test would sort an
      // unfiltered table and pass vacuously.
      await applyFirstRowFilter(page, "filter-chip-templates-in");
      await expectFilterParam(page, /templates:in:\d+/);
      await waitForTableStable(page);

      // All three cases use the default template, so they survive the filter.
      const rows = page.locator("table").first().locator("tbody tr");
      await expect(rows).toHaveCount(3, { timeout: 10000 });
    });

    await test.step("Cycle the Name sort and verify state and column count", async () => {
      // Sort by Name ascending
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Sort by Name descending
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Sorted descending");
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Reset sort
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Not sorted");
      expect(await getColumnCount(page)).toBe(initialColumnCount);
    });
  });

  test("Sort After Applying Creators View Filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `ViewSort Creators Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Delta Case ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Alpha Case ${timestamp}`);
    });

    let initialColumnCount: number | undefined;
    await test.step("Open the folder and switch to the Creators view", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      initialColumnCount = await getColumnCount(page);

      await selectView(page, "Creator");
      await page.waitForTimeout(500);
    });

    await test.step("Apply a creator filter chip from the sidebar", async () => {
      // Both cases were created by the same (admin) user, so the chip keeps
      // them while proving the filter is really active.
      await applyFirstRowFilter(page, "filter-chip-creators-in");
      await expectFilterParam(page, /creators:in:.+/);
      await waitForTableStable(page);

      const rows = page.locator("table").first().locator("tbody tr");
      await expect(rows).toHaveCount(2, { timeout: 10000 });
    });

    await test.step("Sort by Name and verify state and column count", async () => {
      // Sort by Name
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");
      expect(await getColumnCount(page)).toBe(initialColumnCount);
      // The chip survives sorting.
      await expect(page.getByTestId("filter-chip-creators-in")).toBeVisible();
    });
  });

  test("Sort Preserves Column Count When Switching Views", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `ViewSort Switch Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case 3 ${timestamp}`);
    });

    let initialColumnCount: number | undefined;
    await test.step("Open the folder and capture the column count", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      initialColumnCount = await getColumnCount(page);
    });

    await test.step("Sort in Folders view and confirm column count", async () => {
      // Apply sort in Folders view
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialColumnCount);
    });

    await test.step("Switch to States view and sort, confirming column count", async () => {
      // Switch to States view
      await selectView(page, "State");
      await page.waitForTimeout(500);
      await waitForTableStable(page);

      // Column count should be preserved
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Apply sort in States view
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialColumnCount);
    });

    await test.step("Switch back to Folders view and confirm column count", async () => {
      // Switch back to Folders view. Choosing the Folders axis clears the
      // folder selection and the tree auto-selects the project's first root
      // folder, which is not this test's folder — re-open it so the column
      // count is measured against the same cases as the earlier steps.
      await selectView(page, "Folders");
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      // Column count should still be preserved
      expect(await getColumnCount(page)).toBe(initialColumnCount);
    });
  });

  test("Sort with Combined Search and ViewSelector Filter", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `ViewSort Combined Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(
        projectId,
        folderId,
        `Alpha Feature ${timestamp}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Beta Feature ${timestamp}`
      );
      await api.createTestCase(projectId, folderId, `Charlie Bug ${timestamp}`);
      await api.createTestCase(
        projectId,
        folderId,
        `Delta Feature ${timestamp}`
      );
    });

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");

    let initialColumnCount: number | undefined;
    await test.step("Open the folder and capture the column count", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      initialColumnCount = await getColumnCount(page);
    });

    await test.step("Apply a state filter chip from the sidebar", async () => {
      // Filter chips and the in-table name filter are independent conditions
      // that AND together — the chip must stay active while the name filter
      // narrows further.
      await selectView(page, "State");
      await applyFirstRowFilter(page, "filter-chip-states-in");
      await expectFilterParam(page, /states:in:\d+/);
      await waitForTableStable(page);

      // All four cases share the seeded default state.
      await expect(rows).toHaveCount(4, { timeout: 10000 });
    });

    await test.step("Search for Feature within the filtered set", async () => {
      // Apply search filter
      const searchInput = page.getByTestId("search-input");
      await searchInput.fill("Feature");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600); // Wait for debounce

      // Should have 3 results matching "Feature"
      await expect(rows).toHaveCount(3, { timeout: 10000 });
      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible();
    });

    await test.step("Sort the filtered results and verify state, count, and order", async () => {
      // Now sort by Name
      await clickSortButton(page, "Name");

      // Should still have 3 results
      await expect(rows).toHaveCount(3);

      // Verify sort is applied
      expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");

      // Verify column count preserved
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Verify order - Alpha should come first
      const nameValues = await getColumnValues(page, "Name");
      expect(nameValues[0]).toContain("Alpha");
      expect(nameValues[1]).toContain("Beta");
      expect(nameValues[2]).toContain("Delta");
    });
  });

  test("Header Column Count Preserved After View Switch and Sort", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    let folderId: number | undefined;
    await test.step("Create a folder with test cases", async () => {
      const folderName = `ViewSort Multi Switch Folder ${timestamp}`;
      folderId = await api.createFolder(projectId, folderName);

      await api.createTestCase(projectId, folderId, `Case A ${timestamp}`);
      await api.createTestCase(projectId, folderId, `Case B ${timestamp}`);
    });

    let initialColumnCount: number | undefined;
    await test.step("Open the folder and sort by Name in the initial view", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await waitForTableStable(page);

      initialColumnCount = await getColumnCount(page);

      // Sort by Name in the initial view
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialColumnCount);
      expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");
    });

    await test.step("Switch to States view, sort again, and verify state and column count", async () => {
      // Try switching to States view if available
      await selectView(page, "State");
      await page.waitForTimeout(300);
      await waitForTableStable(page);

      // Column count should be preserved after view switch
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Sort again after view switch
      await clickSortButton(page, "Name");
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Verify sort is applied (could be ascending or descending depending on state persistence)
      const sortState = await getSortIconState(page, "Name");
      expect(["Sorted ascending", "Sorted descending"]).toContain(sortState);
    });
  });
});

/**
 * Run Mode Sorting Tests
 *
 * Tests for sorting behavior in Test Run execution mode (isRunMode=true).
 * Run mode has different columns (order, assignedTo, status) and
 * sorting works through the TestRunCases relation.
 */
test.describe("Run Mode Sorting", () => {
  async function createTestProjectWithTestRun(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<{
    projectId: number;
    testRunId: number;
    folderId: number;
    caseIds: number[];
  }> {
    // Add random suffix to prevent name collisions in parallel execution
    const random = Math.random().toString(36).substring(7);
    const projectId = await api.createProject(
      `E2E Run Mode Project ${Date.now()}-${random}`
    );
    const folderId = await api.getRootFolderId(projectId);

    // Create test cases with alphabetically sortable names
    const caseIds: number[] = [];
    const timestamp = Date.now();
    const names = ["Charlie Case", "Alpha Case", "Bravo Case"];
    for (const name of names) {
      const caseId = await api.createTestCase(
        projectId,
        folderId,
        `${name} ${timestamp}-${random}`
      );
      caseIds.push(caseId);
    }

    // Create a test run
    const testRunId = await api.createTestRun(
      projectId,
      `Test Run ${Date.now()}`
    );

    // Add test cases to the test run with specific orders
    await api.addTestCaseToTestRun(testRunId, caseIds[0], { order: 3 }); // Charlie - order 3
    await api.addTestCaseToTestRun(testRunId, caseIds[1], { order: 1 }); // Alpha - order 1
    await api.addTestCaseToTestRun(testRunId, caseIds[2], { order: 2 }); // Bravo - order 2

    return { projectId, testRunId, folderId, caseIds };
  }

  async function waitForTableStable(page: import("@playwright/test").Page) {
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState("networkidle");
  }

  async function clickSortButton(
    page: import("@playwright/test").Page,
    columnName: string
  ) {
    const current = await getSortIconState(page, columnName);
    const nextItem =
      current === "Sorted ascending"
        ? "Sort descending"
        : current === "Sorted descending"
          ? "Manual sort"
          : "Sort ascending";
    const button = page
      .locator("table")
      .first()
      .locator("th")
      .filter({ hasText: columnName })
      .first()
      .getByRole("button", { name: "Column options" })
      .first();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible({ timeout: 5000 });
    await button.focus();
    await button.press("Enter");
    // Scope to the OPEN menu: a menu closed moments earlier is still in the
    // DOM while its exit animation runs, so both it and its items match an
    // unscoped role lookup (strict mode violation).
    const openMenu = page.locator('[role="menu"][data-state="open"]').first();
    await openMenu.waitFor({ state: "visible" });
    const item = openMenu.getByRole("menuitem", { name: nextItem });
    await expect(item).toBeVisible();
    await item.click();

    await waitForTableStable(page);
  }

  async function getSortIconState(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string> {
    // Sort state lives on the indicator icon inside the column header's
    // "Column options" menu button ("Not sorted"/"Sorted ascending"/
    // "Sorted descending"); the chevron is aria-hidden so it is excluded.
    const icon = page
      .locator("table")
      .first()
      .locator("th")
      .filter({ hasText: columnName })
      .first()
      .getByRole("button", { name: "Column options" })
      .first()
      .getByRole("img")
      .first();
    return (await icon.getAttribute("aria-label")) || "";
  }

  async function getColumnCount(
    page: import("@playwright/test").Page
  ): Promise<number> {
    const table = page.locator("table").first();
    const headers = table.locator("thead th");
    return await headers.count();
  }

  test("Sort by Name Column in Test Run", async ({ api, page }) => {
    let projectId: number | undefined;
    let testRunId: number | undefined;
    await test.step("Create a project with a test run and cases", async () => {
      ({ projectId, testRunId } = await createTestProjectWithTestRun(api));
    });

    await test.step("Open the test run page", async () => {
      // Navigate to the test run page
      await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
      await waitForTableStable(page);
    });

    await test.step("Cycle the Name sort through all states", async () => {
      // Sort by Name ascending
      await clickSortButton(page, "Name");

      // Verify sort icon shows ascending
      const sortState = await getSortIconState(page, "Name");
      expect(sortState).toBe("Sorted ascending");

      // Sort descending
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Sorted descending");

      // Reset sort
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Not sorted");
    });
  });

  test("Sort by ID Column in Test Run", async ({ api, page }) => {
    let projectId: number | undefined;
    let testRunId: number | undefined;
    await test.step("Create a project with a test run and cases", async () => {
      ({ projectId, testRunId } = await createTestProjectWithTestRun(api));
    });

    await test.step("Open the test run page and enable the ID column", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
      await waitForTableStable(page);

      // First, we need to make the ID column visible via column selection
      const columnSelectionButton = page.getByTestId(
        "column-selection-trigger"
      );
      if (await columnSelectionButton.isVisible()) {
        await columnSelectionButton.click();

        // Look for the ID checkbox and enable it if not already
        const idCheckbox = page
          .locator("label")
          .filter({ hasText: /^ID$/ })
          .locator('input[type="checkbox"]');
        if (await idCheckbox.isVisible()) {
          const isChecked = await idCheckbox.isChecked();
          if (!isChecked) {
            await idCheckbox.click();
          }
        }

        // Close the dropdown by clicking elsewhere
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    });

    await test.step("Sort the ID column through ascending and descending", async () => {
      // Now sort by ID column
      const table = page.locator("table").first();
      const idHeader = table.locator("th").filter({ hasText: /^ID$/ }).first();

      // Check if ID column is visible
      if (await idHeader.isVisible()) {
        const sortButton = idHeader
          .getByRole("button", { name: "Column options" })
          .first();
        await expect(sortButton).toBeVisible({ timeout: 5000 });

        // Sort by ID ascending
        await clickSortButton(page, "ID");
        await waitForTableStable(page);

        // Verify sort icon shows ascending
        const sortIcon = sortButton.getByRole("img").first();
        await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

        // Sort descending
        await clickSortButton(page, "ID");
        await waitForTableStable(page);
        await expect(sortIcon).toHaveAccessibleName("Sorted descending");
      }
    });
  });

  test("Sort with Status Set on Test Run Cases", async ({ api, page }) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);

    let projectId: number | undefined;
    let testRunId: number | undefined;
    await test.step("Create a test run with cases in different statuses", async () => {
      projectId = await api.createProject(
        `E2E Run Mode Status Project ${timestamp}-${random}`
      );
      const folderId = await api.getRootFolderId(projectId);

      // Create test cases
      const caseId1 = await api.createTestCase(
        projectId,
        folderId,
        `Alpha Case ${timestamp}-${random}`
      );
      const caseId2 = await api.createTestCase(
        projectId,
        folderId,
        `Beta Case ${timestamp}-${random}`
      );
      const caseId3 = await api.createTestCase(
        projectId,
        folderId,
        `Charlie Case ${timestamp}-${random}`
      );

      // Create a test run
      testRunId = await api.createTestRun(
        projectId,
        `Status Test Run ${Date.now()}`
      );

      // Get status IDs
      const passedStatusId = await api.getStatusId("passed");
      const failedStatusId = await api.getStatusId("failed");

      // Add cases with different statuses
      const trc1 = await api.addTestCaseToTestRun(testRunId, caseId1, {
        order: 1,
        statusId: passedStatusId,
      });
      const trc2 = await api.addTestCaseToTestRun(testRunId, caseId2, {
        order: 2,
        statusId: failedStatusId,
      });
      await api.addTestCaseToTestRun(testRunId, caseId3, { order: 3 }); // No status

      // Create results for the cases with statuses
      await api.createTestResult(testRunId, trc1, passedStatusId);
      await api.createTestResult(testRunId, trc2, failedStatusId);
    });

    let initialColumnCount: number | undefined;
    await test.step("Open the test run page and capture the column count", async () => {
      await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
      await waitForTableStable(page);

      // Get initial column count
      initialColumnCount = await getColumnCount(page);
    });

    await test.step("Cycle the Name sort and verify state and column count", async () => {
      // Sort by Name
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");

      // Verify column count preserved
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Sort descending
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Sorted descending");
      expect(await getColumnCount(page)).toBe(initialColumnCount);

      // Reset sort
      await clickSortButton(page, "Name");
      expect(await getSortIconState(page, "Name")).toBe("Not sorted");
      expect(await getColumnCount(page)).toBe(initialColumnCount);
    });
  });

  test("Header Column Count Preserved in Run Mode After Sort", async ({
    api,
    page,
  }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    // Get initial header column count
    const initialHeaderColumnCount = await getColumnCount(page);
    expect(initialHeaderColumnCount).toBeGreaterThan(0);

    // Sort ascending
    await clickSortButton(page, "Name");
    expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

    // Sort descending
    await clickSortButton(page, "Name");
    expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);

    // Reset sort
    await clickSortButton(page, "Name");
    expect(await getColumnCount(page)).toBe(initialHeaderColumnCount);
  });

  test("Sort Preserves Row Count in Run Mode", async ({ api, page }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");

    // Run mode seeds an "assigned to me" chip only when the viewer actually
    // has assignments; none of these run cases are assigned, so the table must
    // start unfiltered.
    await expect(page.getByTestId("filter-chip-assignedTo-in")).not.toBeVisible(
      { timeout: 10000 }
    );
    expect(new URL(page.url()).searchParams.getAll("f")).toEqual([]);

    // Initial count should be 3 (we added 3 cases)
    expect(await rows.count()).toBe(3);

    // Sort ascending
    await clickSortButton(page, "Name");
    expect(await rows.count()).toBe(3);

    // Sort descending
    await clickSortButton(page, "Name");
    expect(await rows.count()).toBe(3);

    // Reset sort
    await clickSortButton(page, "Name");
    expect(await rows.count()).toBe(3);
  });

  test("Sort Cycles Through States Correctly in Run Mode", async ({
    api,
    page,
  }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    const table = page.locator("table").first();
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();
    const sortButton = nameHeader
      .getByRole("button", { name: "Column options" })
      .first();
    const sortIcon = sortButton.getByRole("img").first();

    // Initial state: "Not sorted"
    await expect(sortIcon).toHaveAccessibleName("Not sorted");

    // Click 1: Should change to ascending
    await clickSortButton(page, "Name");
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

    // Click 2: Should change to descending
    await clickSortButton(page, "Name");
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Sorted descending");

    // Click 3: Should return to default (not sorted)
    await clickSortButton(page, "Name");
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Not sorted");
  });

  test("Change Sort Column Resets Previous Sort in Run Mode", async ({
    api,
    page,
  }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    // First, we need to make the ID column visible via column selection
    const columnSelectionButton = page.getByTestId("column-selection-trigger");
    if (await columnSelectionButton.isVisible()) {
      await columnSelectionButton.click();

      // Look for the ID checkbox and enable it if not already
      const idCheckbox = page
        .locator("label")
        .filter({ hasText: /^ID$/ })
        .locator('input[type="checkbox"]');
      if (await idCheckbox.isVisible()) {
        const isChecked = await idCheckbox.isChecked();
        if (!isChecked) {
          await idCheckbox.click();
        }
      }

      // Close the dropdown by clicking elsewhere
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }

    // Sort by Name ascending
    await clickSortButton(page, "Name");
    expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");

    // Now sort by ID column (instead of State which has click interception issues)
    const table = page.locator("table").first();
    const idHeader = table.locator("th").filter({ hasText: /^ID$/ }).first();

    if (await idHeader.isVisible()) {
      const sortButton = idHeader
        .getByRole("button", { name: "Column options" })
        .first();
      await expect(sortButton).toBeVisible({ timeout: 5000 });
      await clickSortButton(page, "ID");
      await waitForTableStable(page);

      const sortIcon = sortButton.getByRole("img").first();
      await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

      // Verify Name column is now "Not sorted"
      expect(await getSortIconState(page, "Name")).toBe("Not sorted");
    }
  });
});
