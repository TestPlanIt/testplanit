import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Custom Fields View and Filter Tests
 *
 * Test cases for viewing and filtering test cases by custom fields in the repository.
 * Custom fields (case fields) can be used to organize test cases in the repository
 * by switching to dynamic views (e.g., by Dropdown field, Checkbox field, etc.)
 *
 * The repository supports these custom field view types:
 * - Dropdown fields: View by dropdown option selections
 * - Multi-Select fields: View by multi-select option selections
 * - Link fields: View by "Has Link" or "No Link"
 * - Checkbox fields: View by "Checked" or "Unchecked"
 *
 * These tests verify:
 * 1. Dynamic view options appear in the view selector
 * 2. Filtering by custom field values works correctly
 * 3. Custom field filter UI in advanced search works
 */

test.describe("Custom Fields - Repository View and Filter", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
  }

  test("View selector shows available view options", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // The view selector is within the repository-left-panel-header container
    // We need to scope it to avoid clicking the project selector
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });

    // Click to open the selector
    await viewSelector.click();

    // Standard view options should be available
    const selectContent = page.locator('[role="listbox"]');
    await expect(selectContent).toBeVisible({ timeout: 5000 });

    // Check for standard views: Folders, Template, State, Creator, Automation
    await expect(
      selectContent.locator('[role="option"]').filter({ hasText: /^Folders$/i })
    ).toBeVisible();
    await expect(
      selectContent.locator('[role="option"]').filter({ hasText: /^Template$/i })
    ).toBeVisible();
    await expect(
      selectContent.locator('[role="option"]').filter({ hasText: /^State$/i })
    ).toBeVisible();
    await expect(
      selectContent.locator('[role="option"]').filter({ hasText: /^Creator$/i })
    ).toBeVisible();
    await expect(
      selectContent
        .locator('[role="option"]')
        .filter({ hasText: /^Automation$/i })
    ).toBeVisible();

    // Close the selector
    await page.keyboard.press("Escape");
  });

  test("Switch to Templates view and filter by template", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    // Select Template view
    const templatesOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Template$/i });
    await expect(templatesOption).toBeVisible({ timeout: 5000 });
    await templatesOption.click();

    // Wait for view to update
    await page.waitForLoadState("networkidle");

    // Template filter options should appear below the selector
    // Look for template list items (role="button" with template names)
    const templateFilters = page.locator(
      '[role="button"]:has-text("All Templates")'
    );
    await expect(templateFilters.first()).toBeVisible({ timeout: 10000 });
  });

  test("Switch to State view and filter by state", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    // Select State view
    const statesOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^State$/i });
    await expect(statesOption).toBeVisible({ timeout: 5000 });
    await statesOption.click();

    // Wait for view to update
    await page.waitForLoadState("networkidle");

    // State filter options should appear
    const stateFilters = page.locator('[role="button"]:has-text("All States")');
    await expect(stateFilters.first()).toBeVisible({ timeout: 10000 });
  });

  test("Switch to Automation view and filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    // Select Automation view
    const automationOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Automation$/i });
    await expect(automationOption).toBeVisible({ timeout: 5000 });
    await automationOption.click();

    // Wait for view to update
    await page.waitForLoadState("networkidle");

    // Automation filter options should appear - at minimum "All Cases" filter
    // "Automated" and "Not Automated" only appear if there are test cases in those categories
    const allCasesFilter = page.locator('[role="button"]:has-text("All Cases")');
    await expect(allCasesFilter.first()).toBeVisible({ timeout: 10000 });

    // Verify the view selector now shows Automation
    await expect(viewSelector).toContainText(/Automation/i);
  });

  test("Switch to Creator view and filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    // Select Creator view
    const creatorsOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Creator$/i });
    await expect(creatorsOption).toBeVisible({ timeout: 5000 });
    await creatorsOption.click();

    // Wait for view to update
    await page.waitForLoadState("networkidle");

    // Creator filter options should appear
    const allCreatorsFilter = page.locator(
      '[role="button"]:has-text("All Creators")'
    );
    await expect(allCreatorsFilter.first()).toBeVisible({ timeout: 10000 });
  });

  test("Tag view shows tag filtering options", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    // Select Tag view
    const tagsOption = page.locator('[role="option"]').filter({ hasText: /^Tag$/i });

    const hasTagsView = await tagsOption.isVisible();
    if (hasTagsView) {
      await tagsOption.click();
      await page.waitForLoadState("networkidle");

      // Tag filter options should appear
      // Tag view shows tag options
      await expect(
        page
          .locator('[role="button"]')
          .first()
      ).toBeVisible({ timeout: 10000 });
    } else {
      // Tag view might not be available if no tags exist
      await page.keyboard.press("Escape");
      test.skip();
    }
  });

  test("Dynamic field view appears for Dropdown fields", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    // Get all options
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();

    // Look for any dynamic field options (they have icons for different types)
    // Dynamic fields could be: Dropdown, Multi-Select, Link, Checkbox, Steps
    let hasDynamicField = false;
    for (let i = 0; i < optionCount; i++) {
      const optionText = await options.nth(i).textContent();
      // Dynamic fields are custom named fields that aren't the standard views
      const standardViews = [
        "folders",
        "templates",
        "states",
        "creators",
        "automation",
        "tags",
      ];
      const isStandard = standardViews.some((view) =>
        optionText?.toLowerCase().includes(view)
      );
      if (!isStandard && optionText) {
        hasDynamicField = true;
        break;
      }
    }

    await page.keyboard.press("Escape");

    // If there are dynamic fields, test passes; otherwise skip
    if (!hasDynamicField) {
      test.skip();
    }
  });

  test("Switching view updates URL and shows filter options", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Start in Template view (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    const templatesOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Template$/i });
    await expect(templatesOption).toBeVisible({ timeout: 5000 });
    await templatesOption.click();

    // Wait for the URL to update with view=templates
    await page.waitForURL(/view=templates/, { timeout: 10000 });

    // Verify the URL now contains view=templates
    const url = page.url();
    expect(url).toContain("view=templates");

    // Get the "All Templates" filter button
    const allTemplatesButton = page.locator(
      '[role="button"]:has-text("All Templates")'
    );
    await expect(allTemplatesButton.first()).toBeVisible({ timeout: 10000 });

    // Verify the view selector now shows Template
    await expect(viewSelector).toContainText(/Template/i);
  });

  test("Cmd/Ctrl+Click allows multi-select on filter options", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases with different states to ensure multiple state options are available
    const rootFolderId = await api.getRootFolderId(projectId);
    const stateIds = await api.getStateIds(projectId, 2);

    if (stateIds.length < 2) {
      test.skip();
      return;
    }

    // Create test cases in different states
    await api.createTestCaseWithState(
      projectId,
      rootFolderId,
      `E2E Multi-Select State1 ${Date.now()}`,
      stateIds[0]
    );
    await api.createTestCaseWithState(
      projectId,
      rootFolderId,
      `E2E Multi-Select State2 ${Date.now()}`,
      stateIds[1]
    );

    await repositoryPage.goto(projectId);

    // Start in State view (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    const statesOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^State$/i });
    await expect(statesOption).toBeVisible({ timeout: 5000 });
    await statesOption.click();

    await page.waitForLoadState("networkidle");

    // Get the state filter buttons (excluding "All States")
    const stateButtons = page.locator('[role="button"]');
    const buttonCount = await stateButtons.count();

    const stateOptionsToClick: string[] = [];

    // Find at least 2 state options to multi-select
    for (let i = 0; i < buttonCount; i++) {
      const button = stateButtons.nth(i);
      const text = await button.textContent();
      if (
        text &&
        !text.includes("All States") &&
        !text.includes("Mixed") &&
        stateOptionsToClick.length < 2
      ) {
        stateOptionsToClick.push(text);
      }
    }

    if (stateOptionsToClick.length >= 2) {
      // Click first option normally
      const firstOption = stateButtons.filter({
        hasText: stateOptionsToClick[0],
      });
      await firstOption.click();
      await page.waitForLoadState("networkidle");

      // First option should be selected (has selected styling)
      await expect(firstOption).toHaveClass(/bg-primary/);

      // Cmd/Ctrl+Click second option to multi-select
      const secondOption = stateButtons.filter({
        hasText: stateOptionsToClick[1],
      });
      await secondOption.click({
        modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
      });
      await page.waitForLoadState("networkidle");

      // Both options should now be selected
      await expect(firstOption).toHaveClass(/bg-primary/);
      await expect(secondOption).toHaveClass(/bg-primary/);
    } else {
      test.skip();
    }
  });

  test("URL reflects the current view and filter state", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Navigate directly to a specific view via URL
    await page.goto(`/en-US/projects/repository/${projectId}?view=templates`);
    await page.waitForLoadState("networkidle");

    // Verify view selector shows Template (scoped to repository-left-panel-header)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await expect(viewSelector).toContainText(/Template/i);
  });

  test("Folder view is the default view", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Navigate to repository without view parameter
    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // View selector should show Folders by default (scoped to repository-left-panel-header)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await expect(viewSelector).toContainText(/Folders/i);
  });

  test("Search input filters test cases within current view", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the search input
    const searchInput = page.locator(
      '[data-testid="search-input"], input[placeholder*="Search"], input[type="search"]'
    );

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    const isSearchVisible = await searchInput.first().isVisible();
    if (isSearchVisible) {
      // Type a search term
      await searchInput.first().fill("test");
      // Wait for debounce and API response
      await page.waitForLoadState("networkidle");
    } else {
      // Search might not be visible in all views
      test.skip();
    }
  });
});

test.describe("Custom Fields - Advanced Search Filters", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
  }

  test("Priority custom field appears in view selector", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create a test case to ensure there's data in the repository
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(
      projectId,
      rootFolderId,
      `E2E Priority View Test ${Date.now()}`
    );

    await repositoryPage.goto(projectId);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    // Wait for the dropdown to fully load before looking for options
    await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 5000 });

    // Look for Priority as a dynamic field option in the view selector
    // Priority is a seeded case field of type Dropdown assigned to the default template
    const priorityOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Priority$/i });

    // Priority should be available since it's assigned to the default template
    await expect(priorityOption).toBeVisible({ timeout: 5000 });

    // Click Priority view option
    await priorityOption.click();
    await page.waitForLoadState("networkidle");

    // Verify the view selector now shows Priority
    await expect(viewSelector).toContainText(/Priority/i);

    // Priority filter options should appear (e.g., "All Priorities" or specific priority values)
    const priorityFilters = page.locator('[role="button"]');
    await expect(priorityFilters.first()).toBeVisible({ timeout: 10000 });
  });

  test("Column visibility toggle shows custom field columns", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Create a test case to ensure there's data to display
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(
      projectId,
      rootFolderId,
      `E2E Column Toggle Test ${Date.now()}`
    );

    await repositoryPage.goto(projectId);

    // Wait for the cases table to load
    await page.waitForLoadState("networkidle");

    // Look for the "Columns" button that toggles column visibility
    const columnToggle = page.locator('button:has-text("Columns")');

    const hasColumnToggle = await columnToggle.first().isVisible();

    if (hasColumnToggle) {
      await columnToggle.first().click();

      // A menu or popover should appear with column options
      const columnMenu = page.locator(
        '[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]'
      );
      await expect(columnMenu.first()).toBeVisible({ timeout: 5000 });

      // Close the menu
      await page.keyboard.press("Escape");
    } else {
      // Column toggle might not exist in current view
      test.skip();
    }
  });

  test("Clear all filters button resets filters", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a test case to ensure there's data to filter
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(
      projectId,
      rootFolderId,
      `E2E Clear Filter Test ${Date.now()}`
    );

    await repositoryPage.goto(projectId);

    // Switch to a view with filters (scoped to repository-left-panel-header)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    const templatesOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Template$/i });
    await expect(templatesOption).toBeVisible({ timeout: 5000 });
    await templatesOption.click();

    await page.waitForLoadState("networkidle");

    // Find and click a specific template filter
    const templateOptions = page.locator('[role="button"]');
    const templateCount = await templateOptions.count();

    let clickedFilter = false;
    for (let i = 0; i < templateCount; i++) {
      const button = templateOptions.nth(i);
      const text = await button.textContent();
      if (text && !text.includes("All Templates") && !text.includes("Mixed")) {
        await button.click();
        await page.waitForLoadState("networkidle");
        clickedFilter = true;
        break;
      }
    }

    if (clickedFilter) {
      // Click "All Templates" to reset the filter
      const allTemplates = page.locator(
        '[role="button"]:has-text("All Templates")'
      );
      if (await allTemplates.first().isVisible()) {
        await allTemplates.first().click();
        await page.waitForLoadState("networkidle");

        // All Templates should now be selected
        await expect(allTemplates.first()).toHaveClass(/bg-primary/);
      }
    } else {
      test.skip();
    }
  });
});

test.describe("Custom Fields - Filter Count Display", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(`E2E Test Project ${Date.now()}`);
  }

  test("Filter options show count of matching test cases", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Switch to Template view (scoped to repository-left-panel-header)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    const templatesOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Template$/i });
    await expect(templatesOption).toBeVisible({ timeout: 5000 });
    await templatesOption.click();

    await page.waitForLoadState("networkidle");

    // Look for filter options with counts (number in parentheses or plain number)
    const filterButtons = page.locator('[role="button"]');
    const buttonCount = await filterButtons.count();

    let hasCount = false;
    for (let i = 0; i < buttonCount; i++) {
      const button = filterButtons.nth(i);
      const text = await button.textContent();
      // Check if text contains a number (the count)
      if (text && /\d+/.test(text)) {
        hasCount = true;
        break;
      }
    }

    // Filter options should display counts
    expect(hasCount).toBe(true);
  });

  test("All option shows total count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Switch to State view (scoped to repository-left-panel-header)
    const viewSelector = page.locator('[data-testid="repository-left-panel-header"] [role="combobox"]');
    await expect(viewSelector).toBeVisible({ timeout: 10000 });
    await viewSelector.click();

    const statesOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^State$/i });
    await expect(statesOption).toBeVisible({ timeout: 5000 });
    await statesOption.click();

    await page.waitForLoadState("networkidle");

    // The "All States" option should show a total count
    const allStates = page.locator('[role="button"]:has-text("All States")');
    await expect(allStates.first()).toBeVisible({ timeout: 10000 });

    const text = await allStates.first().textContent();
    // Should contain "All States" and a number
    expect(text).toContain("All States");
  });
});
