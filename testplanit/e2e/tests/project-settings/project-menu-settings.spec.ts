import { expect, test } from "../../fixtures";

/**
 * Project Menu - Settings Section Navigation Tests
 *
 * Tests that the project sidebar menu correctly displays the
 * Settings accordion section with Issue Integrations, AI Models,
 * and Manage Shares links, and that navigation works correctly.
 */

/**
 * Helper to expand the Settings accordion section in the project menu.
 * The Settings section is collapsed by default (accordion state from localStorage).
 */
async function expandSettingsSection(page: import("@playwright/test").Page) {
  const settingsSection = page.getByTestId("project-menu-section-settings");
  await expect(settingsSection).toBeVisible({ timeout: 10000 });

  // Check if the settings section is already expanded by looking for a link inside
  const integrationsLink = page.locator("#settings-integrations-link");
  if (!(await integrationsLink.isVisible({ timeout: 1000 }).catch(() => false))) {
    // Click the accordion trigger to expand
    const trigger = settingsSection.getByRole("button", { name: "Settings" });
    await trigger.click();
    // Wait for the links to appear
    await expect(integrationsLink).toBeVisible({ timeout: 5000 });
  }
}

test.describe("Project Menu - Settings Section", () => {
  let testProjectId: number;

  test.beforeEach(async ({ api }) => {
    testProjectId = await api.createProject(
      `E2E Settings Nav ${Date.now()}`
    );
  });

  test("Settings section is visible in project menu for admin user", async ({
    page,
  }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Expand the Settings section (collapsed by default)
    await expandSettingsSection(page);

    // Verify all three settings menu items are visible
    const integrationsLink = page.locator("#settings-integrations-link");
    const aiModelsLink = page.locator("#settings-ai-models-link");
    const sharesLink = page.locator("#settings-shares-link");

    await expect(integrationsLink).toBeVisible();
    await expect(aiModelsLink).toBeVisible();
    await expect(sharesLink).toBeVisible();
  });

  test("Navigate to Issue Integrations from project menu", async ({
    page,
  }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Expand the Settings section
    await expandSettingsSection(page);

    const integrationsLink = page.locator("#settings-integrations-link");
    await integrationsLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${testProjectId}/integrations`)
    );
  });

  test("Navigate to AI Models from project menu", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Expand the Settings section
    await expandSettingsSection(page);

    const aiModelsLink = page.locator("#settings-ai-models-link");
    await aiModelsLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${testProjectId}/ai-models`)
    );
  });

  test("Navigate to Manage Shares from project menu", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Expand the Settings section
    await expandSettingsSection(page);

    const sharesLink = page.locator("#settings-shares-link");
    await sharesLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${testProjectId}/shares`)
    );
  });

  test("Project and Management sections are also visible", async ({
    page,
  }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Verify all three accordion sections exist
    const projectSection = page.getByTestId("project-menu-section-project");
    const managementSection = page.getByTestId(
      "project-menu-section-management"
    );
    const settingsSection = page.getByTestId("project-menu-section-settings");

    await expect(projectSection).toBeVisible({ timeout: 10000 });
    await expect(managementSection).toBeVisible();
    await expect(settingsSection).toBeVisible();
  });

  test("Settings sub-page highlights correct menu item", async ({ page }) => {
    // Navigate directly to integrations settings page
    // This should auto-expand the Settings section since the active page is in it
    await page.goto(
      `/en-US/projects/settings/${testProjectId}/integrations`
    );
    await page.waitForLoadState("networkidle");

    // The integrations link should have the active styling
    const integrationsLink = page.locator("#settings-integrations-link");
    await expect(integrationsLink).toBeVisible({ timeout: 10000 });

    // Check it has the active class (bg-primary)
    await expect(integrationsLink).toHaveClass(/bg-primary/);

    // The other settings links should NOT have the active class
    const aiModelsLink = page.locator("#settings-ai-models-link");
    await expect(aiModelsLink).not.toHaveClass(/bg-primary/);
  });
});
