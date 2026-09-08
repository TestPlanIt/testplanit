import { expect, test } from "../../fixtures";

/**
 * Project Creation Wizard E2E Tests (PROJ-01)
 *
 * Tests the 5-step CreateProjectWizard dialog accessed from /admin/projects.
 * Steps:
 *   0 - Project Details (name, description, icon, access)
 *   1 - Templates (select at least one)
 *   2 - Workflows & Statuses (select at least one of each)
 *   3 - Integrations (optional, includes QuickScript toggle)
 *   4 - Permissions (user/group assignments)
 *
 * Notes:
 * - The "Next" button text is rendered via translation key "common.actions.next"
 * - The "Create" button appears on the final (Permissions) step
 * - Name validation calls /api/admin/validate-project-name before proceeding
 */

test.describe("Project Creation Wizard", () => {
  test("opens the wizard dialog from admin projects page", async ({ page }) => {
    const dialog = page.getByRole("dialog");

    await test.step("Open the project creation wizard from admin projects page", async () => {
      await page.goto("/en-US/admin/projects");
      await page.waitForLoadState("networkidle");

      // The add project button triggers the wizard
      const addButton = page.getByRole("button", { name: /add/i });
      await expect(addButton.first()).toBeVisible({ timeout: 15000 });
      await addButton.first().click();

      // Dialog should appear with the wizard title
      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the Project Details step shows the name input", async () => {
      // Verify step 1 (Project Details) is shown — the name input is present
      const nameInput = dialog.getByRole("textbox").first();
      await expect(nameInput).toBeVisible({ timeout: 10000 });
    });
  });

  test("validates that project name is required to proceed", async ({
    page,
  }) => {
    const dialog = page.getByRole("dialog");

    await test.step("Open the project creation wizard", async () => {
      await page.goto("/en-US/admin/projects");
      await page.waitForLoadState("networkidle");

      const addButton = page.getByRole("button", { name: /add/i });
      await expect(addButton.first()).toBeVisible({ timeout: 15000 });
      await addButton.first().click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify Next is disabled while the project name is empty", async () => {
      // The Next button should be disabled when name is empty
      // canProceed() returns false when name.length === 0 on step 0
      const nextButton = dialog.getByRole("button", { name: /next/i });
      await expect(nextButton).toBeVisible({ timeout: 10000 });
      await expect(nextButton).toBeDisabled();
    });
  });

  test("navigates through all 5 wizard steps and creates a project", async ({
    page,
  }) => {
    const ts = Date.now();
    const projectName = `E2E Wizard Full ${ts}`;

    const dialog = page.getByRole("dialog");
    const nextButton = dialog.getByRole("button", { name: /next/i });

    await test.step("Open the project creation wizard", async () => {
      await page.goto("/en-US/admin/projects");
      await page.waitForLoadState("networkidle");

      // Open wizard
      const addButton = page.getByRole("button", { name: /add/i });
      await expect(addButton.first()).toBeVisible({ timeout: 15000 });
      await addButton.first().click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Step 1: Enter the project name and advance", async () => {
      // Step 1: Project Details — enter project name
      // The wizard loads data (templates, workflows, etc.) asynchronously.
      // When data finishes loading, the form resets via useEffect, which can clear
      // a previously filled input. The Next button is disabled while data loads
      // OR while the name is empty. We need to keep re-filling the name until
      // the Next button stays enabled, which proves all async data has loaded
      // AND the name field survived without being reset.
      const nameInput = dialog.getByRole("textbox").first();
      await expect(nameInput).toBeVisible({ timeout: 10000 });

      await expect(nextButton).toBeVisible({ timeout: 10000 });

      // Retry filling the name until the value SURVIVES with Next enabled.
      // Multiple async data loads can each trigger a form reset — including
      // AFTER Next first turns enabled — so a fill-then-break loop can still
      // hand an emptied input to the assertions below. Poll the whole
      // sequence (re-fill if cleared, then both conditions) as one unit.
      await expect(async () => {
        if ((await nameInput.inputValue()) !== projectName) {
          await nameInput.fill(projectName);
        }
        await expect(nameInput).toHaveValue(projectName);
        await expect(nextButton).toBeEnabled();
      }).toPass({ timeout: 30000 });

      await nextButton.click();
    });

    await test.step("Step 2: Confirm Templates step and advance", async () => {
      // Step 2: Templates — wait for step content to load (template list)
      // The step title changes to "Templates" after advancing
      await expect(dialog.getByText(/templates/i).first()).toBeVisible({
        timeout: 15000,
      });
      await expect(nextButton).toBeEnabled({ timeout: 10000 });
      await nextButton.click();
    });

    await test.step("Step 3: Confirm Workflows & Statuses step and advance", async () => {
      // Step 3: Workflows & Statuses — wait for step content
      await expect(dialog.getByText(/workflows/i).first()).toBeVisible({
        timeout: 15000,
      });
      await expect(nextButton).toBeEnabled({ timeout: 10000 });
      await nextButton.click();
    });

    await test.step("Step 4: Skip the optional Integrations step", async () => {
      // Step 4: Integrations (optional — skip to next)
      await expect(dialog.getByText(/integrations/i).first()).toBeVisible({
        timeout: 15000,
      });
      await expect(nextButton).toBeVisible({ timeout: 10000 });
      await nextButton.click();
    });

    await test.step("Step 5: Create the project from the Permissions step", async () => {
      // Step 5: Permissions — the final step shows "Create Project" button instead of Next
      // Wait for the permissions step content to appear
      await expect(dialog.getByText(/permissions/i).first()).toBeVisible({
        timeout: 15000,
      });
      const createButton = dialog.getByRole("button", {
        name: /create project/i,
      });
      await expect(createButton).toBeVisible({ timeout: 10000 });
      await expect(createButton).toBeEnabled({ timeout: 5000 });
      await createButton.click();

      // Dialog should close after successful creation
      await expect(dialog).not.toBeVisible({ timeout: 30000 });
    });

    await test.step("Verify the new project appears in the filtered list", async () => {
      // Wait for the page to settle after project creation
      await page.waitForLoadState("networkidle");

      // The admin project list is paginated and sorted alphabetically.
      // Use the filter input to search for the newly created project.
      await page.waitForLoadState("networkidle");
      const filterInput = page.getByPlaceholder(/filter projects/i);
      await expect(filterInput).toBeVisible({ timeout: 10000 });
      await filterInput.fill(projectName);

      // Verify the new project appears in the filtered list
      await expect(page.getByText(projectName).first()).toBeVisible({
        timeout: 20000,
      });
    });
  });

  test("can navigate back through wizard steps using Previous button", async ({
    page,
  }) => {
    const ts = Date.now();
    const projectName = `E2E Wizard Back ${ts}`;

    const dialog = page.getByRole("dialog");

    await test.step("Open the project creation wizard", async () => {
      await page.goto("/en-US/admin/projects");
      await page.waitForLoadState("networkidle");

      const addButton = page.getByRole("button", { name: /add/i });
      await expect(addButton.first()).toBeVisible({ timeout: 15000 });
      await addButton.first().click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Fill the project name and advance to step 2", async () => {
      // Fill name and go to step 2
      // The wizard loads data asynchronously and resets the form when data arrives.
      // Retry filling the name until the Next button stays enabled.
      const nameInput = dialog.getByRole("textbox").first();
      await expect(nameInput).toBeVisible({ timeout: 10000 });

      const nextButton = dialog.getByRole("button", { name: /next/i });
      await expect(nextButton).toBeVisible({ timeout: 10000 });

      for (let attempt = 0; attempt < 10; attempt++) {
        await nameInput.fill(projectName);
        try {
          await expect(nextButton).toBeEnabled({ timeout: 3000 });
          break;
        } catch {
          // Data load reset the form — retry
        }
      }
      await expect(nextButton).toBeEnabled({ timeout: 5000 });
      await nextButton.click();
    });

    await test.step("Click Previous to return to step 1", async () => {
      // Now on step 2 — the Previous button should appear
      const previousButton = dialog.getByRole("button", { name: /previous/i });
      await expect(previousButton).toBeVisible({ timeout: 10000 });

      // Click Previous to go back to step 1
      await previousButton.click();
    });

    await test.step("Verify step 1 retained the entered project name", async () => {
      // Should be back on step 1 — the name input should still be visible
      const nameInputAgain = dialog.getByRole("textbox").first();
      await expect(nameInputAgain).toBeVisible({ timeout: 5000 });
      await expect(nameInputAgain).toHaveValue(projectName);
    });
  });

  test("can cancel the wizard dialog", async ({ page }) => {
    const dialog = page.getByRole("dialog");

    await test.step("Open the project creation wizard", async () => {
      await page.goto("/en-US/admin/projects");
      await page.waitForLoadState("networkidle");

      const addButton = page.getByRole("button", { name: /add/i });
      await expect(addButton.first()).toBeVisible({ timeout: 15000 });
      await addButton.first().click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Click Cancel and confirm the dialog closes", async () => {
      // Click Cancel button
      const cancelButton = dialog.getByRole("button", { name: /cancel/i });
      await expect(cancelButton).toBeVisible({ timeout: 5000 });
      await cancelButton.click();

      // Dialog should close
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    });
  });

  test("shows 5 step indicator icons in the wizard header", async ({
    page,
  }) => {
    const dialog = page.getByRole("dialog");

    await test.step("Open the project creation wizard", async () => {
      await page.goto("/en-US/admin/projects");
      await page.waitForLoadState("networkidle");

      const addButton = page.getByRole("button", { name: /add/i });
      await expect(addButton.first()).toBeVisible({ timeout: 15000 });
      await addButton.first().click();

      await expect(dialog).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the header shows at least 5 step indicator icons", async () => {
      // The step indicator renders 5 round buttons (one per step)
      // They're type="button" elements in a flex row
      const _stepButtons = dialog.locator('button[type="button"]').filter({
        hasNot: dialog.getByRole("button", { name: /next|previous|cancel/i }),
      });

      // Verify there are at least 5 step indicator buttons visible
      // (steps 0-4: Details, Templates, Workflows, Integrations, Permissions)
      // The step indicators are <button> elements with type="button" inside the progress indicator row
      // With Tailwind CSS v4, class selectors may not work reliably, so we target
      // the button elements inside the step indicator flex container
      const stepIndicators = dialog.locator(
        '.flex.items-center.gap-2 button[type="button"]'
      );
      await expect(stepIndicators.first()).toBeVisible({ timeout: 10000 });
      const stepIndicatorCount = await stepIndicators.count();
      expect(stepIndicatorCount).toBeGreaterThanOrEqual(5);
    });
  });
});
