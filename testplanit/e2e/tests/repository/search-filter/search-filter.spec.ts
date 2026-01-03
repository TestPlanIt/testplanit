import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Search & Filter Tests
 *
 * Test cases for searching and filtering test cases in the repository.
 * The repository uses a text filter input (search-input) to filter the DataTable
 * and a ViewSelector dropdown to filter by different views (folders, states, templates, etc.).
 */
test.describe("Search & Filter", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("Search Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Search Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const searchableName = `UniqueSearchTerm${Date.now()}`;
    await api.createTestCase(projectId, folderId, searchableName);
    await api.createTestCase(projectId, folderId, `Other Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Select the folder first - search only works within the selected folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify both test cases are visible initially
    await expect(page.locator(`text="${searchableName}"`).first()).toBeVisible({ timeout: 10000 });

    // Find the search input
    const searchInput = page.getByTestId("search-input");
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Enter search term
    await searchInput.fill(searchableName);
    await page.waitForLoadState("networkidle");

    // Verify only the matching test case is shown
    await expect(page.locator(`text="${searchableName}"`).first()).toBeVisible({ timeout: 10000 });

    // Other case should not be visible (filtered out)
    await expect(page.locator('text="Other Case"')).not.toBeVisible({ timeout: 3000 });
  });

  test("Search with No Results", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases so we have something to search within
    const folderName = `No Results Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Existing Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Another Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Select the folder that has test cases
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Find the search input
    const searchInput = page.getByTestId("search-input");
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Search for a term that doesn't match any of the test cases
    const nonExistentTerm = `NoMatchPossible${Date.now()}XYZ123`;
    await searchInput.fill(nonExistentTerm);
    await page.waitForLoadState("networkidle");

    // Verify "no results" message is shown (the table shows "No cases" when empty)
    const noResults = page.locator('text=/no results|no test cases|No cases/i');
    await expect(noResults.first()).toBeVisible({ timeout: 10000 });
  });

  test("Filter Test Cases Within Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with multiple test cases - use unique identifiable names
    const folderName = `Filter Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();
    const filterableName = `Filterable${uniqueId}`;
    const nonMatchingName = `DifferentXYZ${uniqueId}`;
    await api.createTestCase(projectId, folderId, filterableName);
    await api.createTestCase(projectId, folderId, nonMatchingName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify both test cases are visible before filtering
    await expect(page.locator(`text="${filterableName}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${nonMatchingName}"`).first()).toBeVisible({ timeout: 5000 });

    // Find and use the search input to filter within the folder
    const filterInput = page.getByTestId("search-input");
    await expect(filterInput).toBeVisible({ timeout: 5000 });

    // Filter by the unique filterable name
    await filterInput.fill("Filterable");
    await page.waitForLoadState("networkidle");

    // Verify only the matching case is shown
    await expect(page.locator(`text="${filterableName}"`).first()).toBeVisible({ timeout: 10000 });

    // Verify the non-matching case is NOT visible
    await expect(page.locator(`text="${nonMatchingName}"`)).not.toBeVisible({ timeout: 5000 });
  });

  test("Filter Persists When Switching Folders", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create two folders with test cases
    const uniqueId = Date.now();
    const folder1Name = `Persist Folder 1 ${uniqueId}`;
    const folder1Id = await api.createFolder(projectId, folder1Name);
    const folder2Name = `Persist Folder 2 ${uniqueId}`;
    const folder2Id = await api.createFolder(projectId, folder2Name);

    // Create test cases - use a unique search term that appears in one case per folder
    const searchTerm = `Searchable${uniqueId}`;
    const folder1MatchingCase = `${searchTerm} InFolder1`;
    const folder1NonMatchingCase = `Different${uniqueId} InFolder1`;
    const folder2MatchingCase = `${searchTerm} InFolder2`;
    const folder2NonMatchingCase = `Other${uniqueId} InFolder2`;

    await api.createTestCase(projectId, folder1Id, folder1MatchingCase);
    await api.createTestCase(projectId, folder1Id, folder1NonMatchingCase);
    await api.createTestCase(projectId, folder2Id, folder2MatchingCase);
    await api.createTestCase(projectId, folder2Id, folder2NonMatchingCase);

    await repositoryPage.goto(projectId);

    // Select folder 1 and verify both cases are visible initially
    await repositoryPage.selectFolder(folder1Id);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text="${folder1MatchingCase}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${folder1NonMatchingCase}"`).first()).toBeVisible({ timeout: 5000 });

    // Apply filter in folder 1
    const filterInput = page.getByTestId("search-input");
    await expect(filterInput).toBeVisible({ timeout: 5000 });
    await filterInput.fill(searchTerm);
    await page.waitForLoadState("networkidle");

    // Verify filter works in folder 1 - only matching case visible
    await expect(page.locator(`text="${folder1MatchingCase}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${folder1NonMatchingCase}"`)).not.toBeVisible({ timeout: 5000 });

    // Switch to folder 2
    await repositoryPage.selectFolder(folder2Id);
    await page.waitForLoadState("networkidle");

    // Verify filter input still contains the search term
    await expect(filterInput).toHaveValue(searchTerm);

    // Verify filter is still applied in folder 2 - only matching case visible
    await expect(page.locator(`text="${folder2MatchingCase}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${folder2NonMatchingCase}"`)).not.toBeVisible({ timeout: 5000 });
  });

  test("Clear Search Filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Clear Search Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();
    const case1Name = `ClearTest1 ${uniqueId}`;
    const case2Name = `ClearTest2 ${uniqueId}`;
    await api.createTestCase(projectId, folderId, case1Name);
    await api.createTestCase(projectId, folderId, case2Name);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify both test cases are visible initially
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({ timeout: 5000 });

    // Apply a search filter
    const searchInput = page.getByTestId("search-input");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("ClearTest1");
    await page.waitForLoadState("networkidle");

    // Only one case should be visible
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({ timeout: 3000 });

    // Clear the search
    await searchInput.clear();
    await page.waitForLoadState("networkidle");

    // Both cases should be visible again
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({ timeout: 5000 });
  });

  test("Search is Case Insensitive", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Case Insensitive Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();
    const caseName = `MixedCaseTest ${uniqueId}`;
    await api.createTestCase(projectId, folderId, caseName);
    await api.createTestCase(projectId, folderId, `Other ${uniqueId}`);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Search with lowercase
    const searchInput = page.getByTestId("search-input");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("mixedcasetest");
    await page.waitForLoadState("networkidle");

    // The matching case should be visible (case insensitive match)
    await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({ timeout: 10000 });

    // The other case should not be visible
    await expect(page.locator(`text="Other ${uniqueId}"`)).not.toBeVisible({ timeout: 3000 });
  });

  test("Search with Partial Match", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Partial Match Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();
    const caseName = `LongTestCaseName ${uniqueId}`;
    await api.createTestCase(projectId, folderId, caseName);
    await api.createTestCase(projectId, folderId, `Different ${uniqueId}`);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Search with partial term
    const searchInput = page.getByTestId("search-input");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill("LongTest");
    await page.waitForLoadState("networkidle");

    // The matching case should be visible
    await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({ timeout: 10000 });

    // The other case should not be visible
    await expect(page.locator(`text="Different ${uniqueId}"`)).not.toBeVisible({ timeout: 3000 });
  });

  test("Search Input Has Placeholder Text", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder so we can see the search input
    const folderName = `Placeholder Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify search input has a placeholder
    const searchInput = page.getByTestId("search-input");
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // The input should have some placeholder text (could be "Filter..." or similar)
    const placeholder = await searchInput.getAttribute("placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(0);
  });

  test("Search Matches Multiple Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases that share a common term
    const folderName = `Multi Match Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();
    const commonTerm = `CommonPrefix${uniqueId}`;
    const case1Name = `${commonTerm} First`;
    const case2Name = `${commonTerm} Second`;
    const case3Name = `${commonTerm} Third`;
    const nonMatchingName = `Different ${uniqueId}`;

    await api.createTestCase(projectId, folderId, case1Name);
    await api.createTestCase(projectId, folderId, case2Name);
    await api.createTestCase(projectId, folderId, case3Name);
    await api.createTestCase(projectId, folderId, nonMatchingName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify all 4 test cases are visible initially
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(4, { timeout: 10000 });

    // Search for the common term
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill(commonTerm);
    await page.waitForLoadState("networkidle");

    // Should show exactly 3 matching cases
    await expect(rows).toHaveCount(3, { timeout: 10000 });

    // Verify the matching cases are visible
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible();
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible();
    await expect(page.locator(`text="${case3Name}"`).first()).toBeVisible();

    // Non-matching case should not be visible
    await expect(page.locator(`text="${nonMatchingName}"`)).not.toBeVisible({ timeout: 3000 });
  });

  test("Search with Special Characters", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases that have special characters
    const folderName = `Special Chars Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();
    // Test case with parentheses and brackets
    const specialCaseName = `Test (with) [brackets] ${uniqueId}`;
    const normalCaseName = `Normal Case ${uniqueId}`;

    await api.createTestCase(projectId, folderId, specialCaseName);
    await api.createTestCase(projectId, folderId, normalCaseName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Search for part of the special character name
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill("(with)");
    await page.waitForLoadState("networkidle");

    // The special character case should be visible
    await expect(page.locator(`text="${specialCaseName}"`).first()).toBeVisible({ timeout: 10000 });

    // Normal case should not be visible
    await expect(page.locator(`text="${normalCaseName}"`)).not.toBeVisible({ timeout: 3000 });
  });

  test("Search Works with Sequential Typing", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Sequential Typing Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();
    const targetCaseName = `TargetCase ${uniqueId}`;
    await api.createTestCase(projectId, folderId, targetCaseName);
    await api.createTestCase(projectId, folderId, `Other ${uniqueId}`);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify both cases are visible initially
    await expect(page.locator(`text="${targetCaseName}"`).first()).toBeVisible({ timeout: 10000 });

    // Type character by character (simulating real user typing)
    const searchInput = page.getByTestId("search-input");
    await searchInput.focus();
    await searchInput.pressSequentially("Target", { delay: 100 });

    // Wait for debounce to complete and network to settle
    await page.waitForLoadState("networkidle");

    // After typing completes and debounce triggers, only the target case should be visible
    await expect(page.locator(`text="${targetCaseName}"`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text="Other ${uniqueId}"`)).not.toBeVisible({ timeout: 5000 });
  });

  test("Search Updates Pagination Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with enough test cases to have pagination
    const folderName = `Search Pagination Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();

    // Create 15 test cases - 5 with "Alpha" prefix, 10 with "Beta" prefix
    for (let i = 0; i < 5; i++) {
      await api.createTestCase(projectId, folderId, `Alpha ${i} ${uniqueId}`);
    }
    for (let i = 0; i < 10; i++) {
      await api.createTestCase(projectId, folderId, `Beta ${i} ${uniqueId}`);
    }

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify initial count shows 15 items
    await expect(page.locator('text=/of 15 items/')).toBeVisible({ timeout: 5000 });

    // Apply search filter for "Alpha"
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill("Alpha");
    await page.waitForLoadState("networkidle");

    // Verify count updated to show only 5 items
    await expect(page.locator('text=/of 5 items/')).toBeVisible({ timeout: 5000 });

    // Clear the filter
    await searchInput.clear();
    await page.waitForLoadState("networkidle");

    // Verify count is back to 15 items
    await expect(page.locator('text=/of 15 items/')).toBeVisible({ timeout: 5000 });
  });

  test("Search Removes Pagination When Results Fit One Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with enough test cases to trigger pagination (>10)
    const folderName = `Search Remove Pagination Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();

    // Create 15 test cases - only 3 have the unique search term
    const searchTerm = `UniqueTarget${uniqueId}`;
    for (let i = 0; i < 3; i++) {
      await api.createTestCase(projectId, folderId, `${searchTerm} Case ${i}`);
    }
    for (let i = 0; i < 12; i++) {
      await api.createTestCase(projectId, folderId, `Other Case ${i} ${uniqueId}`);
    }

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify pagination is initially visible (15 items > 10 per page)
    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 5000 });

    // Apply search filter that reduces results to less than page size
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill(searchTerm);
    await page.waitForLoadState("networkidle");

    // Verify pagination is no longer visible (3 items < 10 per page)
    await expect(paginationNav).not.toBeVisible({ timeout: 5000 });

    // Verify only 3 items are shown
    await expect(page.locator('text=/of 3 items/')).toBeVisible({ timeout: 5000 });
  });

  test("Search Resets to First Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with enough test cases for multiple pages
    const folderName = `Search Reset Page Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const uniqueId = Date.now();

    // Create 25 test cases - some with "Target" prefix distributed across pages
    for (let i = 0; i < 25; i++) {
      const prefix = i % 3 === 0 ? "Target" : "Other";
      await api.createTestCase(projectId, folderId, `${prefix} ${i} ${uniqueId}`);
    }

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Navigate to page 2
    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 5000 });
    const page2Link = paginationNav.locator('a:has-text("2")').first();
    await page2Link.click();
    await page.waitForLoadState("networkidle");

    // Verify we're on page 2
    await expect(page.locator('text=/Showing 11-20 of/')).toBeVisible({ timeout: 5000 });

    // Apply search filter
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill("Target");
    await page.waitForLoadState("networkidle");

    // Verify we're reset to page 1 of filtered results (starts with "Showing 1-")
    await expect(page.locator('text=/Showing 1-/')).toBeVisible({ timeout: 5000 });
  });
});
