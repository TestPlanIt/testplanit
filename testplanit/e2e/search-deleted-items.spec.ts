import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
// import { setup, teardown } from "./helpers/test-setup";

test.describe("Search Deleted Items", () => {
  let testData: any;

  test.beforeAll(async () => {
    // testData = await setup();
    testData = {
      adminUser: { email: "admin@testplanit.com" },
      regularUser: { email: "user@test.com" },
      project: { id: 1 },
    };
  });

  test.afterAll(async () => {
    // await teardown(testData);
  });

  test("admin can access global search and see include deleted toggle", async ({
    page,
  }) => {
    // Login as admin
    await loginAsAdmin(page);
    await page.goto("/en-US/projects");

    // Open global search
    await page.click('[data-testid="global-search-trigger"]');
    await page.waitForSelector('[data-testid="global-search-sheet"]');

    // Verify search sheet opened
    await expect(
      page.locator('[data-testid="global-search-sheet"]')
    ).toBeVisible();

    // Open search filters
    await page.click('[data-testid="search-filters-button"]');
    await page.waitForSelector('[data-testid="faceted-search-filters"]');

    // Verify filters opened
    await expect(
      page.locator('[data-testid="faceted-search-filters"]')
    ).toBeVisible();

    // Admin should see "Include deleted items" toggle
    await expect(page.locator('text="Include deleted items"')).toBeVisible();

    // Verify the toggle exists and can be interacted with
    const deleteToggle = page.locator('[data-testid="include-deleted-toggle"]');
    await expect(deleteToggle).toBeVisible();

    // Test toggling it on and off
    await deleteToggle.click();
    await expect(deleteToggle).toBeChecked();

    await deleteToggle.click();
    await expect(deleteToggle).not.toBeChecked();
  });

  test("regular user cannot see deleted items in search", async ({ page }) => {
    // Login as regular user
    await page.goto("/en-US/signin");
    await page.getByTestId("email-input").fill("testuser@example.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();
    
    // Wait for successful login - wait for navigation away from signin page
    await page.waitForURL((url) => !url.pathname.includes('/signin'), { timeout: 10000 });
    
    // Ensure we're on a page with the search trigger
    await page.waitForSelector('[data-testid="global-search-trigger"]', { timeout: 10000 });
    
    // Navigate to the same project
    await page.goto(`/en-US/projects/overview/${testData.project.id}`);
    await page.waitForLoadState("networkidle");

    // Open global search
    await page.click('[data-testid="global-search-trigger"]');
    await page.waitForSelector('[data-testid="global-search-sheet"]');

    // Search for the deleted test case
    await page.fill('[placeholder*="Search"]', "Test Case for Deletion");
    await page.waitForTimeout(1000);

    // Should not find the deleted test case
    await expect(
      page.locator('text="Test Case for Deletion"')
    ).not.toBeVisible();

    // Open search filters
    await page.click('[data-testid="search-filters-button"]');
    await page.waitForSelector('[data-testid="faceted-search-filters"]');

    // "Include deleted items" toggle should not be visible to regular users
    await expect(
      page.locator('text="Include deleted items"')
    ).not.toBeVisible();
  });

  test("search functionality works with include deleted toggle", async ({
    page,
  }) => {
    // Login as admin
    await loginAsAdmin(page);
    await page.goto("/en-US/projects");

    // Open global search
    await page.click('[data-testid="global-search-trigger"]');
    await page.waitForSelector('[data-testid="global-search-sheet"]');

    // Test basic search functionality
    await page.fill('[placeholder*="Search"]', "test");
    await page.waitForTimeout(1000);

    // Open search filters and verify include deleted toggle functionality
    await page.click('[data-testid="search-filters-button"]');
    await page.waitForSelector('[data-testid="faceted-search-filters"]');

    // Verify the toggle works
    const deleteToggle = page.locator('[data-testid="include-deleted-toggle"]');
    await expect(deleteToggle).toBeVisible();

    // Toggle it and verify it stays checked
    await deleteToggle.click();
    await expect(deleteToggle).toBeChecked();

    // Close filters and reopen to verify state persists
    await page.keyboard.press("Escape");
    await page.click('[data-testid="search-filters-button"]');
    await expect(deleteToggle).toBeChecked();
  });

  test("search API is called with include deleted parameter", async ({
    page,
  }) => {
    // Login as admin
    await loginAsAdmin(page);
    await page.goto("/en-US/projects");

    // Set up network interception to verify API calls
    const apiRequests: any[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/search")) {
        apiRequests.push({
          url: request.url(),
          method: request.method(),
          postData: request.postData(),
        });
      }
    });

    // Open global search
    await page.click('[data-testid="global-search-trigger"]');
    await page.waitForSelector('[data-testid="global-search-sheet"]');

    // Perform a search to trigger API call
    await page.fill('[placeholder*="Search"]', "test");
    await page.waitForTimeout(1500); // Wait for debounced search

    // Open filters and enable include deleted
    await page.click('[data-testid="search-filters-button"]');
    await page.waitForSelector('[data-testid="faceted-search-filters"]');
    await page.click('[data-testid="include-deleted-toggle"]');

    // Wait for another search with includeDeleted enabled
    await page.waitForTimeout(1500);

    // Verify API was called and includeDeleted parameter is being sent
    expect(apiRequests.length).toBeGreaterThan(0);

    // At least one request should have includeDeleted in the payload
    const hasIncludeDeletedRequest = apiRequests.some((req) => {
      if (req.postData) {
        try {
          const data = JSON.parse(req.postData);
          return data.filters && data.filters.includeDeleted === true;
        } catch (e) {
          return false;
        }
      }
      return false;
    });

    expect(hasIncludeDeletedRequest).toBe(true);
  });

  test("search filters persist and close properly", async ({ page }) => {
    // Login as admin
    await loginAsAdmin(page);
    await page.goto("/en-US/projects");

    // Open global search
    await page.click('[data-testid="global-search-trigger"]');
    await page.waitForSelector('[data-testid="global-search-sheet"]');

    // Open search filters
    await page.click('[data-testid="search-filters-button"]');
    await page.waitForSelector('[data-testid="faceted-search-filters"]');

    // Enable include deleted
    const deleteToggle = page.locator('[data-testid="include-deleted-toggle"]');
    await deleteToggle.click();
    await expect(deleteToggle).toBeChecked();

    // Close filters with Escape
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-testid="faceted-search-filters"]')
    ).not.toBeVisible();

    // Reopen filters and verify state persisted
    await page.click('[data-testid="search-filters-button"]');
    await expect(
      page.locator('[data-testid="faceted-search-filters"]')
    ).toBeVisible();
    await expect(deleteToggle).toBeChecked();

    // Close search sheet entirely
    await page.keyboard.press("Escape"); // Close filters
    await page.keyboard.press("Escape"); // Close search sheet
    await expect(
      page.locator('[data-testid="global-search-sheet"]')
    ).not.toBeVisible();
  });
});
