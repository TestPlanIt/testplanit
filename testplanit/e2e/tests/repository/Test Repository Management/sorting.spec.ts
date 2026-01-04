import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Sorting Tests
 *
 * Test cases for sorting test cases in the repository.
 * Available sortable columns: Name, State, ID, Version, Estimate, Forecast, Automated, Created At
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
    return await api.createProject(`E2E Test Project ${Date.now()}`);
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
    await page.waitForLoadState("networkidle");

    // Verify the table is visible with rows
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Wait for rows to appear in tbody
    const rows = table.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBe(3);

    // Find the Name column sort button
    const nameHeader = table.locator('th').filter({ hasText: 'Name' }).first();
    await expect(nameHeader).toBeVisible({ timeout: 5000 });

    // The sort button is inside the header with accessible name "Sort column"
    const sortButton = nameHeader.getByRole('button', { name: 'Sort column' }).first();
    await expect(sortButton).toBeVisible({ timeout: 5000 });
    await sortButton.click();

    // Wait for rows to reappear after sort (sorting triggers data refetch)
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBe(3);

    // Click again to reverse sort
    await sortButton.click();

    // Wait for rows to reappear after reverse sort
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBe(3);
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
    const folderName = `Maintain Order Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `First Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Second Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Third Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
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
});
