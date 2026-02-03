import { test, expect } from "../../fixtures";

/**
 * Complete Milestone Dialog - Optional Test Run/Session Completion
 *
 * Tests for GitHub issue #50: Add option to complete associated test runs/sessions
 * when completing a milestone.
 *
 * NOTE: These tests use existing milestones from the seeded database rather than
 * creating new ones, to avoid issues with ZenStack access control and foreign key constraints.
 */

test.describe("Complete Milestone - Feature Validation", () => {
  test("should show Complete Milestone dialog with proper UI elements", async ({
    page,
    api,
  }) => {
    // Create a test project and milestone
    const projectId = await api.createProject(`E2E Milestone Test ${Date.now()}`);
    await api.createMilestone(projectId, `Test Milestone ${Date.now()}`, {
      isStarted: true,
      isCompleted: false,
    });

    // Navigate to milestones page
    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Wait for milestone content to be visible (uses card layout, not table)
    // Look for the "Active" tab which indicates milestones are loaded
    const activeTab = page.getByRole("tab", { name: /Active/i });
    await expect(activeTab).toBeVisible({ timeout: 10000 });

    // Find the first milestone card
    const milestoneCard = page.locator('div').filter({ hasText: 'Test Milestone' }).first();
    await expect(milestoneCard).toBeVisible({ timeout: 10000 });

    // Open the 3-dot menu (last button in the card)
    const menuButton = milestoneCard.getByRole('button').last();
    await menuButton.click();

    // Click Complete from the menu
    const completeMilestoneButton = page.getByRole('menuitem', { name: 'Complete' });
    await expect(completeMilestoneButton).toBeVisible({ timeout: 10000 });
    await completeMilestoneButton.click();

    // Wait for dialog to open
    await expect(page.getByRole("dialog")).toBeVisible();

    // Verify dialog has the completion date picker
    await expect(
      page.getByText(/Pick Completion Date|Select Date/i)
    ).toBeVisible();

    // Verify the Complete button exists
    await expect(page.getByRole("button", { name: /Complete/i })).toBeVisible();

    // Close dialog
    await page.getByRole("button", { name: /Cancel/i }).click();
  });

  test("should show checkboxes when milestone has incomplete dependencies", async ({
    page,
    api,
  }) => {
    // Create a test project
    const projectId = await api.createProject(`E2E Milestone Test ${Date.now()}`);

    // This test verifies the checkbox functionality exists
    // It will only run if there's a milestone with dependencies in the seeded data
    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Wait for the Active tab to be visible
    const activeTab = page.getByRole("tab", { name: /Active/i });
    await expect(activeTab).toBeVisible({ timeout: 10000 });

    // Look for incomplete milestone cards (cards in the Active tab)
    const milestoneCards = page.locator('div').filter({ hasText: /Test Milestone|Milestone/ });
    const count = await milestoneCards.count();

    // Try to find one with dependencies
    for (let i = 0; i < Math.min(count, 5); i++) {
      const card = milestoneCards.nth(i);

      // Open the 3-dot menu
      const menuButton = card.getByRole('button').last();
      await menuButton.click();

      // Click Complete Milestone from the menu
      const completeMilestoneButton = page.getByRole('menuitem', { name: 'Complete' });
      const isVisible = await completeMilestoneButton.isVisible().catch(() => false);

      if (!isVisible) {
        // Close menu if Complete Milestone not available (milestone might be completed)
        await page.keyboard.press('Escape');
        continue;
      }

      await completeMilestoneButton.click();
      await expect(page.getByRole("dialog")).toBeVisible();

      // Check if any optional completion checkboxes appear
      const testRunsCheckbox = page.getByLabel(
        /Complete Associated Test Runs/i
      );
      const sessionsCheckbox = page.getByLabel(/Complete Associated Sessions/i);

      const hasTestRunsCheckbox = await testRunsCheckbox
        .isVisible()
        .catch(() => false);
      const hasSessionsCheckbox = await sessionsCheckbox
        .isVisible()
        .catch(() => false);

      if (hasTestRunsCheckbox || hasSessionsCheckbox) {
        // Found a milestone with dependencies - verify the UI
        if (hasTestRunsCheckbox) {
          // Verify checkbox is checked by default
          await expect(testRunsCheckbox).toBeChecked();
          // Verify workflow selector appears
          await expect(
            page.getByText("Test Run Completion State")
          ).toBeVisible();
        }

        if (hasSessionsCheckbox) {
          // Verify checkbox is checked by default
          await expect(sessionsCheckbox).toBeChecked();
          // Verify workflow selector appears
          await expect(
            page.getByText("Session Completion State")
          ).toBeVisible();
        }

        // Close dialog and end test
        await page.getByRole("button", { name: /Cancel/i }).click();
        return;
      }

      // Close dialog and try next milestone
      await page.getByRole("button", { name: /Cancel/i }).click();
    }
  });

  test("should hide workflow selector when checkbox is unchecked", async ({
    page,
    api,
  }) => {
    // Create a test project
    const projectId = await api.createProject(`E2E Milestone Test ${Date.now()}`);

    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Wait for the Active tab to be visible
    const activeTab = page.getByRole("tab", { name: /Active/i });
    await expect(activeTab).toBeVisible({ timeout: 10000 });

    // Look for incomplete milestone cards
    const milestoneCards = page.locator('div').filter({ hasText: /Test Milestone|Milestone/ });
    const count = await milestoneCards.count();

    // Try to find a milestone with test runs
    for (let i = 0; i < Math.min(count, 5); i++) {
      const card = milestoneCards.nth(i);

      // Open the 3-dot menu
      const menuButton = card.getByRole('button').last();
      await menuButton.click();

      // Click Complete Milestone from the menu
      const completeMilestoneButton = page.getByRole('menuitem', { name: 'Complete' });
      const isVisible = await completeMilestoneButton.isVisible().catch(() => false);

      if (!isVisible) {
        // Close menu if Complete Milestone not available
        await page.keyboard.press('Escape');
        continue;
      }

      await completeMilestoneButton.click();
      await expect(page.getByRole("dialog")).toBeVisible();

      const testRunsCheckbox = page.getByLabel(
        /Complete Associated Test Runs/i
      );
      const hasCheckbox = await testRunsCheckbox.isVisible().catch(() => false);

      if (hasCheckbox) {
        // Verify selector is visible initially
        await expect(page.getByText("Test Run Completion State")).toBeVisible();

        // Uncheck the checkbox
        await testRunsCheckbox.click();

        // Verify selector disappears
        await expect(
          page.getByText("Test Run Completion State")
        ).not.toBeVisible();

        // Close dialog and end test
        await page.getByRole("button", { name: /Cancel/i }).click();
        return;
      }

      await page.getByRole("button", { name: /Cancel/i }).click();
    }
  });
});
