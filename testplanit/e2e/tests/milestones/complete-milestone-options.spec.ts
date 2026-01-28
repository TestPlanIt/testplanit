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
    projectId,
  }) => {
    // Navigate to milestones page
    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Wait for the table to be visible
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Look for any incomplete milestone in the table and wait for it to appear
    const incompleteMilestones = page.locator(
      'tr:has(button[title="Complete Milestone"])'
    );
    await expect(incompleteMilestones.first()).toBeVisible({ timeout: 10000 });

    const count = await incompleteMilestones.count();
    if (count === 0) {
      throw new Error("No incomplete milestones found in the seeded data");
    }

    // Wait for the Complete Milestone button to be visible and clickable
    const completeMilestoneButton = incompleteMilestones
      .first()
      .locator('button[title="Complete Milestone"]');
    await expect(completeMilestoneButton).toBeVisible({ timeout: 10000 });

    // Click the first Complete Milestone button
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
    projectId,
  }) => {
    // This test verifies the checkbox functionality exists
    // It will only run if there's a milestone with dependencies in the seeded data
    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Look for incomplete milestones
    const incompleteMilestones = page.locator(
      'tr:has(button[title="Complete Milestone"])'
    );
    const count = await incompleteMilestones.count();

    // Try to find one with dependencies
    for (let i = 0; i < Math.min(count, 5); i++) {
      await incompleteMilestones
        .nth(i)
        .locator('button[title="Complete Milestone"]')
        .click();
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
    projectId,
  }) => {
    await page.goto(`/en-US/projects/milestones/${projectId}`);
    await page.waitForLoadState("networkidle");

    const incompleteMilestones = page.locator(
      'tr:has(button[title="Complete Milestone"])'
    );
    const count = await incompleteMilestones.count();

    // Try to find a milestone with test runs
    for (let i = 0; i < Math.min(count, 5); i++) {
      await incompleteMilestones
        .nth(i)
        .locator('button[title="Complete Milestone"]')
        .click();
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
