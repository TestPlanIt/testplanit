import { expect, test } from "../../fixtures";

/**
 * Project Menu - Settings Section Navigation Tests
 *
 * Tests that the project sidebar menu correctly displays the
 * Settings accordion section with Issue Integrations, AI Models,
 * and Manage Shares links, and that navigation works correctly.
 */

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

    // Verify the Settings accordion section exists
    const settingsSection = page.getByTestId("project-menu-section-settings");
    await expect(settingsSection).toBeVisible({ timeout: 10000 });

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

    // Open the settings section if collapsed
    const settingsSection = page.getByTestId("project-menu-section-settings");
    await expect(settingsSection).toBeVisible({ timeout: 10000 });

    const integrationsLink = page.locator("#settings-integrations-link");
    await integrationsLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${testProjectId}/integrations`)
    );
  });

  test("Navigate to AI Models from project menu", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    const settingsSection = page.getByTestId("project-menu-section-settings");
    await expect(settingsSection).toBeVisible({ timeout: 10000 });

    const aiModelsLink = page.locator("#settings-ai-models-link");
    await aiModelsLink.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/settings/${testProjectId}/ai-models`)
    );
  });

  test("Navigate to Manage Shares from project menu", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    const settingsSection = page.getByTestId("project-menu-section-settings");
    await expect(settingsSection).toBeVisible({ timeout: 10000 });

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
