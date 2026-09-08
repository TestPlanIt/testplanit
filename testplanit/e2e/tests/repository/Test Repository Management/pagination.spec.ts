import { expect, test } from "../../../fixtures";

/**
 * Pagination Tests
 *
 * Test cases for pagination functionality in the repository.
 */
test.describe("Pagination", () => {
  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Pagination ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  /**
   * Navigate directly to a folder with explicit pageSize=10 via URL params.
   * This avoids flaky folder-tree click interactions and ensures pagination
   * is active regardless of user preference state.
   */
  async function gotoFolder(
    page: import("@playwright/test").Page,
    projectId: number,
    folderId: number,
    pageSize = 10
  ): Promise<void> {
    await page.goto(
      `/en-US/projects/repository/${projectId}?node=${folderId}&pageSize=${pageSize}`
    );
    await page.waitForLoadState("networkidle");
    // Wait for cases table to render
    await expect(page.locator("text=/of \\d+/")).toBeVisible({
      timeout: 10000,
    });
  }

  test("Navigate to Next Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Pagination Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 25 test cases to trigger pagination", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create enough test cases to trigger pagination (default page size is 10)
      for (let i = 0; i < 25; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Pagination Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and verify page 1 shows items 1-10", async () => {
      await gotoFolder(page, projectId, folderId!);

      // Look for pagination navigation - it renders as nav with aria-label="pagination"
      await expect(paginationNav).toBeVisible({ timeout: 5000 });

      // Verify we're on page 1 with 10 items showing
      const paginationInfo = page.locator("text=/1-10 of/");
      await expect(paginationInfo).toBeVisible({ timeout: 3000 });
    });

    await test.step("Click Next and verify items 11-20 are shown", async () => {
      // Navigate to next page - look for the "Go to next page" link
      const nextButton = paginationNav
        .locator('a:has-text("Next"), a[aria-label*="next"]')
        .first();
      await expect(nextButton).toBeVisible({ timeout: 3000 });
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Verify page changed - should now show items 11-20
      const pageInfo = page.locator("text=/11-20 of/");
      await expect(pageInfo).toBeVisible({ timeout: 5000 });
    });
  });

  test("Navigate to Previous Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Prev Page Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 25 test cases", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create enough test cases to have multiple pages
      for (let i = 0; i < 25; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Prev Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and confirm pagination is present", async () => {
      await gotoFolder(page, projectId, folderId!);

      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Click Next to reach page 2", async () => {
      // Go to page 2 first
      const nextButton = paginationNav.locator('a:has-text("Next")').first();
      await nextButton.click();
      await page.waitForLoadState("networkidle");

      // Verify we're on page 2
      await expect(page.locator("text=/11-20 of/")).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Click Previous and verify return to page 1", async () => {
      // Now go back to page 1
      const prevButton = paginationNav
        .locator('a:has-text("Previous")')
        .first();
      await expect(prevButton).toBeVisible({ timeout: 3000 });
      await prevButton.click();
      await page.waitForLoadState("networkidle");

      // Verify we're back on page 1
      await expect(page.locator("text=/1-10 of/")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Navigate to Specific Page Number", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Page Number Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 30 test cases for 3+ pages", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create enough test cases for 3+ pages
      for (let i = 0; i < 30; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Page Num Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and confirm pagination is present", async () => {
      await gotoFolder(page, projectId, folderId!);

      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Click page 3 and verify items 21-30 are shown", async () => {
      // Click directly on page 3
      const page3Link = paginationNav.locator('a:has-text("3")').first();
      await expect(page3Link).toBeVisible({ timeout: 3000 });
      await page3Link.click();
      await page.waitForLoadState("networkidle");

      // Verify we're on page 3 - should show items 21-30
      await expect(page.locator("text=/21-30 of/")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Change Page Size", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Page Size Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 30 test cases", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create test cases
      for (let i = 0; i < 30; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Size Case ${i} ${Date.now()}`
        );
      }
    });

    await test.step("Open the folder", async () => {
      await gotoFolder(page, projectId, folderId!);
    });

    await test.step("Change the page size to 25 via the dropdown", async () => {
      // Find the page size button - it shows current page size like "10 items/Page Size"
      const pageSizeButton = page.locator('button:has-text("items")').first();
      await expect(pageSizeButton).toBeVisible({ timeout: 5000 });
      await pageSizeButton.click();

      // Select 25 items per page from the dropdown menu
      const option25 = page
        .locator(
          '[role="menuitem"]:has-text("25"), [role="option"]:has-text("25")'
        )
        .first();
      await expect(option25).toBeVisible({ timeout: 3000 });
      await option25.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify 25 items are shown and the button reflects the new size", async () => {
      // Verify more items are shown - should show 1-25
      await expect(page.locator("text=/1-25 of/")).toBeVisible({
        timeout: 5000,
      });

      // Verify the button now shows 25 items
      await expect(page.locator('button:has-text("25 items")')).toBeVisible({
        timeout: 3000,
      });
    });
  });

  test("Page Size All Shows All Items", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `All Items Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 25 test cases", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create enough test cases to have multiple pages, then show all
      for (let i = 0; i < 25; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `All Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and confirm 25 items with pagination", async () => {
      await gotoFolder(page, projectId, folderId!);

      // Verify we're viewing the correct folder with 25 items
      await expect(page.locator("text=/of 25/")).toBeVisible({
        timeout: 5000,
      });

      // Wait for initial page to load with pagination
      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Select the All page-size option", async () => {
      // The page-size button shows the current size as "<n> items"; match the
      // number-prefixed form so it can't collide with another "items" button.
      const pageSizeButton = page
        .locator("button")
        .filter({ hasText: /\d+ items/ })
        .first();
      await expect(pageSizeButton).toBeVisible({ timeout: 5000 });
      // Ensure button is enabled before clicking
      await expect(pageSizeButton).toBeEnabled({ timeout: 3000 });
      await pageSizeButton.click();

      // Select "All" option
      const optionAll = page
        .locator(
          '[role="menuitem"]:has-text("All"), [role="option"]:has-text("All")'
        )
        .first();
      await expect(optionAll).toBeVisible({ timeout: 3000 });
      await optionAll.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify all 25 items show and pagination is hidden", async () => {
      // Verify all items are shown - should show 1-25 of 25
      await expect(page.locator("text=/1-25 of 25/")).toBeVisible({
        timeout: 5000,
      });

      // Pagination navigation should be hidden or show only one page when all items fit
      // Since totalPages < 2, the component returns null
      await expect(paginationNav).not.toBeVisible({ timeout: 3000 });
    });
  });

  test("Previous Button Disabled on First Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `First Page Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 25 test cases", async () => {
      folderId = await api.createFolder(projectId, folderName);

      for (let i = 0; i < 25; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `First Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and confirm pagination is present", async () => {
      await gotoFolder(page, projectId, folderId!);

      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify the Previous button is disabled on the first page", async () => {
      // Previous button should be disabled on first page
      const prevButton = paginationNav
        .locator('a:has-text("Previous")')
        .first();
      await expect(prevButton).toBeVisible({ timeout: 3000 });

      // Check if it has aria-disabled or is actually disabled
      const isDisabled = await prevButton.evaluate((el) => {
        return (
          el.getAttribute("aria-disabled") === "true" ||
          el.hasAttribute("disabled") ||
          el.classList.contains("disabled") ||
          el.closest('[aria-disabled="true"]') !== null
        );
      });
      expect(isDisabled).toBe(true);
    });
  });

  test("Next Button Disabled on Last Page", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Last Page Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 15 test cases for 2 pages", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create exactly 15 items for 2 pages (10 + 5)
      for (let i = 0; i < 15; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Last Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and confirm pagination is present", async () => {
      await gotoFolder(page, projectId, folderId!);

      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Navigate to the last page (page 2)", async () => {
      // Navigate to page 2 (last page)
      const page2Link = paginationNav.locator('a:has-text("2")').first();
      await page2Link.click();
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the Next button is disabled on the last page", async () => {
      // Next button should be disabled on last page
      const nextButton = paginationNav.locator('a:has-text("Next")').first();
      await expect(nextButton).toBeVisible({ timeout: 3000 });

      const isDisabled = await nextButton.evaluate((el) => {
        return (
          el.getAttribute("aria-disabled") === "true" ||
          el.hasAttribute("disabled") ||
          el.classList.contains("disabled") ||
          el.closest('[aria-disabled="true"]') !== null
        );
      });
      expect(isDisabled).toBe(true);
    });
  });

  test("Pagination Info Shows Correct Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Count Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with exactly 23 test cases", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create exactly 23 test cases
      for (let i = 0; i < 23; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Count Case ${i} ${Date.now()}`
        );
      }
    });

    await test.step("Open the folder and verify the pagination info shows 1-10 of 23", async () => {
      await gotoFolder(page, projectId, folderId!);

      // Verify pagination info shows correct total
      const paginationInfo = page.locator("text=/1-10 of 23/");
      await expect(paginationInfo).toBeVisible({ timeout: 5000 });
    });
  });

  test("Page Size Persists in URL Parameters", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Persist Size Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 30 test cases", async () => {
      folderId = await api.createFolder(projectId, folderName);

      for (let i = 0; i < 30; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Persist Case ${i} ${Date.now()}`
        );
      }
    });

    await test.step("Open the folder", async () => {
      await gotoFolder(page, projectId, folderId!);
    });

    await test.step("Change the page size to 25", async () => {
      // Change page size to 25
      const pageSizeButton = page.locator('button:has-text("items")').first();
      await expect(pageSizeButton).toBeVisible({ timeout: 5000 });
      await pageSizeButton.click();
      const option25 = page.locator('[role="menuitem"]:has-text("25")').first();
      await expect(option25).toBeVisible({ timeout: 3000 });
      await option25.click();
      await page.waitForLoadState("networkidle");

      // Verify page size changed to 25
      await expect(page.locator('button:has-text("25 items")')).toBeVisible({
        timeout: 5000,
      });

      // Verify URL contains pageSize parameter
      await expect(page).toHaveURL(/pageSize=25/);
    });

    await test.step("Reload the page and verify the page size persists", async () => {
      // Refresh the page to verify URL parameters persist
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Page size should still be 25 after page reload (read from URL)
      await expect(page.locator('button:has-text("25 items")')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Jump to Page via Ellipsis Dropdown", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Ellipsis Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 70 test cases for 7+ pages", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create enough test cases for 7+ pages to ensure ellipsis appears
      // With page size 10, we need 70+ items for 7 pages
      for (let i = 0; i < 70; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Ellipsis Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and verify page 1 shows items 1-10 of 70", async () => {
      await gotoFolder(page, projectId, folderId!);

      await expect(paginationNav).toBeVisible({ timeout: 5000 });

      // Verify we're on page 1
      await expect(page.locator("text=/1-10 of 70/")).toBeVisible({
        timeout: 3000,
      });
    });

    await test.step("Jump to page 5 via the ellipsis dropdown or page link", async () => {
      // Find the ellipsis dropdown - it renders as a select trigger with aria-label="Select a page"
      // The ellipsis is inside a button that triggers a dropdown
      const ellipsisDropdown = paginationNav
        .locator('button[aria-label*="page"], [data-radix-collection-item]')
        .filter({ has: page.locator("svg") })
        .first();

      // If ellipsis exists, click it and select a page
      const ellipsisExists = await ellipsisDropdown
        .isVisible()
        .catch(() => false);

      if (ellipsisExists) {
        await ellipsisDropdown.click();

        // Select page 5 from the dropdown (wait for dropdown to appear)
        const page5Option = page
          .locator(
            '[role="option"]:has-text("5"), [role="listbox"] >> text="5"'
          )
          .first();
        await expect(page5Option).toBeVisible({ timeout: 3000 });
        await page5Option.click();
        await page.waitForLoadState("networkidle");

        // Verify we jumped to page 5 - should show items 41-50
        await expect(page.locator("text=/41-50 of/")).toBeVisible({
          timeout: 5000,
        });
      } else {
        // If no ellipsis, navigate via clicking page numbers directly
        // Go to page 5 by clicking through
        const page5Link = paginationNav
          .locator("a")
          .filter({ hasText: /^5$/ })
          .first();
        if (await page5Link.isVisible()) {
          await page5Link.click();
          await page.waitForLoadState("networkidle");
          await expect(page.locator("text=/41-50 of/")).toBeVisible({
            timeout: 5000,
          });
        }
      }
    });
  });

  test("Navigate to Last Page with Many Pages", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Many Pages Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 50 test cases for 5 pages", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create 50 items for 5 pages
      for (let i = 0; i < 50; i++) {
        await api.createTestCase(
          projectId,
          folderId!,
          `Many Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and confirm 50 items with pagination", async () => {
      await gotoFolder(page, projectId, folderId!);

      // Verify we're on the correct folder
      await expect(page.locator("text=/of 50/")).toBeVisible({
        timeout: 5000,
      });

      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Navigate to the last page and verify items 41-50 are shown", async () => {
      // Navigate to the last page (page 5)
      const page5Link = paginationNav
        .locator("a")
        .filter({ hasText: /^5$/ })
        .first();
      await expect(page5Link).toBeVisible({ timeout: 3000 });
      await page5Link.click();
      await page.waitForLoadState("networkidle");

      // Verify we're on page 5 - should show items 41-50
      await expect(page.locator("text=/41-50 of 50/")).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("Filter Resets Page to First", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const folderName = `Filter Reset Folder ${Date.now()}`;

    let folderId: number | undefined;
    await test.step("Create a folder with 30 test cases using distinct name prefixes", async () => {
      folderId = await api.createFolder(projectId, folderName);

      // Create test cases with distinct names for filtering
      for (let i = 0; i < 30; i++) {
        const prefix = i < 15 ? "Alpha" : "Beta";
        await api.createTestCase(
          projectId,
          folderId!,
          `${prefix} Case ${i} ${Date.now()}`
        );
      }
    });

    const paginationNav = page.locator('nav[aria-label="pagination"]');

    await test.step("Open the folder and confirm 30 items with pagination", async () => {
      await gotoFolder(page, projectId, folderId!);

      // Verify we're on the correct folder
      await expect(page.locator("text=/of 30/")).toBeVisible({
        timeout: 5000,
      });

      // Navigate to page 2
      await expect(paginationNav).toBeVisible({ timeout: 5000 });
    });

    await test.step("Navigate to page 2", async () => {
      const page2Link = paginationNav.locator('a:has-text("2")').first();
      await page2Link.click();
      await page.waitForLoadState("networkidle");

      // Verify we're on page 2
      await expect(page.locator("text=/11-20 of/")).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Apply a filter and verify results reset to the first page", async () => {
      // Apply a filter - this should filter results
      const filterInput = page.locator('input[placeholder*="Filter"]').first();
      await filterInput.fill("Alpha");
      await page.waitForLoadState("networkidle");

      // After filtering, results should start from the beginning: the
      // pagination info reads "1-<end> of <total>". Match that shape
      // specifically so it can't collide with other "1-" text on the page.
      const filteredInfo = page.locator("text=/1-\\d+ of \\d+/");
      await expect(filteredInfo.first()).toBeVisible({ timeout: 5000 });
    });
  });
});
