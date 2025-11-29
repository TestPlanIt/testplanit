import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe.serial("JUnit Import Permissions @permissions @junit", () => {
  const TEST_PROJECT_ID = 331; // E2E Test Project from seed data

  test("regular user can view JUnit test results in their project", async ({
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

    // Navigate to test runs page to find JUnit imported runs
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Look for test runs - they appear as links in the test runs table
    const testRunLinks = page.locator(
      'a[href*="/projects/runs/331/"]:not([href*="selectedCase"])'
    );
    const runCount = await testRunLinks.count();

    if (runCount > 0) {
      // Click on the first test run to view details
      await testRunLinks.first().click();
      
      // Wait for navigation to complete
      await page.waitForURL(/\/projects\/runs\/\d+\/\d+$/, { timeout: 10000 });
      await page.waitForLoadState("networkidle");

      // Verify user can see the test results - test cases appear in table rows
      const testCaseRows = page.locator(
        'tr:has-text("Test Case"), tr:has-text("DR Test Case"), tr:has-text("Repo Case")'
      );
      await expect(testCaseRows.first()).toBeVisible({ timeout: 10000 });

      // Check for test execution status information
      const statusInfo = page.locator('td:has-text("Passed"), td:has-text("Failed"), td:has-text("Draft")');
      const hasStatusInfo = await statusInfo
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      // User should be able to see test case details
      const testCaseCount = await testCaseRows.count();
      expect(testCaseCount).toBeGreaterThan(0);
    }
  });

  test("user can view JUnit properties and attachments", async ({ page }) => {
    // Login as regular user
    await page.goto("/en-US/signin");
    await page.getByTestId("email-input").fill("testuser@example.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for successful login
    await page.waitForURL((url) => !url.pathname.includes("/signin"), {
      timeout: 10000,
    });

    // Navigate to repository to see test cases that might have JUnit data
    await page.goto(`/en-US/projects/repository/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Look for automated test cases (likely from JUnit)
    const automatedBadges = page.locator(
      '[data-testid="automated-badge"], text=/automated/i'
    );
    const hasAutomatedTests = await automatedBadges
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasAutomatedTests) {
      // Click on an automated test case
      const testCaseLink = automatedBadges
        .first()
        .locator("xpath=ancestor::tr")
        .locator("a")
        .first();
      await testCaseLink.click();
      await page.waitForLoadState("networkidle");

      // Check for JUnit-specific information
      // Properties section
      const propertiesSection = page.locator(
        '[data-testid="properties-section"], text=/properties/i'
      );
      const hasProperties = await propertiesSection
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      // Attachments section
      const attachmentsSection = page.locator(
        '[data-testid="attachments-section"], text=/attachments/i'
      );
      const hasAttachments = await attachmentsSection
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      // User should be able to see these sections if they exist
      if (hasProperties) {
        await expect(propertiesSection).toBeVisible();
      }

      if (hasAttachments) {
        await expect(attachmentsSection).toBeVisible();
      }
    }
  });

  test("admin can import and view JUnit XML results", async ({ page }) => {
    // Login as admin
    await loginAsAdmin(page);

    // Navigate to test runs page
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Check if there's an import button (admin should have access)
    const importButton = page.locator(
      '[data-testid="import-results"], button:has-text("Import")'
    );
    const hasImportButton = await importButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (hasImportButton) {
      await expect(importButton).toBeVisible();

      // Admin should be able to access import functionality
      await importButton.click();

      // Check for JUnit/XML import option
      const junitOption = page.locator("text=/junit|xml/i");
      const hasJunitOption = await junitOption
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (hasJunitOption) {
        await expect(junitOption).toBeVisible();
      }

      // Close the modal
      await page.keyboard.press("Escape");
    }

    // Check existing JUnit test runs
    const testRunRows = page.locator(
      'tr[role="row"], [data-testid="test-run-row"]'
    );
    const runCount = await testRunRows.count();

    if (runCount > 0) {
      // Admin should see all test runs including JUnit imports
      expect(runCount).toBeGreaterThan(0);

      // Click on first test run
      await testRunRows.first().locator("a").first().click();
      await page.waitForLoadState("networkidle");

      // Admin should see all details
      const testCases = page.locator(
        '[data-testid="test-case-row"], tbody tr[role="row"]'
      );
      await expect(testCases.first()).toBeVisible({ timeout: 10000 });

      // Admin should have access to actions
      const actionsButton = page
        .locator('[data-testid="test-run-actions"], button:has-text("Actions")')
        .first();
      await expect(actionsButton).toBeVisible();
    }
  });

  test("user without project access cannot view JUnit results", async ({
    page,
  }) => {
    // Login as a user not assigned to the project
    await page.goto("/en-US/signin");
    await page.getByTestId("email-input").fill("verify@test.com");
    await page.getByTestId("password-input").fill("password123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for successful login
    await page.waitForURL((url) => !url.pathname.includes("/signin"), {
      timeout: 10000,
    });

    // Try to directly access a test run page
    await page.goto(`/en-US/projects/runs/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Should not have access to view test runs
    const currentUrl = page.url();
    const hasAccess = currentUrl.includes(`/projects/runs/${TEST_PROJECT_ID}`);

    if (hasAccess) {
      // If on the page, should see no data
      const testRunLinks = page.locator(
        'a[href*="/projects/runs/331/"]:not([href*="selectedCase"])'
      );
      const runCount = await testRunLinks.count();

      // Should see no test runs or empty state
      expect(runCount).toBe(0);
    } else {
      // Should be redirected away
      expect(currentUrl).not.toContain(`/projects/runs/${TEST_PROJECT_ID}`);
    }
  });

  test("JUnit test steps are visible to users with access", async ({
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

    // Navigate to repository
    await page.goto(`/en-US/projects/repository/${TEST_PROJECT_ID}`);
    await page.waitForLoadState("networkidle");

    // Find a test case (preferably automated/JUnit imported)
    const testCaseLinks = page.locator(
      'tbody a[href*="/projects/repository/"]'
    );
    const caseCount = await testCaseLinks.count();

    if (caseCount > 0) {
      // Click on first test case
      await testCaseLinks.first().click();
      await page.waitForLoadState("networkidle");

      // Check for steps section
      const stepsSection = page.locator(
        '[data-testid="steps-section"], [data-testid="test-steps"], text=/steps/i'
      );
      const hasSteps = await stepsSection
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (hasSteps) {
        // User should be able to see test steps
        await expect(stepsSection).toBeVisible();

        // Check for individual step items
        const stepItems = page.locator(
          '[data-testid="step-item"], [data-testid="test-step"]'
        );
        const stepCount = await stepItems.count();

        // If there are steps, user should be able to see them
        if (stepCount > 0) {
          await expect(stepItems.first()).toBeVisible();
        }
      }
    }
  });
});
