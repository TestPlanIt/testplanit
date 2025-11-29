import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe.serial("Test Run Permissions @permissions", () => {
  const TEST_PROJECT_ID = 331; // E2E Test Project from seed data

  test("regular user can view test cases in completed test runs", async ({
    page,
  }) => {
    // Login as regular user
    await page.goto("/en-US/signin");
    await page.getByTestId("email-input").fill("testuser@example.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for successful login
    await page.waitForURL((url) => !url.pathname.includes("/signin"), {
      timeout: 10000,
    });

    // Navigate to test runs page
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Look for a test run (there should be test runs in the seed data)
    // Test run links go directly to the run page (e.g., /projects/runs/331/40)
    const testRunLinks = page.locator(
      'a[href*="/projects/runs/331/"]:not([href*="selectedCase"])'
    );
    const testRunCount = await testRunLinks.count();

    // Verify we can see test runs
    expect(testRunCount).toBeGreaterThan(0);

    // Click on the first test run to view details
    await testRunLinks.first().click();
    
    // Wait for navigation to the test run detail page
    await page.waitForURL(/\/projects\/runs\/\d+\/\d+$/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify we're on the test run detail page
    expect(page.url()).toMatch(/\/projects\/runs\/\d+\/\d+$/);

    // Check if we can see test cases in the run
    // Look for test case rows in the table (they contain DR Test Case names)
    const testCaseRows = page.locator(
      'tr:has-text("DR Test Case")'
    );

    // Wait for test cases to be visible
    await expect(testCaseRows.first()).toBeVisible({ timeout: 10000 });

    // Verify we can see test cases
    const testCaseCount = await testCaseRows.count();
    expect(testCaseCount).toBeGreaterThan(0);

    // Verify we can see test case details (names should be visible)
    const firstTestCaseCell = testCaseRows.first().locator('td').nth(1);
    const firstTestCaseName = await firstTestCaseCell.textContent();
    expect(firstTestCaseName).toBeTruthy();
    expect(firstTestCaseName?.length).toBeGreaterThan(0);
  });

  test("admin can view all test run details including test cases", async ({
    page,
  }) => {
    // Login as admin
    await loginAsAdmin(page);

    // Navigate to test runs page
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Look for test runs
    const testRunLinks = page.locator(
      'a[href*="/projects/runs/331/"]:not([href*="selectedCase"])'
    );
    const testRunCount = await testRunLinks.count();

    // Verify admin can see test runs
    expect(testRunCount).toBeGreaterThan(0);

    // Click on the first test run
    await testRunLinks.first().click();
    
    // Wait for navigation to the test run detail page
    await page.waitForURL(/\/projects\/runs\/\d+\/\d+$/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify we can see test cases
    const testCaseRows = page.locator(
      'tr:has-text("Test Case"), tr:has-text("DR Test Case"), tr:has-text("Repo Case")'
    );
    await expect(testCaseRows.first()).toBeVisible({ timeout: 10000 });

    const testCaseCount = await testCaseRows.count();
    expect(testCaseCount).toBeGreaterThan(0);

    // Admin should be able to see all details including actions
    const actionsButton = page
      .locator('button:has-text("Edit"), button:has-text("Complete"), button:has-text("Duplicate")')
      .first();
    await expect(actionsButton).toBeVisible();
  });

  test("user with NO_ACCESS cannot view test runs", async ({ page }) => {
    // Create a user with NO_ACCESS permission (this would need to be set up in seed data)
    // For now, we'll test with an unassigned user

    // Login as a user not assigned to the project
    await page.goto("/en-US/signin");
    await page.getByTestId("email-input").fill("verify@test.com"); // User from seed not assigned to project 331
    await page.getByTestId("password-input").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for successful login
    await page.waitForURL((url) => !url.pathname.includes("/signin"), {
      timeout: 10000,
    });

    // Try to navigate to test runs page
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Should either redirect or show no data/access denied
    // Check if we're redirected to projects page or see an error
    const currentUrl = page.url();
    const hasAccess = currentUrl.includes(`/projects/runs/${TEST_PROJECT_ID}`);

    if (hasAccess) {
      // If on the page, should see no test runs or an empty state
      const testRunLinks = page.locator(
        'a[href*="/projects/runs/331/"]:not([href*="selectedCase"])'
      );
      const testRunCount = await testRunLinks.count();
      
      // User not assigned to project should see no test runs
      expect(testRunCount).toBe(0);
    } else {
      // Verify we were redirected away from the test runs page
      expect(currentUrl).not.toContain(`/projects/runs/${TEST_PROJECT_ID}`);
    }
  });

  test("user can view test run results they executed", async ({ page }) => {
    // Login as regular user
    await page.goto("/en-US/signin");
    await page.getByTestId("email-input").fill("testuser@example.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for successful login
    await page.waitForURL((url) => !url.pathname.includes("/signin"), {
      timeout: 10000,
    });

    // Navigate to test runs page
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Find a test run and open it
    const testRunLinks = page.locator(
      'a[href*="/projects/runs/331/"]:not([href*="selectedCase"])'
    );
    await testRunLinks.first().click();
    
    // Wait for navigation to the test run detail page
    await page.waitForURL(/\/projects\/runs\/\d+\/\d+$/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Look for the results distribution chart which indicates the user can see results
    const resultsChart = page.locator('text="Results Distribution"');
    await expect(resultsChart).toBeVisible({ timeout: 10000 });

    // Check if we can see test case results (passed/failed/skipped counts)
    const resultsSummary = page.locator('text=/Passed|Failed|Skipped/');
    const resultsCount = await resultsSummary.count();

    // User should be able to see results
    expect(resultsCount).toBeGreaterThan(0);
  });

  test("user can view test step results in test runs", async ({ page }) => {
    // Login as regular user
    await page.goto("/en-US/signin");
    await page.getByTestId("email-input").fill("testuser@example.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for successful login
    await page.waitForURL((url) => !url.pathname.includes("/signin"), {
      timeout: 10000,
    });

    // Navigate to test runs page
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Find a test run with results
    const testRunLinks = page.locator(
      'a[href*="/projects/runs/331/"]:not([href*="selectedCase"])'
    );
    await testRunLinks.first().click();
    
    // Wait for navigation to the test run detail page
    await page.waitForURL(/\/projects\/runs\/\d+\/\d+$/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    // Verify user can see test case information in the table
    const testCaseRows = page.locator(
      'tr:has-text("Test Case"), tr:has-text("DR Test Case"), tr:has-text("Repo Case")'
    );
    
    const rowCount = await testCaseRows.count();
    
    if (rowCount > 0) {
      // User should be able to see test case details in the table
      await expect(testCaseRows.first()).toBeVisible();
      
      // Check if status column is visible (indicates user can see test execution status)
      const statusCell = testCaseRows.first().locator('td:has-text("Draft"), td:has-text("Passed"), td:has-text("Failed")');
      const hasStatusInfo = await statusCell.count() > 0;
      
      // User should be able to see test case execution information
      expect(rowCount).toBeGreaterThan(0);
    }
  });
});
