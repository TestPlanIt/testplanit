import { expect, test } from "../../../fixtures";

/**
 * Configuration Project Scoping E2E Tests
 *
 * Configurations are scoped to projects via ProjectConfigurationAssignment.
 * The Admin > Configurations page surfaces this with:
 *   - a "Projects" column (count badge -> popover listing assigned projects)
 *   - a project filter combobox that narrows the list to one project
 *
 * Configurations created via api.createConfiguration(name, projectId) are
 * assigned to that project; created without a projectId they are global
 * (assigned to no project).
 */

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe("Configuration Project Scoping - Admin", () => {
  test("Projects column lists the projects a configuration is assigned to", async ({
    api,
    page,
  }) => {
    const suffix = uid();
    const projectName = `Scope Col Proj ${suffix}`;
    const configName = `Scope Col Cfg ${suffix}`;
    const projectId = await api.createProject(projectName);
    const configId = await api.createConfiguration(configName, projectId);

    await page.goto("/en-US/admin/configurations");
    await page.waitForLoadState("load");

    // Narrow the list to our configuration by name.
    const filterInput = page.getByPlaceholder("Filter configurations...");
    await expect(filterInput).toBeVisible({ timeout: 15000 });
    await filterInput.fill(configName);
    await page.waitForTimeout(500);

    const row = page.getByTestId(`case-row-${configId}`);
    await expect(row).toBeVisible({ timeout: 10000 });

    // The configuration has no variants, so the only popover-trigger badge in
    // the row is the Projects count. Open it and verify the project is listed.
    const projectsBadge = row.locator('button[aria-haspopup="dialog"]');
    await expect(projectsBadge).toBeVisible({ timeout: 5000 });
    await projectsBadge.click();

    await expect(page.getByText(projectName, { exact: true })).toBeVisible({
      timeout: 5000,
    });
  });

  test("project filter shows assigned configurations and hides unassigned ones", async ({
    api,
    page,
  }) => {
    const suffix = uid();
    const projectName = `Scope Filter Proj ${suffix}`;
    const projectId = await api.createProject(projectName);

    const assignedName = `Scope Filter Assigned ${suffix}`;
    const unassignedName = `Scope Filter Unassigned ${suffix}`;
    const assignedId = await api.createConfiguration(assignedName, projectId);
    // No projectId -> global, not assigned to the new project.
    const unassignedId = await api.createConfiguration(unassignedName);

    await page.goto("/en-US/admin/configurations");
    await page.waitForLoadState("load");

    // Open the project filter combobox (trigger shows "All projects"). The
    // AsyncCombobox trigger has role="combobox", not "button".
    const filterTrigger = page
      .locator('button[role="combobox"]')
      .filter({ hasText: "All projects" });
    await expect(filterTrigger).toBeVisible({ timeout: 15000 });
    await filterTrigger.click();

    // Search for and select the project.
    const comboInput = page.locator("[cmdk-input]");
    await expect(comboInput).toBeVisible({ timeout: 5000 });
    await comboInput.fill(projectName);
    await page.waitForTimeout(500);
    await page
      .locator(`[role="option"]:has-text("${projectName}")`)
      .first()
      .click();
    await page.waitForTimeout(500);

    // The assigned configuration is visible; the unassigned one is filtered out.
    await expect(page.getByTestId(`case-row-${assignedId}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId(`case-row-${unassignedId}`)).toHaveCount(0);
  });
});
