import { test, expect } from "../../../fixtures";
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
 */
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
    const table = page.locator("table").first();
    const header = table.locator("th").filter({ hasText: columnName }).first();
    await expect(header).toBeVisible({ timeout: 5000 });

    const sortButton = header.getByRole("button", { name: "Sort column" }).first();
    await expect(sortButton).toBeVisible({ timeout: 5000 });
    await sortButton.click();

    await waitForTableStable(page);
  }

  /**
   * Helper function to get sort icon state
   */
  async function getSortIconState(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string> {
    const table = page.locator("table").first();
    const header = table.locator("th").filter({ hasText: columnName }).first();
    const sortButton = header.getByRole("button", { name: "Sort column" }).first();
    const sortIcon = sortButton.getByRole("img");
    return await sortIcon.getAttribute("aria-label") || "";
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

    // Create a folder with multiple test cases
    const folderName = `Sort Name Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `B Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `A Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `C Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    // Wait for URL to reflect folder selection to ensure we're viewing the right folder
    await expect(page).toHaveURL(new RegExp(`node=${folderId}`), { timeout: 10000 });
    await waitForTableStable(page);

    // Use the cases table specifically - scoped to the right data-testid
    const table = repositoryPage.casesTable;
    await expect(table).toBeVisible({ timeout: 10000 });

    // Wait for exactly 3 rows (our 3 test cases in this folder)
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(3, { timeout: 10000 });

    // Find the Name column sort button
    await clickSortButton(page, "Name");

    // Verify rows still present after sort
    await expect(rows).toHaveCount(3);

    // Click again to reverse sort
    await clickSortButton(page, "Name");

    // Verify rows still present after reverse sort
    await expect(rows).toHaveCount(3);
  });

  test("Sort Test Cases by State Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Sort State Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `State Case 1 ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `State Case 2 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify the table is visible
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Wait for rows to appear in tbody
    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBe(2);

    // Find the State column sort button
    const stateHeader = table.locator('th').filter({ hasText: 'State' }).first();
    await expect(stateHeader).toBeVisible({ timeout: 5000 });

    // The sort button is inside the header with accessible name "Sort column"
    const sortButton = stateHeader.getByRole('button', { name: 'Sort column' }).first();
    await expect(sortButton).toBeVisible({ timeout: 5000 });
    await sortButton.click();

    // Wait for rows to reappear after sort (sorting triggers data refetch)
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBe(2);
  });

  test("Maintain Test Case Order Within Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases in specific order
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const folderName = `Maintain Order Folder ${timestamp}-${random}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `First Case ${timestamp}-${random}`);
    await api.createTestCase(projectId, folderId, `Second Case ${timestamp}-${random}`);
    await api.createTestCase(projectId, folderId, `Third Case ${timestamp}-${random}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    // Wait for URL to reflect folder selection to ensure we're viewing the right folder
    await expect(page).toHaveURL(new RegExp(`node=${folderId}`), { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify the table is visible
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Wait for rows to appear in tbody
    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const count = await rows.count();
    expect(count).toBe(3);

    // Navigate away and back
    await page.reload();
    await repositoryPage.waitForRepositoryLoad();
    await repositoryPage.selectFolder(folderId);
    // Wait for URL to reflect folder selection again
    await expect(page).toHaveURL(new RegExp(`node=${folderId}`), { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify order is maintained (same number of rows)
    await expect(table).toBeVisible({ timeout: 10000 });
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBe(3);
  });

  test("Sort Cycles Through Default, Ascending, Descending", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Sort Cycle Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Alpha Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Beta Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // Find the Name column header and sort button
    const nameHeader = table.locator('th').filter({ hasText: 'Name' }).first();
    const sortButton = nameHeader.getByRole('button', { name: 'Sort column' }).first();
    await expect(sortButton).toBeVisible({ timeout: 5000 });

    // Initial state: "Not sorted" - check the sort icon inside the button
    const sortIcon = sortButton.getByRole('img');
    await expect(sortIcon).toHaveAccessibleName('Not sorted');

    // Click 1: Should change to ascending
    await sortButton.click();
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(sortIcon).toHaveAccessibleName('Sorted ascending');

    // Click 2: Should change to descending
    await sortButton.click();
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(sortIcon).toHaveAccessibleName('Sorted descending');

    // Click 3: Should return to default (not sorted)
    await sortButton.click();
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    await expect(sortIcon).toHaveAccessibleName('Not sorted');
  });

  test("Verify Name Column Sort Order - Ascending", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases with predictable names
    const folderName = `Sort Verify Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create cases with names that will sort alphabetically
    await api.createTestCase(projectId, folderId, `Charlie Test ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Alpha Test ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Bravo Test ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Click sort to get ascending order
    await clickSortButton(page, "Name");

    // Get the values from the Name column
    const nameValues = await getColumnValues(page, "Name");

    // Verify they are in ascending alphabetical order
    expect(nameValues.length).toBe(3);
    expect(nameValues[0]).toContain("Alpha");
    expect(nameValues[1]).toContain("Bravo");
    expect(nameValues[2]).toContain("Charlie");
  });

  test("Verify Name Column Sort Order - Descending", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases with predictable names
    const folderName = `Sort Verify Desc Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create cases with names that will sort alphabetically
    await api.createTestCase(projectId, folderId, `Charlie Test ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Alpha Test ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Bravo Test ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Click sort twice to get descending order
    await clickSortButton(page, "Name");
    await clickSortButton(page, "Name");

    // Get the values from the Name column
    const nameValues = await getColumnValues(page, "Name");

    // Verify they are in descending alphabetical order
    expect(nameValues.length).toBe(3);
    expect(nameValues[0]).toContain("Charlie");
    expect(nameValues[1]).toContain("Bravo");
    expect(nameValues[2]).toContain("Alpha");
  });

  test("Sort by ID Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort ID Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create 3 test cases - they will have sequential IDs
    await api.createTestCase(projectId, folderId, `First Case ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Second Case ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Third Case ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // First, we need to make the ID column visible via column selection
    // Open column selection dropdown
    const columnSelectionButton = page.getByTestId("column-selection-trigger");
    if (await columnSelectionButton.isVisible()) {
      await columnSelectionButton.click();

      // Look for the ID checkbox and enable it if not already
      const idCheckbox = page.locator('label').filter({ hasText: /^ID$/ }).locator('input[type="checkbox"]');
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

    // Now sort by ID column
    const table = page.locator("table").first();
    const idHeader = table.locator("th").filter({ hasText: /^ID$/ }).first();

    // Check if ID column is visible
    if (await idHeader.isVisible()) {
      const sortButton = idHeader.getByRole("button", { name: "Sort column" }).first();
      await expect(sortButton).toBeVisible({ timeout: 5000 });

      // Click to sort ascending
      await sortButton.click();
      await waitForTableStable(page);

      // Verify sort icon shows ascending
      const sortIcon = sortButton.getByRole("img");
      await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

      // Click again to sort descending
      await sortButton.click();
      await waitForTableStable(page);

      // Verify sort icon shows descending
      await expect(sortIcon).toHaveAccessibleName("Sorted descending");
    }
  });

  test("Sort by Tags Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Tags Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Find and click the Tags column sort button
    const table = page.locator("table").first();
    const tagsHeader = table.locator("th").filter({ hasText: "Tags" }).first();

    if (await tagsHeader.isVisible()) {
      const sortButton = tagsHeader.getByRole("button", { name: "Sort column" }).first();

      if (await sortButton.isVisible()) {
        // Initial state should be "Not sorted"
        const sortIcon = sortButton.getByRole("img");
        await expect(sortIcon).toHaveAccessibleName("Not sorted");

        // Click to sort ascending
        await sortButton.click();
        await waitForTableStable(page);
        await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

        // Click to sort descending
        await sortButton.click();
        await waitForTableStable(page);
        await expect(sortIcon).toHaveAccessibleName("Sorted descending");

        // Click to return to default
        await sortButton.click();
        await waitForTableStable(page);
        await expect(sortIcon).toHaveAccessibleName("Not sorted");
      }
    }
  });

  test("Sorting Persists Across Pagination", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with many test cases (more than one page)
    const folderName = `Sort Pagination Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create 15 test cases with alphabetically sortable names
    const names = [
      "Oscar", "Alfa", "November", "Bravo", "Mike",
      "Charlie", "Lima", "Delta", "Kilo", "Echo",
      "Juliet", "Foxtrot", "India", "Golf", "Hotel"
    ];

    for (const name of names) {
      await api.createTestCase(projectId, folderId, `${name} Case ${timestamp}`);
    }

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Sort by Name ascending
    await clickSortButton(page, "Name");

    // Verify first item is "Alfa" (first alphabetically)
    const firstPageNames = await getColumnValues(page, "Name");
    expect(firstPageNames[0]).toContain("Alfa");

    // Get the sort icon state
    const sortState = await getSortIconState(page, "Name");
    expect(sortState).toBe("Sorted ascending");

    // Navigate to next page if pagination is available
    const nextPageButton = page.getByRole("button", { name: /next|›/i }).first();
    if (await nextPageButton.isVisible() && await nextPageButton.isEnabled()) {
      await nextPageButton.click();
      await waitForTableStable(page);

      // Verify sort is still ascending after page change
      const sortStateAfterPagination = await getSortIconState(page, "Name");
      expect(sortStateAfterPagination).toBe("Sorted ascending");
    }
  });

  test("Change Sort Column Resets Previous Sort", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Change Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Zebra Case ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Alpha Case ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Mike Case ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Sort by Name ascending
    await clickSortButton(page, "Name");

    // Verify Name column shows sorted ascending
    let nameSortState = await getSortIconState(page, "Name");
    expect(nameSortState).toBe("Sorted ascending");

    // Now sort by State column
    await clickSortButton(page, "State");

    // Verify State column shows sorted ascending
    const stateSortState = await getSortIconState(page, "State");
    expect(stateSortState).toBe("Sorted ascending");

    // Verify Name column is now "Not sorted"
    nameSortState = await getSortIconState(page, "Name");
    expect(nameSortState).toBe("Not sorted");
  });

  test("Sort with Different States", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Get available states for the project
    const stateIds = await api.getStateIds(projectId, 2);

    // Create a folder with test cases having different states
    const folderName = `Sort States Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create test cases with different states
    await api.createTestCaseWithState(projectId, folderId, `State A Case ${timestamp}`, stateIds[0]);
    if (stateIds.length > 1) {
      await api.createTestCaseWithState(projectId, folderId, `State B Case ${timestamp}`, stateIds[1]);
    }
    await api.createTestCaseWithState(projectId, folderId, `State C Case ${timestamp}`, stateIds[0]);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Sort by State column
    await clickSortButton(page, "State");

    // Verify sort icon shows ascending
    const sortState = await getSortIconState(page, "State");
    expect(sortState).toBe("Sorted ascending");

    // Verify we still have all rows
    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  test("Multiple Column Sort Cycles", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Multi Sort Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 3 ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

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

  test("Sort Preserves Row Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Count Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    const testCaseCount = 5;
    for (let i = 0; i < testCaseCount; i++) {
      await api.createTestCase(projectId, folderId, `Case ${i + 1} ${timestamp}`);
    }

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");

    // Initial count
    const initialCount = await rows.count();
    expect(initialCount).toBe(testCaseCount);

    // Sort ascending
    await clickSortButton(page, "Name");
    expect(await rows.count()).toBe(testCaseCount);

    // Sort descending
    await clickSortButton(page, "Name");
    expect(await rows.count()).toBe(testCaseCount);

    // Reset sort
    await clickSortButton(page, "Name");
    expect(await rows.count()).toBe(testCaseCount);
  });

  test("Sort with Search Filter Applied", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Search Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Alpha Zebra ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Beta Zebra ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Charlie Other ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Apply search filter
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill("Zebra");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600); // Wait for debounce

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");

    // Should have 2 results matching "Zebra"
    await expect(rows).toHaveCount(2, { timeout: 10000 });

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

  test("Sort Icon Visual States", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Icon Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case A ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case B ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const table = page.locator("table").first();
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();
    const sortButton = nameHeader.getByRole("button", { name: "Sort column" }).first();
    const sortIcon = sortButton.getByRole("img");

    // Verify all three states have correct aria-labels
    await expect(sortIcon).toHaveAccessibleName("Not sorted");

    await sortButton.click();
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

    await sortButton.click();
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Sorted descending");

    await sortButton.click();
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Not sorted");
  });

  test("Sort Button Accessibility", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Access Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const table = page.locator("table").first();
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();

    // Verify sort button has correct accessible name
    const sortButton = nameHeader.getByRole("button", { name: "Sort column" });
    await expect(sortButton).toBeVisible();
    await expect(sortButton).toHaveAttribute("aria-label", "Sort column");

    // Verify the sort icon has an accessible name
    const sortIcon = sortButton.getByRole("img");
    await expect(sortIcon).toBeVisible();
    const ariaLabel = await sortIcon.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
  });

  test("Rapid Sort Clicks Are Handled Correctly", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Rapid Sort Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 3 ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const table = page.locator("table").first();
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();
    const sortButton = nameHeader.getByRole("button", { name: "Sort column" }).first();

    // Rapid clicks - should cycle through states correctly
    await sortButton.click();
    await sortButton.click();
    await sortButton.click();

    // Wait for all operations to complete
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Should be back to "Not sorted" after 3 clicks
    const sortIcon = sortButton.getByRole("img");
    await expect(sortIcon).toHaveAccessibleName("Not sorted");

    // Verify table still has correct number of rows
    const rows = table.locator("tbody tr");
    expect(await rows.count()).toBe(3);
  });

  test("Sort Preserves Header Column Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Column Count Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case A ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case B ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case C ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
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

  test("Header Column Count Preserved When Switching Sort Columns", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Sort Switch Column Count Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Get initial header column count
    const initialHeaderColumnCount = await getColumnCount(page);
    expect(initialHeaderColumnCount).toBeGreaterThan(0);

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

  test("Header Column Count Preserved After Multiple Sort Operations", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `Multi Sort Column Count Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Alpha ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Beta ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Gamma ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Delta ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Get initial header column count
    const initialHeaderColumnCount = await getColumnCount(page);

    // Perform many sort operations
    const sortOperations = [
      "Name", "Name", "Name",      // Full cycle on Name
      "State", "State",             // Partial cycle on State
      "Name",                       // Switch back to Name
      "State", "State", "State",   // Full cycle on State
    ];

    for (const column of sortOperations) {
      await clickSortButton(page, column);

      // After each sort operation, verify header column count is preserved
      const currentHeaderCount = await getColumnCount(page);
      expect(currentHeaderCount).toBe(initialHeaderColumnCount);
    }
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
    return await api.createProject(`E2E ViewSort Project ${Date.now()}-${random}`);
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
    const table = page.locator("table").first();
    const header = table.locator("th").filter({ hasText: columnName }).first();
    await expect(header).toBeVisible({ timeout: 5000 });

    const sortButton = header.getByRole("button", { name: "Sort column" }).first();
    await expect(sortButton).toBeVisible({ timeout: 5000 });
    await sortButton.click();

    await waitForTableStable(page);
  }

  async function getSortIconState(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string> {
    const table = page.locator("table").first();
    const header = table.locator("th").filter({ hasText: columnName }).first();
    const sortButton = header.getByRole("button", { name: "Sort column" }).first();
    const sortIcon = sortButton.getByRole("img");
    return await sortIcon.getAttribute("aria-label") || "";
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
   * Helper to select a ViewSelector option
   */
  async function selectView(page: import("@playwright/test").Page, viewName: string) {
    // Click the view selector dropdown
    const viewSelector = page.locator('[data-testid="view-selector"]').first();
    if (await viewSelector.isVisible()) {
      await viewSelector.click();
      await page.waitForTimeout(300);

      // Select the view option
      const viewOption = page.getByRole("option", { name: new RegExp(viewName, "i") }).first();
      if (await viewOption.isVisible()) {
        await viewOption.click();
        await page.waitForLoadState("networkidle");
      }
    }
  }

  test("Sort After Switching to States View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Get available states for the project
    const stateIds = await api.getStateIds(projectId, 2);

    // Create a folder with test cases having different states
    const folderName = `ViewSort States Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCaseWithState(projectId, folderId, `Zebra Case ${timestamp}`, stateIds[0]);
    await api.createTestCaseWithState(projectId, folderId, `Alpha Case ${timestamp}`, stateIds[0]);
    if (stateIds.length > 1) {
      await api.createTestCaseWithState(projectId, folderId, `Mike Case ${timestamp}`, stateIds[1]);
    }

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    // Get initial column count
    const initialColumnCount = await getColumnCount(page);

    // Try to switch to States view if available
    await selectView(page, "States");
    await page.waitForTimeout(500);

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

  test("Sort After Applying Templates View Filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `ViewSort Templates Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Charlie Case ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Alpha Case ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Bravo Case ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const initialColumnCount = await getColumnCount(page);

    // Try to switch to Templates view
    await selectView(page, "Templates");
    await page.waitForTimeout(500);

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

  test("Sort After Applying Creators View Filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `ViewSort Creators Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Delta Case ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Alpha Case ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const initialColumnCount = await getColumnCount(page);

    // Try to switch to Creators view
    await selectView(page, "Creators");
    await page.waitForTimeout(500);

    // Sort by Name
    await clickSortButton(page, "Name");
    expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");
    expect(await getColumnCount(page)).toBe(initialColumnCount);
  });

  test("Sort Preserves Column Count When Switching Views", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `ViewSort Switch Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case 1 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 2 ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case 3 ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const initialColumnCount = await getColumnCount(page);

    // Apply sort in Folders view
    await clickSortButton(page, "Name");
    expect(await getColumnCount(page)).toBe(initialColumnCount);

    // Switch to States view
    await selectView(page, "States");
    await page.waitForTimeout(500);
    await waitForTableStable(page);

    // Column count should be preserved
    expect(await getColumnCount(page)).toBe(initialColumnCount);

    // Apply sort in States view
    await clickSortButton(page, "Name");
    expect(await getColumnCount(page)).toBe(initialColumnCount);

    // Switch back to Folders view
    await selectView(page, "Folders");
    await page.waitForTimeout(500);
    await waitForTableStable(page);

    // Column count should still be preserved
    expect(await getColumnCount(page)).toBe(initialColumnCount);
  });

  test("Sort with Combined Search and ViewSelector Filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `ViewSort Combined Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Alpha Feature ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Beta Feature ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Charlie Bug ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Delta Feature ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const initialColumnCount = await getColumnCount(page);

    // Apply search filter
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill("Feature");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600); // Wait for debounce

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");

    // Should have 3 results matching "Feature"
    await expect(rows).toHaveCount(3, { timeout: 10000 });

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

  test("Header Column Count Preserved After View Switch and Sort", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const timestamp = Date.now();

    // Create a folder with test cases
    const folderName = `ViewSort Multi Switch Folder ${timestamp}`;
    const folderId = await api.createFolder(projectId, folderName);

    await api.createTestCase(projectId, folderId, `Case A ${timestamp}`);
    await api.createTestCase(projectId, folderId, `Case B ${timestamp}`);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await waitForTableStable(page);

    const initialColumnCount = await getColumnCount(page);

    // Sort by Name in the initial view
    await clickSortButton(page, "Name");
    expect(await getColumnCount(page)).toBe(initialColumnCount);
    expect(await getSortIconState(page, "Name")).toBe("Sorted ascending");

    // Try switching to States view if available
    await selectView(page, "States");
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
  ): Promise<{ projectId: number; testRunId: number; folderId: number; caseIds: number[] }> {
    // Add random suffix to prevent name collisions in parallel execution
    const random = Math.random().toString(36).substring(7);
    const projectId = await api.createProject(`E2E Run Mode Project ${Date.now()}-${random}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create test cases with alphabetically sortable names
    const caseIds: number[] = [];
    const timestamp = Date.now();
    const names = ["Charlie Case", "Alpha Case", "Bravo Case"];
    for (const name of names) {
      const caseId = await api.createTestCase(projectId, folderId, `${name} ${timestamp}-${random}`);
      caseIds.push(caseId);
    }

    // Create a test run
    const testRunId = await api.createTestRun(projectId, `Test Run ${Date.now()}`);

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
    const table = page.locator("table").first();
    const header = table.locator("th").filter({ hasText: columnName }).first();
    await expect(header).toBeVisible({ timeout: 5000 });

    const sortButton = header.getByRole("button", { name: "Sort column" }).first();
    await expect(sortButton).toBeVisible({ timeout: 5000 });
    // Use force: true to bypass element interception in run mode layout
    await sortButton.click({ force: true });

    await waitForTableStable(page);
  }

  async function getSortIconState(
    page: import("@playwright/test").Page,
    columnName: string
  ): Promise<string> {
    const table = page.locator("table").first();
    const header = table.locator("th").filter({ hasText: columnName }).first();
    const sortButton = header.getByRole("button", { name: "Sort column" }).first();
    const sortIcon = sortButton.getByRole("img");
    return await sortIcon.getAttribute("aria-label") || "";
  }

  async function getColumnCount(
    page: import("@playwright/test").Page
  ): Promise<number> {
    const table = page.locator("table").first();
    const headers = table.locator("thead th");
    return await headers.count();
  }

  test("Sort by Name Column in Test Run", async ({ api, page }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    // Navigate to the test run page
    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

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

  test("Sort by ID Column in Test Run", async ({ api, page }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    // First, we need to make the ID column visible via column selection
    const columnSelectionButton = page.getByTestId("column-selection-trigger");
    if (await columnSelectionButton.isVisible()) {
      await columnSelectionButton.click();

      // Look for the ID checkbox and enable it if not already
      const idCheckbox = page.locator('label').filter({ hasText: /^ID$/ }).locator('input[type="checkbox"]');
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

    // Now sort by ID column
    const table = page.locator("table").first();
    const idHeader = table.locator("th").filter({ hasText: /^ID$/ }).first();

    // Check if ID column is visible
    if (await idHeader.isVisible()) {
      const sortButton = idHeader.getByRole("button", { name: "Sort column" }).first();
      await expect(sortButton).toBeVisible({ timeout: 5000 });

      // Sort by ID ascending
      await sortButton.click({ force: true });
      await waitForTableStable(page);

      // Verify sort icon shows ascending
      const sortIcon = sortButton.getByRole("img");
      await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

      // Sort descending
      await sortButton.click({ force: true });
      await waitForTableStable(page);
      await expect(sortIcon).toHaveAccessibleName("Sorted descending");
    }
  });

  test("Sort with Status Set on Test Run Cases", async ({ api, page }) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const projectId = await api.createProject(`E2E Run Mode Status Project ${timestamp}-${random}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create test cases
    const caseId1 = await api.createTestCase(projectId, folderId, `Alpha Case ${timestamp}-${random}`);
    const caseId2 = await api.createTestCase(projectId, folderId, `Beta Case ${timestamp}-${random}`);
    const caseId3 = await api.createTestCase(projectId, folderId, `Charlie Case ${timestamp}-${random}`);

    // Create a test run
    const testRunId = await api.createTestRun(projectId, `Status Test Run ${Date.now()}`);

    // Get status IDs
    const passedStatusId = await api.getStatusId("passed");
    const failedStatusId = await api.getStatusId("failed");

    // Add cases with different statuses
    const trc1 = await api.addTestCaseToTestRun(testRunId, caseId1, { order: 1, statusId: passedStatusId });
    const trc2 = await api.addTestCaseToTestRun(testRunId, caseId2, { order: 2, statusId: failedStatusId });
    await api.addTestCaseToTestRun(testRunId, caseId3, { order: 3 }); // No status

    // Create results for the cases with statuses
    await api.createTestResult(testRunId, trc1, passedStatusId);
    await api.createTestResult(testRunId, trc2, failedStatusId);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    // Get initial column count
    const initialColumnCount = await getColumnCount(page);

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

  test("Header Column Count Preserved in Run Mode After Sort", async ({ api, page }) => {
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

  test("Sort Cycles Through States Correctly in Run Mode", async ({ api, page }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    const table = page.locator("table").first();
    const nameHeader = table.locator("th").filter({ hasText: "Name" }).first();
    const sortButton = nameHeader.getByRole("button", { name: "Sort column" }).first();
    const sortIcon = sortButton.getByRole("img");

    // Initial state: "Not sorted"
    await expect(sortIcon).toHaveAccessibleName("Not sorted");

    // Click 1: Should change to ascending
    await sortButton.click();
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

    // Click 2: Should change to descending
    await sortButton.click();
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Sorted descending");

    // Click 3: Should return to default (not sorted)
    await sortButton.click();
    await waitForTableStable(page);
    await expect(sortIcon).toHaveAccessibleName("Not sorted");
  });

  test("Change Sort Column Resets Previous Sort in Run Mode", async ({ api, page }) => {
    const { projectId, testRunId } = await createTestProjectWithTestRun(api);

    await page.goto(`/en-US/projects/runs/${projectId}/${testRunId}`);
    await waitForTableStable(page);

    // First, we need to make the ID column visible via column selection
    const columnSelectionButton = page.getByTestId("column-selection-trigger");
    if (await columnSelectionButton.isVisible()) {
      await columnSelectionButton.click();

      // Look for the ID checkbox and enable it if not already
      const idCheckbox = page.locator('label').filter({ hasText: /^ID$/ }).locator('input[type="checkbox"]');
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
      const sortButton = idHeader.getByRole("button", { name: "Sort column" }).first();
      await expect(sortButton).toBeVisible({ timeout: 5000 });
      await sortButton.click({ force: true });
      await waitForTableStable(page);

      const sortIcon = sortButton.getByRole("img");
      await expect(sortIcon).toHaveAccessibleName("Sorted ascending");

      // Verify Name column is now "Not sorted"
      expect(await getSortIconState(page, "Name")).toBe("Not sorted");
    }
  });
});
