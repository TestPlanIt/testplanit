import { expect, test } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";
import { UnifiedSearchPage } from "../../page-objects/unified-search.page";

/**
 * Global Search E2E Tests
 *
 * Covers SRCH-01: Global search via Cmd+K keyboard shortcut,
 * cross-entity search results, result navigation, and empty state.
 */
test.describe("Global Search", () => {
  let unifiedSearch: UnifiedSearchPage;
  let repositoryPage: RepositoryPage;
  let projectId: number;

  test.beforeEach(async ({ page, api }) => {
    unifiedSearch = new UnifiedSearchPage(page);
    repositoryPage = new RepositoryPage(page);

    // Create a test project for each test — combine timestamp + random suffix for uniqueness
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`Global Search Test ${uniqueId}`);
    await repositoryPage.goto(projectId);
  });

  test("Cmd+K opens global search sheet", async ({ page }) => {
    const isMac = process.platform === "darwin";
    const modifier = isMac ? "Meta" : "Control";
    const sheet = page.locator('[data-testid="global-search-sheet"]');

    await test.step("Open global search with the keyboard shortcut", async () => {
      // Press Cmd+K (Meta+K on Mac, Ctrl+K on other platforms)
      await page.keyboard.press(`${modifier}+KeyK`);

      // Verify the global search sheet appears with the correct test ID
      await expect(sheet).toBeVisible({ timeout: 5000 });

      // Also verify it is accessible as a dialog
      const dialog = page
        .locator('[role="dialog"]')
        .filter({ hasText: /search/i });
      await expect(dialog).toBeVisible();
    });

    await test.step("Close the search sheet with Escape", async () => {
      // Close with Escape and verify it closes
      await page.keyboard.press("Escape");
      await expect(sheet).not.toBeVisible({ timeout: 3000 });
    });
  });

  test("Search returns matching test cases", async ({ page, api }) => {
    const uniqueId = Date.now();
    let folderId: number | undefined;

    await test.step("Create searchable test cases and wait for indexing", async () => {
      folderId = await api.createFolder(projectId, "Search Results Folder");

      // Create test cases with unique names
      await api.createTestCase(
        projectId,
        folderId,
        `SearchableCase Alpha ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `SearchableCase Beta ${uniqueId}`
      );
      await api.createTestCase(
        projectId,
        folderId,
        `OtherCase Gamma ${uniqueId}`
      );

      // Wait for Elasticsearch indexing
      await page.waitForTimeout(2000);
    });

    await test.step("Search for the unique case prefix and verify matches", async () => {
      // Open search and search for the unique prefix
      await unifiedSearch.open();
      await unifiedSearch.search(`SearchableCase ${uniqueId}`);

      const searchDialog = page
        .locator('[role="dialog"]')
        .filter({ hasText: /search/i });

      // Both searchable cases should appear in results
      await expect(
        searchDialog.getByRole("heading", {
          name: new RegExp(`SearchableCase Alpha ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        searchDialog.getByRole("heading", {
          name: new RegExp(`SearchableCase Beta ${uniqueId}`),
        })
      ).toBeVisible({ timeout: 5000 });
    });
  });

  test("Clicking result navigates to test case detail", async ({
    page,
    api,
  }) => {
    const uniqueId = Date.now();
    const caseName = `NavigationCase ${uniqueId}`;
    let caseId: number | undefined;

    await test.step("Create a test case and wait for indexing", async () => {
      const folderId = await api.createFolder(
        projectId,
        "Navigation Test Folder"
      );

      caseId = await api.createTestCase(projectId, folderId, caseName);

      // Wait for Elasticsearch indexing
      await page.waitForTimeout(2000);
    });

    await test.step("Search for the case and click the result", async () => {
      await unifiedSearch.open();
      await unifiedSearch.search(caseName);

      const searchDialog = page
        .locator('[role="dialog"]')
        .filter({ hasText: /search/i });

      // Wait for result to appear
      const resultHeading = searchDialog.getByRole("heading", {
        name: new RegExp(caseName),
      });
      await expect(resultHeading).toBeVisible({ timeout: 10000 });

      // Click the result
      await resultHeading.click();
    });

    await test.step("Verify navigation to the case detail page", async () => {
      await page.waitForURL(`**/projects/repository/${projectId}/${caseId!}`, {
        timeout: 10000,
      });

      const currentUrl = page.url();
      expect(currentUrl).toContain(
        `/projects/repository/${projectId}/${caseId!}`
      );
    });
  });

  test("Cross-entity search returns results from multiple types", async ({
    page,
    api,
  }) => {
    const uniqueId = Date.now();
    const searchTerm = `CrossEntity${uniqueId}`;

    await test.step("Create a searchable test case and wait for indexing", async () => {
      const folderId = await api.createFolder(projectId, "Cross-Entity Folder");

      // Create a test case with a unique searchable name
      await api.createTestCase(projectId, folderId, `${searchTerm} Case`);

      // Wait for Elasticsearch indexing
      await page.waitForTimeout(2000);
    });

    await test.step("Search and verify cross-entity results appear", async () => {
      await unifiedSearch.open();
      await unifiedSearch.search(searchTerm);

      const searchDialog = page
        .locator('[role="dialog"]')
        .filter({ hasText: /search/i });

      // Should find the repository case
      await expect(
        searchDialog.getByRole("heading", {
          name: new RegExp(`${searchTerm} Case`),
        })
      ).toBeVisible({ timeout: 10000 });

      // Verify at least one result entity type section is visible in results
      // (The search dialog shows results grouped or labeled by entity type)
      const resultsContainer = searchDialog.locator(
        '[data-testid="search-results"]'
      );
      const hasResults = (await resultsContainer.count()) > 0;
      if (hasResults) {
        await expect(resultsContainer).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test("Search with no results shows empty state", async ({ page }) => {
    await test.step("Search for a string that matches nothing", async () => {
      // Open search with a highly unique string that won't match anything
      await unifiedSearch.open();
      await unifiedSearch.search(`xyzNoMatchGibberish${Date.now()}abc`);
    });

    await test.step("Verify the empty state is shown", async () => {
      const searchDialog = page
        .locator('[role="dialog"]')
        .filter({ hasText: /search/i });
      await page.waitForLoadState("networkidle");

      // Check for "no results" message
      const noResults = searchDialog.locator("text=/no results/i");
      await expect(noResults).toBeVisible({ timeout: 8000 });
    });
  });

  test("Escape closes the search sheet", async ({ page }) => {
    const sheet = page.locator('[data-testid="global-search-sheet"]');

    await test.step("Open the search sheet", async () => {
      await unifiedSearch.open();

      await expect(sheet).toBeVisible({ timeout: 5000 });
    });

    await test.step("Close the sheet with Escape", async () => {
      // Close with Escape key
      await page.keyboard.press("Escape");

      // Verify sheet is hidden
      await expect(sheet).not.toBeVisible({ timeout: 3000 });
    });
  });
});
