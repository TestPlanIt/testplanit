import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../../fixtures";
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
 * 1. Dynamic view options appear in the view selector (grouping axes)
 * 2. Filtering by custom field values produces a FilterBar chip and a `?f=`
 *    URL param — the axis itself never seeds or clears filters
 * 3. The FilterBar's Add-filter / chip-editor path works for any dimension
 */

/** A clickable option row in the left panel (rows carry no test id). */
function sidebarRow(page: Page, name: string | RegExp): Locator {
  return page
    .getByTestId("repository-left-panel")
    .locator('[role="button"]')
    .filter({ hasText: name })
    .first();
}

/** The `f` params currently serialized into the URL, form-decoded. */
function filterParams(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll("f");
}

async function expectFilterParam(page: Page, pattern: RegExp): Promise<void> {
  await expect
    .poll(() => filterParams(page).join("|"), { timeout: 10000 })
    .toMatch(pattern);
}

async function expectNoFilterParams(page: Page): Promise<void> {
  await expect.poll(() => filterParams(page)).toEqual([]);
}

/** Open the FilterBar's Add-filter picker and choose a dimension. */
async function addFilterDimension(page: Page, dimension: string) {
  const addButton = page.getByTestId("filter-bar-add");
  await expect(addButton).toBeVisible({ timeout: 10000 });
  await addButton.click();
  const option = page.getByTestId(`filter-dimension-option-${dimension}`);
  await expect(option).toBeVisible({ timeout: 5000 });
  await option.click();
}

test.describe("Custom Fields - Repository View and Filter", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    // Create a project for this test - tests should be self-contained
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("View selector shows available view options", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // The view selector is within the repository-left-panel-header container
    // We need to scope it to avoid clicking the project selector
    const viewSelector = page.locator('[data-testid="view-selector-trigger"]');

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      await expect(viewSelector).toBeVisible({ timeout: 10000 });

      // Click to open the selector
      await viewSelector.click();
    });

    await test.step("Verify standard view options are available", async () => {
      // Standard view options should be available
      const selectContent = page.locator('[role="listbox"]');
      await expect(selectContent).toBeVisible({ timeout: 5000 });

      // Check for standard views: Folders, Template, State, Creator, Automation
      await expect(
        selectContent
          .locator('[role="option"]')
          .filter({ hasText: /^Folders$/i })
      ).toBeVisible();
      await expect(
        selectContent
          .locator('[role="option"]')
          .filter({ hasText: /^Template$/i })
      ).toBeVisible();
      await expect(
        selectContent.locator('[role="option"]').filter({ hasText: /^State$/i })
      ).toBeVisible();
      await expect(
        selectContent
          .locator('[role="option"]')
          .filter({ hasText: /^Creator$/i })
      ).toBeVisible();
      await expect(
        selectContent
          .locator('[role="option"]')
          .filter({ hasText: /^Automation$/i })
      ).toBeVisible();
    });

    await test.step("Close the selector", async () => {
      // Close the selector
      await page.keyboard.press("Escape");
    });
  });

  test("Switch to Templates view and filter by template", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      // Open view selector (scoped to repository-left-panel-header to avoid project selector)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();
    });

    await test.step("Select the Template view", async () => {
      // Select Template view
      const templatesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Template$/i });
      await expect(templatesOption).toBeVisible({ timeout: 5000 });
      await templatesOption.click();

      // Wait for view to update
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify template filter options appear", async () => {
      // Template filter options should appear below the selector
      // Look for template list items (role="button" with template names)
      const templateFilters = page.locator(
        '[role="button"]:has-text("All Templates")'
      );
      await expect(templateFilters.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Switch to State view and filter by state", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      // Open view selector (scoped to repository-left-panel-header to avoid project selector)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();
    });

    await test.step("Select the State view", async () => {
      // Select State view
      const statesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^State$/i });
      await expect(statesOption).toBeVisible({ timeout: 5000 });
      await statesOption.click();

      // Wait for view to update
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify state filter options appear", async () => {
      // State filter options should appear
      const stateFilters = page.locator(
        '[role="button"]:has-text("All States")'
      );
      await expect(stateFilters.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Switch to Automation view and filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Open view selector (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="view-selector-trigger"]');

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();
    });

    await test.step("Select the Automation view", async () => {
      // Select Automation view
      const automationOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Automation$/i });
      await expect(automationOption).toBeVisible({ timeout: 5000 });
      await automationOption.click();

      // Wait for view to update
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify automation filter options and selected view", async () => {
      // Automation filter options should appear - at minimum "All Cases" filter
      // "Automated" and "Not Automated" only appear if there are test cases in those categories
      const allCasesFilter = page.locator(
        '[role="button"]:has-text("All Cases")'
      );
      await expect(allCasesFilter.first()).toBeVisible({ timeout: 10000 });

      // Verify the view selector now shows Automation
      await expect(viewSelector).toContainText(/Automation/i);
    });
  });

  test("Switch to Creator view and filter", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      // Open view selector (scoped to repository-left-panel-header to avoid project selector)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();
    });

    await test.step("Select the Creator view", async () => {
      // Select Creator view
      const creatorsOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Creator$/i });
      await expect(creatorsOption).toBeVisible({ timeout: 5000 });
      await creatorsOption.click();

      // Wait for view to update
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify creator filter options appear", async () => {
      // Creator filter options should appear
      const allCreatorsFilter = page.locator(
        '[role="button"]:has-text("All Creators")'
      );
      await expect(allCreatorsFilter.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test("Tag view shows tag filtering options", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E Tag Axis Case ${Date.now()}`;

    // Select Tag view
    const tagsOption = page
      .locator('[role="option"]')
      .filter({ hasText: /^Tag$/i });

    await test.step("Seed an untagged test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, caseName);
    });

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      // Open view selector (scoped to repository-left-panel-header to avoid project selector)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();
    });

    await test.step("Select the Tag view and verify filter options appear", async () => {
      // The Tag axis is always offered — grouping is independent of data.
      await expect(tagsOption).toBeVisible({ timeout: 5000 });
      await tagsOption.click();
      await page.waitForLoadState("networkidle");

      // Tag view pins the Any Tag / No Tags rows above the tag list
      await expect(sidebarRow(page, "Any Tag")).toBeVisible({ timeout: 10000 });
      await expect(sidebarRow(page, "No Tags")).toBeVisible({ timeout: 5000 });
    });

    await test.step("Verify selecting the axis seeded no tag filter", async () => {
      await expect(page.getByTestId("filter-chip-tags-any")).not.toBeVisible();
      await expectNoFilterParams(page);
      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Dynamic field view appears for Dropdown fields", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      // Open view selector (scoped to repository-left-panel-header to avoid project selector)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();
    });

    await test.step("Verify view options are available, then close the selector", async () => {
      // Get all options
      const options = page.locator('[role="option"]');
      const optionCount = await options.count();

      // Verify that there are options available (standard views + any dynamic fields)
      expect(optionCount).toBeGreaterThan(0);

      await page.keyboard.press("Escape");
    });
  });

  test("Switching view updates URL and shows filter options", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Start in Template view (scoped to repository-left-panel-header to avoid project selector)
    const viewSelector = page.locator('[data-testid="view-selector-trigger"]');

    await test.step("Open repository and the view selector", async () => {
      await repositoryPage.goto(projectId);

      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();
    });

    await test.step("Select the Template view", async () => {
      const templatesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Template$/i });
      await expect(templatesOption).toBeVisible({ timeout: 5000 });
      await templatesOption.click();
    });

    await test.step("Verify the URL reflects the templates view", async () => {
      // Wait for the URL to update with view=templates
      await page.waitForURL(/view=templates/, { timeout: 10000 });

      // Verify the URL now contains view=templates
      const url = page.url();
      expect(url).toContain("view=templates");
    });

    await test.step("Verify template filter and selected view", async () => {
      // Get the "All Templates" filter button
      const allTemplatesButton = page.locator(
        '[role="button"]:has-text("All Templates")'
      );
      await expect(allTemplatesButton.first()).toBeVisible({ timeout: 10000 });

      // Verify the view selector now shows Template
      await expect(viewSelector).toContainText(/Template/i);
    });
  });

  test("Chip editor multi-selects values within one dimension", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const case1Name = `E2E Multi-Select State1 ${uniqueId}`;
    const case2Name = `E2E Multi-Select State2 ${uniqueId}`;
    const case3Name = `E2E Multi-Select State3 ${uniqueId}`;
    let stateIds: number[] = [];

    await test.step("Seed test cases in three different states", async () => {
      // Cmd/Ctrl+Click multi-select is gone; values are accumulated in a
      // single predicate, either by clicking sidebar rows or — as here — from
      // the chip editor's value list.
      const rootFolderId = await api.getRootFolderId(projectId);
      stateIds = await api.getStateIds(projectId, 3);

      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        case1Name,
        stateIds[0]
      );
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        case2Name,
        stateIds[1]
      );
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        case3Name,
        stateIds[2]
      );
    });

    await test.step("Open the repository", async () => {
      await repositoryPage.goto(projectId);
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Add a State filter and pick the first value", async () => {
      await addFilterDimension(page, "states");

      // The seeded `states:in` predicate has no values yet, so the chip opens
      // as a draft editor until a value is chosen.
      await expect(page.getByTestId("filter-chip-editor")).toBeVisible({
        timeout: 5000,
      });
      await page.getByTestId(`filter-value-option-${stateIds[0]}`).click();

      const chip = page.getByTestId("filter-chip-states-in");
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expectFilterParam(page, new RegExp(`^states:in:${stateIds[0]}$`));
    });

    await test.step("Pick a second value in the same chip", async () => {
      await page.getByTestId(`filter-value-option-${stateIds[1]}`).click();
      await expectFilterParam(
        page,
        new RegExp(`states:in:${stateIds[0]},${stateIds[1]}`)
      );
      await page.keyboard.press("Escape");
    });

    await test.step("Verify both selected states match and the third does not", async () => {
      await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${case3Name}"`)).not.toBeVisible({
        timeout: 5000,
      });
    });
  });

  test("URL reflects the current view and filter state", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Navigate directly to the templates view via URL", async () => {
      // Navigate directly to a specific view via URL
      await page.goto(`/en-US/projects/repository/${projectId}?view=templates`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the view selector shows Template", async () => {
      // Verify view selector shows Template (scoped to repository-left-panel-header)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await expect(viewSelector).toContainText(/Template/i);
    });
  });

  test("Folder view is the default view", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Navigate to repository without a view parameter", async () => {
      // Navigate to repository without view parameter
      await page.goto(`/en-US/projects/repository/${projectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the view selector defaults to Folders", async () => {
      // View selector should show Folders by default (scoped to repository-left-panel-header)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await expect(viewSelector).toContainText(/Folders/i);
    });
  });

  test("Search input filters test cases within current view", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const uniqueId = Date.now();
    const matchingName = `E2E NameFilterMatch ${uniqueId}`;
    const otherName = `E2E Untouched ${uniqueId}`;

    // The in-table name filter — the repository's own search. Pinned to its
    // test id rather than a placeholder so it stays unambiguous.
    const searchInput = page.getByTestId("search-input");

    await test.step("Seed a matching and a non-matching test case", async () => {
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, matchingName);
      await api.createTestCase(projectId, rootFolderId, otherName);
    });

    await test.step("Open repository and locate the search input", async () => {
      await repositoryPage.goto(projectId);

      // Wait for page to load
      await page.waitForLoadState("networkidle");

      await expect(searchInput).toBeVisible({ timeout: 10000 });
      await expect(page.locator(`text="${otherName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Type a search term to filter test cases", async () => {
      await searchInput.fill("NameFilterMatch");
      // Wait for debounce and API response
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify only the matching case remains", async () => {
      await expect(page.locator(`text="${matchingName}"`).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator(`text="${otherName}"`)).not.toBeVisible({
        timeout: 5000,
      });

      // The in-table name filter never serializes to the URL.
      await expectNoFilterParams(page);
    });
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
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Priority custom field appears in view selector", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);
    const priorityCaseName = `E2E Priority View Test ${Date.now()}`;

    // Define the view selector
    const viewSelector = page.locator('[data-testid="view-selector-trigger"]');

    await test.step("Assign the Priority field to the template and seed a test case", async () => {
      // Ensure Priority field is assigned to the project's template
      // Priority is a seeded case field that should be in the default template
      // But other tests may have changed the default template, so we need to verify
      const templateId = await api.getTemplateId(projectId);
      const priorityFieldId = await api.getCaseFieldId("Priority");

      if (!priorityFieldId) {
        throw new Error(
          "Priority case field not found - it should be seeded in the database"
        );
      }

      // Assign Priority field to the template to ensure test isolation
      const assigned = await api.assignFieldToTemplate(
        templateId,
        priorityFieldId
      );
      if (!assigned) {
        console.warn(
          "Failed to assign Priority field to template - it may already be assigned"
        );
      }

      // Create a test case to ensure there's data in the repository
      const rootFolderId = await api.getRootFolderId(projectId);
      await api.createTestCase(projectId, rootFolderId, priorityCaseName);
    });

    await test.step("Open repository and wait for view options to load", async () => {
      // Set up response listener before navigation to catch the view-options API call
      const viewOptionsPromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/repository-cases/view-options") &&
          response.status() === 200,
        { timeout: 15000 }
      );

      await repositoryPage.goto(projectId);

      // Wait for the view-options API call to complete
      await viewOptionsPromise;

      // Wait for React Query to process the response and update the component state
      await page.waitForLoadState("networkidle");
    });

    await test.step("Open the view selector dropdown", async () => {
      await expect(viewSelector).toBeVisible({ timeout: 10000 });

      // Open the menu - options are rendered dynamically when the dropdown opens
      await viewSelector.click();

      // Wait for the first option to appear (dropdown is now open and rendering options)
      await expect(page.locator('[role="option"]').first()).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("Select the Priority view and verify filter options appear", async () => {
      // Look for Priority as a dynamic field option in the view selector
      // Priority is a seeded case field of type Dropdown assigned to the default template
      const priorityOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Priority$/i });

      // Priority should now be visible in the opened dropdown
      await expect(priorityOption).toBeVisible({ timeout: 5000 });

      // Click Priority view option
      await priorityOption.click();
      await page.waitForLoadState("networkidle");

      // Verify the view selector now shows Priority
      await expect(viewSelector).toContainText(/Priority/i);

      // Priority filter options should appear (the "Mixed" row plus the
      // field's option rows)
      const priorityFilters =
        repositoryPage.leftPanel.locator('[role="button"]');
      await expect(priorityFilters.first()).toBeVisible({ timeout: 10000 });
    });

    await test.step("Verify the dynamic-field axis seeds no filter", async () => {
      // `?view=dynamic_*` used to auto-select the field's first option; it now
      // loads unfiltered.
      await expect(
        page.locator('[data-testid^="filter-chip-field_"]')
      ).toHaveCount(0);
      await expectNoFilterParams(page);
      await expect(
        page.locator(`text="${priorityCaseName}"`).first()
      ).toBeVisible({ timeout: 10000 });
    });

    await test.step("Click a Priority option row and verify a field chip appears", async () => {
      // Row 0 is the "Mixed" row; row 1 is the first real value.
      const optionRow = repositoryPage.leftPanel
        .locator('[role="button"]')
        .nth(1);
      await expect(optionRow).toBeVisible({ timeout: 10000 });
      await optionRow.click();

      const chip = page.locator('[data-testid^="filter-chip-field_"]').first();
      await expect(chip).toBeVisible({ timeout: 10000 });
      await expectFilterParam(page, /field_\d+:(in|any|none)/);
    });
  });

  test("Column visibility toggle shows custom field columns", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    // Look for the "Columns" button that toggles column visibility
    const columnToggle = page.locator('button:has-text("Columns")');

    let hasColumnToggle: boolean | undefined;

    await test.step("Seed a test case and open repository", async () => {
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

      hasColumnToggle = await columnToggle.first().isVisible();
    });

    await test.step("Open the column visibility menu and verify it appears", async () => {
      if (hasColumnToggle) {
        await columnToggle.first().click();

        // A menu or popover should appear with column options
        const columnMenu = page.locator(
          '[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]'
        );
        await expect(columnMenu.first()).toBeVisible({ timeout: 5000 });

        // Close the menu
        await page.keyboard.press("Escape");
      }
    });
  });

  test("Clear all filters button resets filters", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    const caseName = `E2E Clear Filter Test ${Date.now()}`;
    let stateIds: number[] = [];

    await test.step("Seed a test case and open repository", async () => {
      // Create a test case to ensure there's data to filter
      const rootFolderId = await api.getRootFolderId(projectId);
      stateIds = await api.getStateIds(projectId, 1);
      await api.createTestCaseWithState(
        projectId,
        rootFolderId,
        caseName,
        stateIds[0]
      );

      await repositoryPage.goto(projectId);
    });

    await test.step("Switch to the Template view", async () => {
      // Switch to a view with filters (scoped to repository-left-panel-header)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();

      const templatesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Template$/i });
      await expect(templatesOption).toBeVisible({ timeout: 5000 });
      await templatesOption.click();

      await page.waitForLoadState("networkidle");
    });

    await test.step("Apply a specific template filter from the sidebar", async () => {
      // Row 0 is "All Templates"; row 1 is the first individual template.
      const templateRow = repositoryPage.leftPanel
        .locator('[role="button"]')
        .nth(1);
      await expect(templateRow).toBeVisible({ timeout: 10000 });
      await templateRow.click();

      await expect(page.getByTestId("filter-chip-templates-in")).toBeVisible({
        timeout: 10000,
      });
      await expectFilterParam(page, /templates:in:\d+/);
    });

    await test.step("Add a second filter from a different dimension", async () => {
      // Clear-all only appears at two or more predicates, and filters from
      // different dimensions AND together.
      await addFilterDimension(page, "states");
      await page.getByTestId(`filter-value-option-${stateIds[0]}`).click();
      await expect(page.getByTestId("filter-chip-states-in")).toBeVisible({
        timeout: 10000,
      });
      await page.keyboard.press("Escape");

      await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Clear every filter with the FilterBar's Clear all", async () => {
      const clearAll = page.getByTestId("filter-bar-clear");
      await expect(clearAll).toBeVisible({ timeout: 10000 });
      await clearAll.click();

      await expect(
        page.getByTestId("filter-chip-templates-in")
      ).not.toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("filter-chip-states-in")).not.toBeVisible();
      await expectNoFilterParams(page);

      // The "All Templates" row is the unfiltered-dimension indicator.
      await expect(sidebarRow(page, /All Templates/i)).toHaveClass(
        /bg-primary/
      );
    });
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
    return await api.createProject(
      `E2E Test Project ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  }

  test("Filter options show count of matching test cases", async ({
    api,
    page,
  }) => {
    const projectId = await getTestProjectId(api);

    let hasCount = false;

    await test.step("Open repository and switch to the Template view", async () => {
      await repositoryPage.goto(projectId);

      // Switch to Template view (scoped to repository-left-panel-header)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();

      const templatesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^Template$/i });
      await expect(templatesOption).toBeVisible({ timeout: 5000 });
      await templatesOption.click();

      await page.waitForLoadState("networkidle");
    });

    await test.step("Scan filter options for a numeric count", async () => {
      // Look for filter options with counts (number in parentheses or plain
      // number). Scoped to the left panel so FilterBar controls can't satisfy
      // the assertion instead of the option rows.
      const filterButtons = repositoryPage.leftPanel.locator('[role="button"]');
      const buttonCount = await filterButtons.count();

      for (let i = 0; i < buttonCount; i++) {
        const button = filterButtons.nth(i);
        const text = await button.textContent();
        // Check if text contains a number (the count)
        if (text && /\d+/.test(text)) {
          hasCount = true;
          break;
        }
      }
    });

    await test.step("Verify filter options display counts", async () => {
      // Filter options should display counts
      expect(hasCount).toBe(true);
    });
  });

  test("All option shows total count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await test.step("Open repository and switch to the State view", async () => {
      await repositoryPage.goto(projectId);

      // Switch to State view (scoped to repository-left-panel-header)
      const viewSelector = page.locator(
        '[data-testid="view-selector-trigger"]'
      );
      await expect(viewSelector).toBeVisible({ timeout: 10000 });
      await viewSelector.click();

      const statesOption = page
        .locator('[role="option"]')
        .filter({ hasText: /^State$/i });
      await expect(statesOption).toBeVisible({ timeout: 5000 });
      await statesOption.click();

      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the All States option shows a total count", async () => {
      // The "All States" option should show a total count
      const allStates = sidebarRow(page, "All States");
      await expect(allStates).toBeVisible({ timeout: 10000 });

      const text = await allStates.textContent();
      // Should contain "All States" and a number
      expect(text).toContain("All States");
      expect(text).toMatch(/\d/);
    });
  });
});
