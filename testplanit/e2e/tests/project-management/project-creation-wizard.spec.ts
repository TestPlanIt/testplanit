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
    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    // The add project button triggers the wizard
    const addButton = page.getByRole("button", { name: /add/i });
    await expect(addButton.first()).toBeVisible({ timeout: 15000 });
    await addButton.first().click();

    // Dialog should appear with the wizard title
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Verify step 1 (Project Details) is shown — the name input is present
    const nameInput = dialog.getByRole("textbox").first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
  });

  test("validates that project name is required to proceed", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    const addButton = page.getByRole("button", { name: /add/i });
    await expect(addButton.first()).toBeVisible({ timeout: 15000 });
    await addButton.first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // The Next button should be disabled when name is empty
    // canProceed() returns false when name.length === 0 on step 0
    const nextButton = dialog.getByRole("button", { name: /next/i });
    await expect(nextButton).toBeVisible({ timeout: 10000 });
    await expect(nextButton).toBeDisabled();
  });

  test("navigates through all 5 wizard steps and creates a project", async ({
    page,
  }) => {
    const ts = Date.now();
    const projectName = `E2E Wizard Full ${ts}`;

    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    // Open wizard
    const addButton = page.getByRole("button", { name: /add/i });
    await expect(addButton.first()).toBeVisible({ timeout: 15000 });
    await addButton.first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Step 1: Project Details — enter project name
    const nameInput = dialog.getByRole("textbox").first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(projectName);
    await expect(nameInput).toHaveValue(projectName);

    // The Next button becomes enabled once name has content
    const nextButton = dialog.getByRole("button", { name: /next/i });
    await expect(nextButton).toBeEnabled({ timeout: 5000 });
    await nextButton.click();

    // Step 2: Templates — wait for template list to load
    // The wizard shows a scroll area with template cards
    // At least one template should be pre-selected (the default)
    // We can proceed with defaults
    const nextButton2 = dialog.getByRole("button", { name: /next/i });
    await expect(nextButton2).toBeVisible({ timeout: 15000 });
    await expect(nextButton2).toBeEnabled({ timeout: 10000 });
    await nextButton2.click();

    // Step 3: Workflows & Statuses
    const nextButton3 = dialog.getByRole("button", { name: /next/i });
    await expect(nextButton3).toBeVisible({ timeout: 15000 });
    await expect(nextButton3).toBeEnabled({ timeout: 10000 });
    await nextButton3.click();

    // Step 4: Integrations (optional — skip to next)
    const nextButton4 = dialog.getByRole("button", { name: /next/i });
    await expect(nextButton4).toBeVisible({ timeout: 10000 });
    await nextButton4.click();

    // Step 5: Permissions — the final step shows "Create" button
    const createButton = dialog.getByRole("button", { name: /create/i });
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    // Dialog should close after successful creation
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // Verify the new project appears in the admin list
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 15000 });
  });

  test("can navigate back through wizard steps using Previous button", async ({
    page,
  }) => {
    const ts = Date.now();
    const projectName = `E2E Wizard Back ${ts}`;

    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    const addButton = page.getByRole("button", { name: /add/i });
    await expect(addButton.first()).toBeVisible({ timeout: 15000 });
    await addButton.first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill name and go to step 2
    const nameInput = dialog.getByRole("textbox").first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(projectName);

    const nextButton = dialog.getByRole("button", { name: /next/i });
    await expect(nextButton).toBeEnabled({ timeout: 5000 });
    await nextButton.click();

    // Now on step 2 — the Previous button should appear
    const previousButton = dialog.getByRole("button", { name: /previous/i });
    await expect(previousButton).toBeVisible({ timeout: 10000 });

    // Click Previous to go back to step 1
    await previousButton.click();

    // Should be back on step 1 — the name input should still be visible
    const nameInputAgain = dialog.getByRole("textbox").first();
    await expect(nameInputAgain).toBeVisible({ timeout: 5000 });
    await expect(nameInputAgain).toHaveValue(projectName);
  });

  test("can cancel the wizard dialog", async ({ page }) => {
    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    const addButton = page.getByRole("button", { name: /add/i });
    await expect(addButton.first()).toBeVisible({ timeout: 15000 });
    await addButton.first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Click Cancel button
    const cancelButton = dialog.getByRole("button", { name: /cancel/i });
    await expect(cancelButton).toBeVisible({ timeout: 5000 });
    await cancelButton.click();

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  test("shows 5 step indicator icons in the wizard header", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    const addButton = page.getByRole("button", { name: /add/i });
    await expect(addButton.first()).toBeVisible({ timeout: 15000 });
    await addButton.first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // The step indicator renders 5 round buttons (one per step)
    // They're type="button" elements in a flex row
    const stepButtons = dialog.locator('button[type="button"]').filter({
      hasNot: dialog.getByRole("button", { name: /next|previous|cancel/i }),
    });

    // Verify there are at least 5 step indicator items visible
    // (steps 0-4: Details, Templates, Workflows, Integrations, Permissions)
    const stepIndicatorCount = await dialog
      .locator('div.w-10.h-10.rounded-full')
      .count();
    expect(stepIndicatorCount).toBeGreaterThanOrEqual(5);
  });
});
