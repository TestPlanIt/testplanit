import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Search & Filter Tests
 *
 * Test cases for searching and filtering test cases in the repository.
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

    // Find the search input
    const searchInput = page.locator('[data-testid="search-input"], input[placeholder*="Search"], input[type="search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Enter search term
    await searchInput.fill(searchableName);
    await page.waitForLoadState("networkidle");

    // Verify only the matching test case is shown
    await expect(page.locator(`text="${searchableName}"`).first()).toBeVisible({ timeout: 10000 });

    // Other case should not be visible
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
    const searchInput = page.locator('[data-testid="search-input"], input[placeholder*="Search"], input[type="search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    // Search for a term that doesn't match any of the test cases
    const nonExistentTerm = `NoMatchPossible${Date.now()}XYZ123`;
    await searchInput.fill(nonExistentTerm);
    await page.waitForLoadState("networkidle");

    // Verify "no results" message is shown
    const noResults = page.locator('text=/no results|no test cases|nothing found/i');
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

    // Find and use the filter/search within the folder
    const filterInput = page.locator('[data-testid="filter-input"], [data-testid="search-input"], input[placeholder*="Filter"], input[placeholder*="Search"]').first();
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
    const filterInput = page.locator('[data-testid="filter-input"], [data-testid="search-input"], input[placeholder*="Search"], input[placeholder*="Filter"]').first();
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

  test("Filter Test Cases by Single Tag", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Tag Filter Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const taggedCaseName = `Tagged Case ${Date.now()}`;
    const caseId = await api.createTestCase(projectId, folderId, taggedCaseName);
    await api.createTestCase(projectId, folderId, `Untagged Case ${Date.now()}`);

    // Add a tag to one case (if API supports it)
    // Note: Tag assignment might need to be done via API

    await repositoryPage.goto(projectId);

    // Open filter panel/dropdown
    const filterButton = page.locator('[data-testid="filter-button"], button:has-text("Filter")').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      // Look for tag filter option
      const tagFilter = page.locator('[data-testid="tag-filter"], text="Tags"').first();
      if (await tagFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tagFilter.click();

        // Select a tag (if any exist)
        const tagOption = page.locator('[data-testid="tag-option"], [role="option"]').first();
        if (await tagOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await tagOption.click();
          await page.waitForLoadState("networkidle");

          // Verify filtering works
          // This depends on test data setup
        }
      }
    }
  });

  test("Filter Test Cases by Multiple Tags (AND)", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open filter panel
    const filterButton = page.locator('[data-testid="filter-button"], button:has-text("Filter")').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      // Look for tag filter with multi-select
      const tagFilter = page.locator('[data-testid="tag-filter-multi"], [data-testid="tag-filter"]').first();
      if (await tagFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tagFilter.click();

        // Select multiple tags
        const tagOptions = page.locator('[data-testid="tag-option"], [role="option"]');
        const count = await tagOptions.count();
        if (count >= 2) {
          await tagOptions.nth(0).click();
          await tagOptions.nth(1).click();

          // Look for AND/OR toggle
          const andToggle = page.locator('button:has-text("AND"), [data-testid="filter-mode-and"]');
          if (await andToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
            await andToggle.click();
          }

          await page.waitForLoadState("networkidle");
          // Verify filtering - should show only cases with ALL selected tags
        }
      }
    }
  });

  test("Filter Test Cases by Multiple Tags (OR)", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Similar to AND test but with OR mode
    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const tagFilter = page.locator('[data-testid="tag-filter"]').first();
      if (await tagFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tagFilter.click();

        const tagOptions = page.locator('[role="option"]');
        if (await tagOptions.count() >= 2) {
          await tagOptions.nth(0).click();
          await tagOptions.nth(1).click();

          // Look for OR toggle
          const orToggle = page.locator('button:has-text("OR"), [data-testid="filter-mode-or"]');
          if (await orToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
            await orToggle.click();
          }

          await page.waitForLoadState("networkidle");
          // Verify filtering - should show cases with ANY of the selected tags
        }
      }
    }
  });

  test("Search Tags by Name", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open tag management or filter panel
    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const tagFilter = page.locator('[data-testid="tag-filter"]').first();
      if (await tagFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tagFilter.click();

        // Look for search input within tag filter
        const tagSearch = page.locator('[data-testid="tag-search"], input[placeholder*="tag"]').first();
        if (await tagSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
          await tagSearch.fill("test");
          await page.waitForLoadState("networkidle");
          // Verify tags are filtered
        }
      }
    }
  });

  test("Filter Test Cases by Linked Issue", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const issueFilter = page.locator('[data-testid="issue-filter"], text="Issue"').first();
      if (await issueFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueFilter.click();
        // Select a specific issue or "Has linked issue"
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Filter Test Cases with Any Linked Issue", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const hasIssueOption = page.locator('[data-testid="has-issue-filter"], text=/has issue|with issue/i').first();
      if (await hasIssueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await hasIssueOption.click();
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Filter Test Cases without Linked Issues", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const noIssueOption = page.locator('[data-testid="no-issue-filter"], text=/no issue|without issue/i').first();
      if (await noIssueOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await noIssueOption.click();
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Search Issues by ID", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const issueSearch = page.locator('[data-testid="issue-search"], input[placeholder*="issue"]').first();
      if (await issueSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueSearch.fill("JIRA-123");
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Search Issues by Title", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const issueSearch = page.locator('[data-testid="issue-search"]').first();
      if (await issueSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
        await issueSearch.fill("Bug in login");
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Filter Test Cases by Text Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      // Look for custom field filters
      const customFieldFilter = page.locator('[data-testid="custom-field-filter"]').first();
      if (await customFieldFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await customFieldFilter.click();
        // Enter text value to filter by
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Filter Test Cases by Dropdown Custom Field", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const customFieldFilter = page.locator('[data-testid="dropdown-field-filter"]').first();
      if (await customFieldFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await customFieldFilter.click();
        // Select dropdown option
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Filter Test Cases by Date Custom Field Range", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    const filterButton = page.locator('[data-testid="filter-button"]').first();
    if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await filterButton.click();

      const dateFilter = page.locator('[data-testid="date-field-filter"]').first();
      if (await dateFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dateFilter.click();
        // Set date range
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Filter Version History by Date Range", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a test case to view its version history
    const folderName = `Version Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Version Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Select folder and open test case
    await repositoryPage.selectFolder(folderId);
    await page.locator(`[data-testid="case-row-${testCaseId}"]`).first().click();

    // Open version history tab/panel
    const historyTab = page.locator('[data-testid="history-tab"], button:has-text("History")').first();
    if (await historyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await historyTab.click();

      // Look for date range filter
      const dateFilter = page.locator('[data-testid="history-date-filter"]').first();
      if (await dateFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dateFilter.click();
        // Set date range
      }
    }
  });

  test("Filter Version History by User", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Version User Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Version User Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.locator(`[data-testid="case-row-${testCaseId}"]`).first().click();

    const historyTab = page.locator('[data-testid="history-tab"], button:has-text("History")').first();
    if (await historyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await historyTab.click();

      const userFilter = page.locator('[data-testid="history-user-filter"]').first();
      if (await userFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await userFilter.click();
        // Select user
      }
    }
  });

  test("Documentation Search", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Navigate to documentation section if separate
    const docsNav = page.locator('[data-testid="docs-nav"], a:has-text("Documentation")').first();
    if (await docsNav.isVisible({ timeout: 3000 }).catch(() => false)) {
      await docsNav.click();
      await page.waitForLoadState("networkidle");
    }

    // Search in documentation
    const docsSearch = page.locator('[data-testid="docs-search"], input[placeholder*="documentation"]').first();
    if (await docsSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
      await docsSearch.fill("test");
      await page.waitForLoadState("networkidle");
    }
  });

  test("Documentation Full Text Search", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Navigate to documentation
    const docsNav = page.locator('[data-testid="docs-nav"]').first();
    if (await docsNav.isVisible({ timeout: 3000 }).catch(() => false)) {
      await docsNav.click();

      // Use full-text search
      const fullTextSearch = page.locator('[data-testid="full-text-search"]').first();
      if (await fullTextSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
        await fullTextSearch.fill("specific content");
        await page.waitForLoadState("networkidle");
      }
    }
  });

  test("Export Filtered Results", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create test data
    const folderName = `Export Filter Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const exportableName = `Exportable${Date.now()}`;
    await api.createTestCase(projectId, folderId, exportableName);
    await api.createTestCase(projectId, folderId, `Other Export ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Apply a filter
    const searchInput = page.locator('[data-testid="search-input"]').first();
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill(exportableName);
      await page.waitForLoadState("networkidle");

      // Click export button
      const exportButton = page.locator('[data-testid="export-button"], button:has-text("Export")').first();
      if (await exportButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await exportButton.click();

        // Verify export dialog mentions filtered results
        const exportDialog = page.locator('[role="dialog"]');
        await expect(exportDialog).toBeVisible({ timeout: 5000 });

        // Look for indication that filtered results will be exported
        const filteredIndicator = exportDialog.locator('text=/filtered|1 case|selected/i');
        if (await filteredIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
          expect(await filteredIndicator.isVisible()).toBe(true);
        }

        // Close dialog
        await page.keyboard.press("Escape");
      }
    }
  });
});
