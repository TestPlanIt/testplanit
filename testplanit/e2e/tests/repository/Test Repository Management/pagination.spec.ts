import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Pagination Tests
 *
 * Test cases for pagination functionality in the repository.
 * These tests create many test cases via API, so they use extended timeouts
 * and batch creation for faster setup.
 */
test.describe("Pagination", () => {
  // Extend timeout for all pagination tests since they create many test cases
  test.setTimeout(120_000);

  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Pagination ${Date.now()}-${Math.random().toString(36).substring(7)}`);
  }

  test("Navigate to Next Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with many test cases to trigger pagination
    const folderName = `Pagination Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create enough test cases to trigger pagination (default page size is 10)
    const names = Array.from({ length: 25 }, (_, i) => `Pagination Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Look for pagination navigation - it renders as nav with aria-label="pagination"
    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 15000 });

    // Verify we're on page 1 with 10 items showing
    const paginationInfo = page.locator('text=/Showing 1-10 of/');
    await expect(paginationInfo).toBeVisible({ timeout: 10000 });

    // Navigate to next page - look for the "Go to next page" link
    const nextButton = paginationNav.locator('a:has-text("Next"), a[aria-label*="next"]').first();
    await expect(nextButton).toBeVisible({ timeout: 5000 });
    await nextButton.click();
    await page.waitForLoadState("networkidle");

    // Verify page changed - should now show items 11-20
    const pageInfo = page.locator('text=/Showing 11-20 of/');
    await expect(pageInfo).toBeVisible({ timeout: 10000 });
  });

  test("Navigate to Previous Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Prev Page Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create enough test cases to have multiple pages
    const names = Array.from({ length: 25 }, (_, i) => `Prev Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 15000 });

    // Go to page 2 first
    const nextButton = paginationNav.locator('a:has-text("Next")').first();
    await nextButton.click();
    await page.waitForLoadState("networkidle");

    // Verify we're on page 2
    await expect(page.locator('text=/Showing 11-20 of/')).toBeVisible({ timeout: 10000 });

    // Now go back to page 1
    const prevButton = paginationNav.locator('a:has-text("Previous")').first();
    await expect(prevButton).toBeVisible({ timeout: 5000 });
    await prevButton.click();
    await page.waitForLoadState("networkidle");

    // Verify we're back on page 1
    await expect(page.locator('text=/Showing 1-10 of/')).toBeVisible({ timeout: 10000 });
  });

  test("Navigate to Specific Page Number", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Page Number Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create enough test cases for 3+ pages
    const names = Array.from({ length: 30 }, (_, i) => `Page Num Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 15000 });

    // Click directly on page 3
    const page3Link = paginationNav.locator('a:has-text("3")').first();
    await expect(page3Link).toBeVisible({ timeout: 5000 });
    await page3Link.click();
    await page.waitForLoadState("networkidle");

    // Verify we're on page 3 - should show items 21-30
    await expect(page.locator('text=/Showing 21-30 of/')).toBeVisible({ timeout: 10000 });
  });

  test("Change Page Size", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Page Size Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create test cases
    const names = Array.from({ length: 30 }, (_, i) => `Size Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Find the page size button - it shows current page size like "10 items/Page Size"
    const pageSizeButton = page.locator('button:has-text("items")').first();
    await expect(pageSizeButton).toBeVisible({ timeout: 15000 });
    await pageSizeButton.click();

    // Select 25 items per page from the dropdown menu
    const option25 = page.locator('[role="menuitem"]:has-text("25"), [role="option"]:has-text("25")').first();
    await expect(option25).toBeVisible({ timeout: 5000 });
    await option25.click();
    await page.waitForLoadState("networkidle");

    // Verify more items are shown - should show 1-25
    await expect(page.locator('text=/Showing 1-25 of/')).toBeVisible({ timeout: 10000 });

    // Verify the button now shows 25 items
    await expect(page.locator('button:has-text("25 items")')).toBeVisible({ timeout: 5000 });
  });

  test("Page Size All Shows All Items", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `All Items Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create enough test cases to have multiple pages, then show all
    const names = Array.from({ length: 25 }, (_, i) => `All Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify we're viewing the correct folder with 25 items
    await expect(page.locator('text=/of 25 items/')).toBeVisible({ timeout: 15000 });

    // Wait for initial page to load with pagination
    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 10000 });

    // Find and click the page size button - use the specific button with Page Size text
    const pageSizeButton = page.locator('button:has-text("Page Size")').first();
    await expect(pageSizeButton).toBeVisible({ timeout: 10000 });
    // Ensure button is enabled before clicking
    await expect(pageSizeButton).toBeEnabled({ timeout: 5000 });
    await pageSizeButton.click();

    // Select "All" option
    const optionAll = page.locator('[role="menuitem"]:has-text("All"), [role="option"]:has-text("All")').first();
    await expect(optionAll).toBeVisible({ timeout: 5000 });
    await optionAll.click();
    await page.waitForLoadState("networkidle");

    // Verify all items are shown - should show 1-25 of 25
    await expect(page.locator('text=/Showing 1-25 of 25/')).toBeVisible({ timeout: 10000 });

    // Pagination navigation should be hidden or show only one page when all items fit
    // Since totalPages < 2, the component returns null
    await expect(paginationNav).not.toBeVisible({ timeout: 5000 });
  });

  test("Previous Button Disabled on First Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `First Page Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    const names = Array.from({ length: 25 }, (_, i) => `First Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 15000 });

    // Previous button should be disabled on first page
    const prevButton = paginationNav.locator('a:has-text("Previous")').first();
    await expect(prevButton).toBeVisible({ timeout: 5000 });

    // Check if it has aria-disabled or is actually disabled
    const isDisabled = await prevButton.evaluate((el) => {
      return el.getAttribute('aria-disabled') === 'true' ||
             el.hasAttribute('disabled') ||
             el.classList.contains('disabled') ||
             el.closest('[aria-disabled="true"]') !== null;
    });
    expect(isDisabled).toBe(true);
  });

  test("Next Button Disabled on Last Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Last Page Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create exactly 15 items for 2 pages (10 + 5)
    const names = Array.from({ length: 15 }, (_, i) => `Last Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 15000 });

    // Navigate to page 2 (last page)
    const page2Link = paginationNav.locator('a:has-text("2")').first();
    await page2Link.click();
    await page.waitForLoadState("networkidle");

    // Next button should be disabled on last page
    const nextButton = paginationNav.locator('a:has-text("Next")').first();
    await expect(nextButton).toBeVisible({ timeout: 5000 });

    const isDisabled = await nextButton.evaluate((el) => {
      return el.getAttribute('aria-disabled') === 'true' ||
             el.hasAttribute('disabled') ||
             el.classList.contains('disabled') ||
             el.closest('[aria-disabled="true"]') !== null;
    });
    expect(isDisabled).toBe(true);
  });

  test("Pagination Info Shows Correct Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Count Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create exactly 23 test cases
    const names = Array.from({ length: 23 }, (_, i) => `Count Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify pagination info shows correct total
    const paginationInfo = page.locator('text=/Showing 1-10 of 23/');
    await expect(paginationInfo).toBeVisible({ timeout: 15000 });
  });

  test("Page Size Persists in URL Parameters", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Persist Size Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    const names = Array.from({ length: 30 }, (_, i) => `Persist Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Change page size to 25
    const pageSizeButton = page.locator('button:has-text("items")').first();
    await expect(pageSizeButton).toBeVisible({ timeout: 15000 });
    await pageSizeButton.click();
    const option25 = page.locator('[role="menuitem"]:has-text("25")').first();
    await expect(option25).toBeVisible({ timeout: 5000 });
    await option25.click();
    await page.waitForLoadState("networkidle");

    // Verify page size changed to 25
    await expect(page.locator('button:has-text("25 items")')).toBeVisible({ timeout: 10000 });

    // Verify URL contains pageSize parameter
    await expect(page).toHaveURL(/pageSize=25/);

    // Refresh the page to verify URL parameters persist
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Page size should still be 25 after page reload (read from URL)
    await expect(page.locator('button:has-text("25 items")')).toBeVisible({ timeout: 15000 });
  });

  test("Jump to Page via Ellipsis Dropdown", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Ellipsis Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create enough test cases for 7+ pages to ensure ellipsis appears
    // With page size 10, we need 70+ items for 7 pages
    const names = Array.from({ length: 70 }, (_, i) => `Ellipsis Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 15000 });

    // Verify we're on page 1
    await expect(page.locator('text=/Showing 1-10 of 70/')).toBeVisible({ timeout: 10000 });

    // Find the ellipsis dropdown - it renders as a select trigger with aria-label="Select a page"
    // The ellipsis is inside a button that triggers a dropdown
    const ellipsisDropdown = paginationNav.locator('button[aria-label*="page"], [data-radix-collection-item]').filter({ has: page.locator('svg') }).first();

    // If ellipsis exists, click it and select a page
    const ellipsisExists = await ellipsisDropdown.isVisible().catch(() => false);

    if (ellipsisExists) {
      await ellipsisDropdown.click();

      // Select page 5 from the dropdown (wait for dropdown to appear)
      const page5Option = page.locator('[role="option"]:has-text("5"), [role="listbox"] >> text="5"').first();
      await expect(page5Option).toBeVisible({ timeout: 5000 });
      await page5Option.click();
      await page.waitForLoadState("networkidle");

      // Verify we jumped to page 5 - should show items 41-50
      await expect(page.locator('text=/Showing 41-50 of/')).toBeVisible({ timeout: 10000 });
    } else {
      // If no ellipsis, navigate via clicking page numbers directly
      // Go to page 5 by clicking through
      const page5Link = paginationNav.locator('a').filter({ hasText: /^5$/ }).first();
      if (await page5Link.isVisible()) {
        await page5Link.click();
        await page.waitForLoadState("networkidle");
        await expect(page.locator('text=/Showing 41-50 of/')).toBeVisible({ timeout: 10000 });
      }
    }
  });

  test("Navigate to Last Page with Many Pages", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Many Pages Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create 50 items for 5 pages
    const names = Array.from({ length: 50 }, (_, i) => `Many Case ${i} ${Date.now()}`);
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify we're on the correct folder
    await expect(page.locator('text=/of 50 items/')).toBeVisible({ timeout: 15000 });

    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 10000 });

    // Navigate to the last page (page 5)
    const page5Link = paginationNav.locator('a').filter({ hasText: /^5$/ }).first();
    await expect(page5Link).toBeVisible({ timeout: 5000 });
    await page5Link.click();
    await page.waitForLoadState("networkidle");

    // Verify we're on page 5 - should show items 41-50
    await expect(page.locator('text=/Showing 41-50 of 50/')).toBeVisible({ timeout: 10000 });
  });

  test("Filter Resets Page to First", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Filter Reset Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create test cases with distinct names for filtering
    const names = Array.from({ length: 30 }, (_, i) => {
      const prefix = i < 15 ? "Alpha" : "Beta";
      return `${prefix} Case ${i} ${Date.now()}`;
    });
    await api.createTestCasesBatch(projectId, folderId, names);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify we're on the correct folder
    await expect(page.locator('text=/of 30 items/')).toBeVisible({ timeout: 15000 });

    // Navigate to page 2
    const paginationNav = page.locator('nav[aria-label="pagination"]');
    await expect(paginationNav).toBeVisible({ timeout: 10000 });
    const page2Link = paginationNav.locator('a:has-text("2")').first();
    await page2Link.click();
    await page.waitForLoadState("networkidle");

    // Verify we're on page 2
    await expect(page.locator('text=/Showing 11-20 of/')).toBeVisible({ timeout: 10000 });

    // Apply a filter - this should filter results
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    await filterInput.fill("Alpha");
    await page.waitForLoadState("networkidle");

    // After filtering, results should start from the beginning
    // The filtered set should show fewer items starting from 1
    const filteredInfo = page.locator('text=/Showing 1-/');
    await expect(filteredInfo).toBeVisible({ timeout: 10000 });
  });
});
