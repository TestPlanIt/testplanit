import type { Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Search & Filter Tests
 *
 * Test cases for searching and filtering test cases in the repository.
 *
 * `search-input` is the repository's own search: the in-table NAME filter
 * exercised here, always AND'ed as a base condition and never serialized to
 * the URL. It is the only text input on this page — the Elasticsearch box
 * (`es-search-input`) exists solely in the case-selection dialog, where
 * Unified Search is unreachable. Dimension filtering itself lives in the
 * FilterBar (chips + `?f=` params), which composes with both the folder scope
 * and the name filter.
 */

/** The `f` params currently serialized into the URL, form-decoded. */
function filterParams(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll("f");
}

/** Open the FilterBar's Add-filter picker and choose a dimension. */
async function addFilterDimension(page: Page, dimension: string) {
  const addButton = page.getByTestId("filter-bar-add");
  await expect(addButton).toBeVisible({ timeout: 10000 });
  await addButton.click();
  const option = page.getByTestId(`filter-dimension-option-${dimension}`);
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
}

test.describe("Search & Filter", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E SearchFilter ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Search Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let searchableName: string | undefined;
    await test.step("Create folder with searchable and other test cases", async () => {
      const folderName = `Search Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      searchableName = `UniqueSearchTerm${Date.now()}`;
      await api.createTestCase(projectId, folderId, searchableName);
      await api.createTestCase(projectId, folderId, `Other Case ${Date.now()}`);
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder first - search only works within the selected folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify both test cases are visible initially
      await expect(
        page.locator(`text="${searchableName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Enter the search term", async () => {
      // Find the search input
      const searchInput = page.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 5000 });

      // Enter search term
      await searchInput.fill(searchableName!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify only the matching case remains", async () => {
      // Verify only the matching test case is shown
      await expect(
        page.locator(`text="${searchableName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });

      // Other case should not be visible (filtered out)
      await expect(page.locator('text="Other Case"')).not.toBeVisible({
        timeout: 3000,
      });
    });
  });

  test("Search with No Results", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    await test.step("Create folder with test cases to search within", async () => {
      const folderName = `No Results Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      await api.createTestCase(
        projectId,
        folderId,
        `Existing Case ${Date.now()}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `Another Case ${Date.now()}`
      );
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder that has test cases
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Search for a term that matches nothing", async () => {
      // Find the search input
      const searchInput = page.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 5000 });

      // Search for a term that doesn't match any of the test cases
      const nonExistentTerm = `NoMatchPossible${Date.now()}XYZ123`;
      await searchInput.fill(nonExistentTerm);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the no test cases message is shown", async () => {
      // Verify "no test cases" message is shown in the main content area (not in folder tree)
      // The message is "No test cases in this folder." from translation key repository.cases.noTestCases
      // Use the right panel area to avoid matching the folder name "No Results Folder" in the tree
      const casesArea = page
        .getByTestId("repository-right-panel-header")
        .locator(".."); // Get parent container
      const noResults = casesArea.locator("text=/No test cases/i").first();
      await expect(noResults).toBeVisible({ timeout: 10000 });
    });
  });

  test("Filter Test Cases Within Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let filterableName: string | undefined;
    let nonMatchingName: string | undefined;
    await test.step("Create folder with filterable and non-matching cases", async () => {
      const folderName = `Filter Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      const uniqueId = Date.now();
      filterableName = `Filterable${uniqueId}`;
      nonMatchingName = `DifferentXYZ${uniqueId}`;
      await api.createTestCase(projectId, folderId, filterableName);
      await api.createTestCase(projectId, folderId, nonMatchingName);
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify both test cases are visible before filtering
      await expect(
        page.locator(`text="${filterableName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator(`text="${nonMatchingName}"`).first()
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step("Filter by the unique filterable name", async () => {
      // Find and use the search input to filter within the folder
      const filterInput = page.getByTestId("search-input");
      await expect(filterInput).toBeVisible({ timeout: 5000 });

      // Filter by the unique filterable name
      await filterInput.fill("Filterable");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify only the matching case is shown", async () => {
      // Verify only the matching case is shown
      await expect(
        page.locator(`text="${filterableName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });

      // Verify the non-matching case is NOT visible
      await expect(page.locator(`text="${nonMatchingName}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Filter Persists When Switching Folders", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folder1Id: number | undefined;
    let folder2Id: number | undefined;
    let searchTerm: string | undefined;
    let folder1MatchingCase: string | undefined;
    let folder1NonMatchingCase: string | undefined;
    let folder2MatchingCase: string | undefined;
    let folder2NonMatchingCase: string | undefined;
    await test.step("Create two folders with matching and non-matching cases", async () => {
      // Create two folders with test cases
      const uniqueId = Date.now();
      const folder1Name = `Persist Folder 1 ${uniqueId}`;
      folder1Id = await api.createFolder(projectId, folder1Name);
      const folder2Name = `Persist Folder 2 ${uniqueId}`;
      folder2Id = await api.createFolder(projectId, folder2Name);

      // Create test cases - use a unique search term that appears in one case per folder
      searchTerm = `Searchable${uniqueId}`;
      folder1MatchingCase = `${searchTerm} InFolder1`;
      folder1NonMatchingCase = `Different${uniqueId} InFolder1`;
      folder2MatchingCase = `${searchTerm} InFolder2`;
      folder2NonMatchingCase = `Other${uniqueId} InFolder2`;

      await api.createTestCase(projectId, folder1Id, folder1MatchingCase);
      await api.createTestCase(projectId, folder1Id, folder1NonMatchingCase);
      await api.createTestCase(projectId, folder2Id, folder2MatchingCase);
      await api.createTestCase(projectId, folder2Id, folder2NonMatchingCase);
    });

    const filterInput = page.getByTestId("search-input");

    await test.step("Open repository and select folder 1", async () => {
      await repositoryPage.goto(projectId);

      // Select folder 1 and verify both cases are visible initially
      await repositoryPage.selectFolder(folder1Id!);
      await page.waitForLoadState("networkidle");
      await expect(
        page.locator(`text="${folder1MatchingCase}"`).first()
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator(`text="${folder1NonMatchingCase}"`).first()
      ).toBeVisible({ timeout: 5000 });
    });

    await test.step("Apply filter and verify it works in folder 1", async () => {
      // Apply filter in folder 1
      await expect(filterInput).toBeVisible({ timeout: 5000 });
      await filterInput.fill(searchTerm!);
      await page.waitForLoadState("networkidle");

      // Verify filter works in folder 1 - only matching case visible
      await expect(
        page.locator(`text="${folder1MatchingCase}"`).first()
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator(`text="${folder1NonMatchingCase}"`)
      ).not.toBeVisible({ timeout: 5000 });
    });

    await test.step("Switch to folder 2 and verify the filter persists", async () => {
      // Switch to folder 2
      await repositoryPage.selectFolder(folder2Id!);
      await page.waitForLoadState("networkidle");

      // Verify filter input still contains the search term
      await expect(filterInput).toHaveValue(searchTerm!);

      // Verify filter is still applied in folder 2 - only matching case visible
      await expect(
        page.locator(`text="${folder2MatchingCase}"`).first()
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator(`text="${folder2NonMatchingCase}"`)
      ).not.toBeVisible({ timeout: 5000 });
    });
  });

  test("Clear Search Filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let case1Name: string | undefined;
    let case2Name: string | undefined;
    await test.step("Create folder with two test cases", async () => {
      const folderName = `Clear Search Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      const uniqueId = Date.now();
      case1Name = `ClearTest1 ${uniqueId}`;
      case2Name = `ClearTest2 ${uniqueId}`;
      await api.createTestCase(projectId, folderId, case1Name);
      await api.createTestCase(projectId, folderId, case2Name);
    });

    const searchInput = page.getByTestId("search-input");

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify both test cases are visible initially
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Apply a search filter", async () => {
      // Apply a search filter
      await expect(searchInput).toBeVisible({ timeout: 5000 });
      await searchInput.fill("ClearTest1");
      await page.waitForLoadState("networkidle");

      // Only one case should be visible
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({
        timeout: 3000,
      });
    });

    await test.step("Clear the search and verify both cases return", async () => {
      // Clear the search
      await searchInput.clear();
      await page.waitForLoadState("networkidle");

      // Both cases should be visible again
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Search is Case Insensitive", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let caseName: string | undefined;
    let uniqueId: number | undefined;
    await test.step("Create folder with a mixed-case test case", async () => {
      const folderName = `Case Insensitive Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      uniqueId = Date.now();
      caseName = `MixedCaseTest ${uniqueId}`;
      await api.createTestCase(projectId, folderId, caseName);
      await api.createTestCase(projectId, folderId, `Other ${uniqueId}`);
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Search using lowercase", async () => {
      // Search with lowercase
      const searchInput = page.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 5000 });
      await searchInput.fill("mixedcasetest");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the case-insensitive match is shown", async () => {
      // The matching case should be visible (case insensitive match)
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });

      // The other case should not be visible
      await expect(page.locator(`text="Other ${uniqueId}"`)).not.toBeVisible({
        timeout: 3000,
      });
    });
  });

  test("Search with Partial Match", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let caseName: string | undefined;
    let uniqueId: number | undefined;
    await test.step("Create folder with a long-named test case", async () => {
      const folderName = `Partial Match Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      uniqueId = Date.now();
      caseName = `LongTestCaseName ${uniqueId}`;
      await api.createTestCase(projectId, folderId, caseName);
      await api.createTestCase(projectId, folderId, `Different ${uniqueId}`);
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Search using a partial term", async () => {
      // Search with partial term
      const searchInput = page.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 5000 });
      await searchInput.fill("LongTest");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the partial match is shown", async () => {
      // The matching case should be visible
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });

      // The other case should not be visible
      await expect(
        page.locator(`text="Different ${uniqueId}"`)
      ).not.toBeVisible({
        timeout: 3000,
      });
    });
  });

  test("Search Input Has Placeholder Text", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    await test.step("Create a folder", async () => {
      // Create a folder so we can see the search input
      const folderName = `Placeholder Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the search input has placeholder text", async () => {
      // Verify search input has a placeholder
      const searchInput = page.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 5000 });

      // The input should have some placeholder text (could be "Filter..." or similar)
      const placeholder = await searchInput.getAttribute("placeholder");
      expect(placeholder).toBeTruthy();
      expect(placeholder!.length).toBeGreaterThan(0);
    });
  });

  test("Search Matches Multiple Test Cases", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let commonTerm: string | undefined;
    let case1Name: string | undefined;
    let case2Name: string | undefined;
    let case3Name: string | undefined;
    let nonMatchingName: string | undefined;
    await test.step("Create folder with cases sharing a common term", async () => {
      const folderName = `Multi Match Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      const uniqueId = Date.now();
      commonTerm = `CommonPrefix${uniqueId}`;
      case1Name = `${commonTerm} First`;
      case2Name = `${commonTerm} Second`;
      case3Name = `${commonTerm} Third`;
      nonMatchingName = `Different ${uniqueId}`;

      await api.createTestCase(projectId, folderId, case1Name);
      await api.createTestCase(projectId, folderId, case2Name);
      await api.createTestCase(projectId, folderId, case3Name);
      await api.createTestCase(projectId, folderId, nonMatchingName);
    });

    const table = page.locator("table").first();
    const rows = table.locator("tbody tr");

    await test.step("Open the folder and verify all four cases are visible", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify all 4 test cases are visible initially
      await expect(table).toBeVisible({ timeout: 10000 });
      await expect(rows).toHaveCount(4, { timeout: 10000 });
    });

    await test.step("Search for the common term", async () => {
      // Search for the common term
      const searchInput = page.getByTestId("search-input");
      await searchInput.fill(commonTerm!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the three matching cases are shown", async () => {
      // Should show exactly 3 matching cases
      await expect(rows).toHaveCount(3, { timeout: 10000 });

      // Verify the matching cases are visible
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible();
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible();
      await expect(page.locator(`text="${case3Name}"`).first()).toBeVisible();

      // Non-matching case should not be visible
      await expect(page.locator(`text="${nonMatchingName}"`)).not.toBeVisible({
        timeout: 3000,
      });
    });
  });

  test("Search with Special Characters", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let specialCaseName: string | undefined;
    let normalCaseName: string | undefined;
    await test.step("Create folder with special-character and normal cases", async () => {
      const folderName = `Special Chars Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      const uniqueId = Date.now();
      // Test case with parentheses and brackets
      specialCaseName = `Test (with) [brackets] ${uniqueId}`;
      normalCaseName = `Normal Case ${uniqueId}`;

      await api.createTestCase(projectId, folderId, specialCaseName);
      await api.createTestCase(projectId, folderId, normalCaseName);
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Search for part of the special-character name", async () => {
      // Search for part of the special character name
      const searchInput = page.getByTestId("search-input");
      await searchInput.fill("(with)");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the special-character case is shown", async () => {
      // The special character case should be visible
      await expect(
        page.locator(`text="${specialCaseName}"`).first()
      ).toBeVisible({ timeout: 10000 });

      // Normal case should not be visible
      await expect(page.locator(`text="${normalCaseName}"`)).not.toBeVisible({
        timeout: 3000,
      });
    });
  });

  test("Search Works with Sequential Typing", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let targetCaseName: string | undefined;
    let uniqueId: number | undefined;
    await test.step("Create folder with a target test case", async () => {
      const folderName = `Sequential Typing Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      uniqueId = Date.now();
      targetCaseName = `TargetCase ${uniqueId}`;
      await api.createTestCase(projectId, folderId, targetCaseName);
      await api.createTestCase(projectId, folderId, `Other ${uniqueId}`);
    });

    await test.step("Open the folder and verify cases are visible", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify both cases are visible initially
      await expect(
        page.locator(`text="${targetCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Type the search term character by character", async () => {
      // Type character by character (simulating real user typing)
      const searchInput = page.getByTestId("search-input");
      await searchInput.focus();
      await searchInput.pressSequentially("Target", { delay: 100 });

      // Wait for debounce to complete and network to settle
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify only the target case remains after debounce", async () => {
      // After typing completes and debounce triggers, only the target case should be visible
      await expect(
        page.locator(`text="${targetCaseName}"`).first()
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="Other ${uniqueId}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Search Updates Pagination Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    await test.step("Create folder with 15 Alpha and Beta test cases", async () => {
      const folderName = `Search Pagination Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      const uniqueId = Date.now();

      // Create 15 test cases - 5 with "Alpha" prefix, 10 with "Beta" prefix
      for (let i = 0; i < 5; i++) {
        await api.createTestCase(projectId, folderId, `Alpha ${i} ${uniqueId}`);
      }
      for (let i = 0; i < 10; i++) {
        await api.createTestCase(projectId, folderId, `Beta ${i} ${uniqueId}`);
      }
    });

    const searchInput = page.getByTestId("search-input");

    await test.step("Open the folder and verify 15 items initially", async () => {
      await repositoryPage.goto(projectId);

      // Select the folder
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      // Verify initial count shows 15 items
      await expect(page.locator("text=/of 15/")).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Filter by Alpha and verify the count drops to 5", async () => {
      // Apply search filter for "Alpha"
      await searchInput.fill("Alpha");
      await page.waitForLoadState("networkidle");

      // Verify count updated to show only 5 items
      await expect(page.locator("text=/of 5/")).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Clear the filter and verify the count returns to 15", async () => {
      // Clear the filter
      await searchInput.clear();
      await page.waitForLoadState("networkidle");

      // Verify count is back to 15 items
      await expect(page.locator("text=/of 15/")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Search Removes Pagination When Results Fit One Page", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let searchTerm: string | undefined;
    await test.step("Create folder with 15 cases where only 3 match", async () => {
      const folderName = `Search Remove Pagination Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      const uniqueId = Date.now();

      // Create 15 test cases - only 3 have the unique search term
      searchTerm = `UniqueTarget${uniqueId}`;
      for (let i = 0; i < 3; i++) {
        await api.createTestCase(
          projectId,
          folderId,
          `${searchTerm} Case ${i}`
        );
      }
      for (let i = 0; i < 12; i++) {
        await api.createTestCase(
          projectId,
          folderId,
          `Other Case ${i} ${uniqueId}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the paginated folder and verify pagination is shown", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}?node=${folderId}&pageSize=10`
      );
      await page.waitForLoadState("networkidle");
      await expect(page.locator("text=/of 15/")).toBeVisible({
        timeout: 10000,
      });

      // Verify pagination is initially visible (15 items > 10 per page)
      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Filter to fewer than one page of results", async () => {
      // Apply search filter that reduces results to less than page size
      const searchInput = page.getByTestId("search-input");
      await searchInput.fill(searchTerm!);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify pagination is removed and only 3 items remain", async () => {
      // Verify pagination is no longer visible (3 items < 10 per page)
      await expect(paginationNav).not.toBeVisible({ timeout: 5000 });

      // Verify only 3 items are shown
      await expect(page.locator("text=/of 3/")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Search Resets to First Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    await test.step("Create folder with 25 cases across multiple pages", async () => {
      const folderName = `Search Reset Page Folder ${Date.now()}`;
      folderId = await api.createFolder(projectId, folderName);
      const uniqueId = Date.now();

      // Create 25 test cases - some with "Target" prefix distributed across pages
      for (let i = 0; i < 25; i++) {
        const prefix = i % 3 === 0 ? "Target" : "Other";
        await api.createTestCase(
          projectId,
          folderId,
          `${prefix} ${i} ${uniqueId}`
        );
      }
    });

    await test.step("Open the paginated folder and verify 25 items", async () => {
      await page.goto(
        `/en-US/projects/repository/${projectId}?node=${folderId}&pageSize=10`
      );
      await page.waitForLoadState("networkidle");
      await expect(page.locator("text=/of 25/")).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Navigate to page 2", async () => {
      // Navigate to page 2
      const paginationNav = page.locator('nav[aria-label="pagination"]');
      await expect(paginationNav).toBeVisible({ timeout: 5000 });
      const page2Link = paginationNav.locator('a:has-text("2")').first();
      await page2Link.click();
      await page.waitForLoadState("networkidle");

      // Verify we're on page 2
      await expect(page.locator("text=/11-20 of/")).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Apply a filter and verify it resets to page 1", async () => {
      // Apply search filter
      const searchInput = page.getByTestId("search-input");
      await searchInput.fill("Target");
      await page.waitForLoadState("networkidle");

      // Verify we're reset to page 1 of filtered results (starts with "Showing 1-")
      await expect(page.locator("text=/1-/")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Name Filter Composes With a Filter Chip Inside a Folder", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    let folderId: number | undefined;
    let stateIds: number[] = [];
    const uniqueId = Date.now();
    const matchingName = `ChipMatch${uniqueId}`;
    const sameStateOtherName = `ChipOther${uniqueId}`;
    const otherStateName = `ChipMatchWrongState${uniqueId}`;

    await test.step("Create a folder with cases across two states", async () => {
      const folderName = `Chip Compose Folder ${uniqueId}`;
      folderId = await api.createFolder(projectId, folderName);
      stateIds = await api.getStateIds(projectId, 2);

      await api.createTestCaseWithState(
        projectId,
        folderId,
        matchingName,
        stateIds[0]
      );
      await api.createTestCaseWithState(
        projectId,
        folderId,
        sameStateOtherName,
        stateIds[0]
      );
      await api.createTestCaseWithState(
        projectId,
        folderId,
        otherStateName,
        stateIds[1]
      );
    });

    await test.step("Open repository and select the folder", async () => {
      await repositoryPage.goto(projectId);
      await repositoryPage.selectFolder(folderId!);
      await page.waitForLoadState("networkidle");

      await expect(
        page.locator(`text="${otherStateName}"`).first()
      ).toBeVisible({ timeout: 10000 });
    });

    await test.step("Add a state filter chip from the FilterBar", async () => {
      await addFilterDimension(page, "states");
      await page.getByTestId(`filter-value-option-${stateIds[0]}`).click();

      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible({
        timeout: 10000,
      });
      await page.keyboard.press("Escape");

      // Folder scope AND the predicate: the other state's case is gone.
      await expect(page.locator(`text="${otherStateName}"`)).not.toBeVisible({
        timeout: 5000,
      });
      await expect(page.locator(`text="${matchingName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Narrow further with the in-table name filter", async () => {
      const searchInput = page.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 5000 });
      await searchInput.fill(matchingName);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify only the case matching every condition remains", async () => {
      await expect(page.locator(`text="${matchingName}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator(`text="${sameStateOtherName}"`)
      ).not.toBeVisible({ timeout: 5000 });
      await expect(page.locator(`text="${otherStateName}"`)).not.toBeVisible({
        timeout: 5000,
      });

      // The chip is still active, and only the chip is serialized — the name
      // filter stays out of the URL.
      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible();
      expect(filterParams(page)).toEqual([`states:in:${stateIds[0]}`]);
    });
  });
});
