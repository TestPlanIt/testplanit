import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * View Switching Tests
 *
 * Test cases for switching between different view modes in the repository.
 * The view switcher is a Select component (combobox) in the left panel header.
 */
test.describe("View Switching", () => {
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

  /**
   * Helper to get the view switcher combobox
   * The view switcher is a Select component in the left panel header
   */
  async function getViewSwitcher(page: import("@playwright/test").Page) {
    // The view switcher is a combobox in the left panel
    // Match singular view names: Folders, Template, State, Creator, Automation, Tag
    const viewSwitcher = page.locator('[role="combobox"]').filter({
      hasText: /Folders|Template|State|Creator|Automation|Tag/i
    }).first();
    return viewSwitcher;
  }

  /**
   * Helper to switch to a specific view
   */
  async function switchToView(page: import("@playwright/test").Page, viewName: string) {
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();

    // Wait for dropdown to open and select the option
    const option = page.locator('[role="option"]').filter({ hasText: new RegExp(viewName, 'i') }).first();
    await expect(option).toBeVisible({ timeout: 3000 });
    await option.click();

    await page.waitForLoadState("networkidle");
  }

  test("Default View is Folders @smoke", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // The default view should be Folders
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await expect(viewSwitcher).toContainText(/Folders/i);

    // The folder tree should be visible
    await expect(repositoryPage.leftPanel).toBeVisible();
  });

  test("Switch to Template View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    await switchToView(page, "Template");

    // Verify the view switcher shows Template
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Template/i);

    // The left panel should show template filter options
    // Look for "All Templates" text which appears in the Templates view
    const templateFilter = page.locator('text=/All Templates/i');
    await expect(templateFilter.first()).toBeVisible({ timeout: 5000 });
  });

  test("Switch to State View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    await switchToView(page, "State");

    // Verify the view switcher shows State
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/State/i);

    // The left panel should show state filter options
    // Look for "All States" text which appears in the States view
    const stateFilter = page.locator('text=/All States/i');
    await expect(stateFilter.first()).toBeVisible({ timeout: 5000 });
  });

  test("Switch to Creator View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    await switchToView(page, "Creator");

    // Verify the view switcher shows Creator
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Creator/i);

    // The left panel should show creator filter options
    // Look for "All Creators" text which appears in the Creators view
    const creatorFilter = page.locator('text=/All Creators/i');
    await expect(creatorFilter.first()).toBeVisible({ timeout: 5000 });
  });

  test("Switch to Automation View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    await switchToView(page, "Automation");

    // Verify the view switcher shows Automation
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Automation/i);

    // The left panel should show automation filter options
    // Look for "All Cases" text which appears in the Automation view
    const automationFilter = page.locator('text=/All Cases|Automated|Not Automated/i');
    await expect(automationFilter.first()).toBeVisible({ timeout: 5000 });
  });

  test("Switch to Tag View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    await switchToView(page, "Tag");

    // Verify the view switcher shows Tag
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Tag/i);

    // The left panel should show tag filter options
    // The tags view shows available tags or "Any Tag" option
    await expect(repositoryPage.leftPanel).toBeVisible();
  });

  test("Switch Back to Folders View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // First switch to Template view
    await switchToView(page, "Template");
    let viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Template/i);

    // Then switch back to Folders view
    await switchToView(page, "Folders");
    viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Folders/i);

    // The folder tree should be visible again with Root Folder
    const rootFolder = page.locator('[data-testid^="folder-node-"]').filter({
      hasText: "Root Folder"
    });
    await expect(rootFolder.first()).toBeVisible({ timeout: 5000 });
  });

  test("URL Updates When View Changes", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Switch to Template view
    await switchToView(page, "Template");

    // URL should contain view=templates parameter
    await expect(page).toHaveURL(/view=templates/);

    // Switch to State view
    await switchToView(page, "State");

    // URL should now contain view=states parameter
    await expect(page).toHaveURL(/view=states/);
  });

  test("View Persists After Page Reload", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Switch to Template view
    await switchToView(page, "Template");
    let viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Template/i);

    // Verify the URL contains the view parameter before reloading
    // This ensures the view state is properly persisted in the URL
    await expect(page).toHaveURL(/view=templates/, { timeout: 5000 });

    // Reload the page
    await page.reload();
    await repositoryPage.waitForRepositoryLoad();

    // The view should still be Template (persisted via URL)
    viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Template/i);
  });

  test("Folder View Shows Test Case Counts", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases
    const folderName = `Count Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Case 1 ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `Case 2 ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Ensure we're in folder view (default)
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Folders/i);

    // The folder should show the count (e.g., "(2/2)")
    const folderWithCount = page.locator('[data-testid^="folder-node-"]').filter({
      hasText: folderName
    }).filter({
      hasText: /\(\d+\/\d+\)/
    });
    await expect(folderWithCount.first()).toBeVisible({ timeout: 10000 });
  });

  test("Template View Shows Individual Template with Count", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases (they use the default template)
    const folderName = `Template Count Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Template Case ${Date.now()}`);

    await repositoryPage.goto(projectId);
    await switchToView(page, "Template");

    // The left panel should show individual templates with counts
    // Default Template should have at least 1 count
    const templateWithCount = repositoryPage.leftPanel.locator('[role="button"]').filter({
      hasText: /Default Template/i
    });
    await expect(templateWithCount.first()).toBeVisible({ timeout: 5000 });
  });

  test("State View Shows Individual States with Icons", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a test case so the state view has data to show
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `State View Case ${Date.now()}`);

    await repositoryPage.goto(projectId);
    await switchToView(page, "State");

    // The left panel should show individual states
    // Look for common workflow states like "Draft" or state buttons with icons
    const stateButtons = repositoryPage.leftPanel.locator('[role="button"]');
    // Should have at least "All States" and some individual states
    await expect(stateButtons.first()).toBeVisible({ timeout: 5000 });
    const count = await stateButtons.count();
    expect(count).toBeGreaterThan(1); // At least "All States" plus one state
  });

  test("Creator View Shows Individual Creators", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a test case so the current user appears as a creator
    const folderName = `Creator Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Creator Case ${Date.now()}`);

    await repositoryPage.goto(projectId);
    await switchToView(page, "Creator");

    // The left panel should show individual creators
    // Look for user avatars or names in the filter list
    const creatorButtons = repositoryPage.leftPanel.locator('[role="button"]');
    await expect(creatorButtons.first()).toBeVisible({ timeout: 5000 });
    const count = await creatorButtons.count();
    expect(count).toBeGreaterThan(1); // At least "All Creators" plus the admin user
  });

  test("Automation View Shows Automated and Not Automated Options", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a test case so the automation view has data to show
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(projectId, rootFolderId, `Automation View Case ${Date.now()}`);

    await repositoryPage.goto(projectId);
    await switchToView(page, "Automation");

    // Should show "All Cases", "Automated", and "Not Automated" options
    const allCasesOption = repositoryPage.leftPanel.locator('[role="button"]').filter({
      hasText: /All Cases/i
    });
    await expect(allCasesOption.first()).toBeVisible({ timeout: 5000 });

    // Check for Automated/Not Automated options
    const automatedOption = repositoryPage.leftPanel.locator('[role="button"]').filter({
      hasText: /Automated|Not Automated/i
    });
    await expect(automatedOption.first()).toBeVisible({ timeout: 5000 });
  });

  test("Direct URL Navigation to View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Navigate directly to states view via URL
    await page.goto(`/en-US/projects/repository/${projectId}?view=states`);
    await repositoryPage.waitForRepositoryLoad();

    // View switcher should show State
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/State/i);

    // Should show "All States" filter option
    const stateFilter = page.locator('text=/All States/i');
    await expect(stateFilter.first()).toBeVisible({ timeout: 5000 });
  });

  test("Clicking Filter Option Updates View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create test cases so there's data to filter
    const folderName = `Filter Test Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Filter Case ${Date.now()}`);

    await repositoryPage.goto(projectId);
    await switchToView(page, "Template");

    // Click on "All Templates" option
    const allTemplatesOption = repositoryPage.leftPanel.locator('[role="button"]').filter({
      hasText: /All Templates/i
    }).first();
    await expect(allTemplatesOption).toBeVisible({ timeout: 5000 });
    await allTemplatesOption.click();

    // Should remain in Template view with filter applied
    const viewSwitcher = await getViewSwitcher(page);
    await expect(viewSwitcher).toContainText(/Template/i);
  });

  test("View Dropdown Shows All Available Options", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await repositoryPage.goto(projectId);

    // Open the view switcher dropdown
    const viewSwitcher = await getViewSwitcher(page);
    await viewSwitcher.click();

    // Verify all standard view options are available
    const options = page.locator('[role="option"]');

    // Check for Folders option
    await expect(options.filter({ hasText: /Folders/i }).first()).toBeVisible({ timeout: 3000 });

    // Check for Template option
    await expect(options.filter({ hasText: /Template/i }).first()).toBeVisible();

    // Check for State option
    await expect(options.filter({ hasText: /State/i }).first()).toBeVisible();

    // Check for Creator option
    await expect(options.filter({ hasText: /Creator/i }).first()).toBeVisible();

    // Check for Automation option
    await expect(options.filter({ hasText: /Automation/i }).first()).toBeVisible();

    // Check for Tag option
    await expect(options.filter({ hasText: /Tag/i }).first()).toBeVisible();

    // Close dropdown
    await page.keyboard.press('Escape');
  });

  test("Keyboard Navigation in View Switcher", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    await repositoryPage.goto(projectId);

    // Open the view switcher with keyboard
    const viewSwitcher = await getViewSwitcher(page);
    await viewSwitcher.focus();
    await page.keyboard.press('Enter');

    // Dropdown should be open
    const options = page.locator('[role="option"]');
    await expect(options.first()).toBeVisible({ timeout: 3000 });

    // Navigate down with arrow key
    await page.keyboard.press('ArrowDown');

    // Close with Escape
    await page.keyboard.press('Escape');

    // Dropdown should be closed
    await expect(options.first()).not.toBeVisible({ timeout: 2000 });
  });

  test("Test Case Table Shows Required Columns", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with a test case
    const folderName = `Columns Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(
      projectId,
      folderId,
      `Column Test Case ${Date.now()}`
    );

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify essential columns are visible in the table header
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Check for Name column
    await expect(table.locator('th:has-text("Name")')).toBeVisible();

    // Check for State column
    await expect(table.locator('th:has-text("State")')).toBeVisible();
  });

  test("Empty Folder Shows No Test Cases Message", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create an empty folder
    const folderName = `Empty Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the empty folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify empty state message is shown
    const emptyMessage = page.locator("text=/No test cases|No cases/i");
    await expect(emptyMessage.first()).toBeVisible({ timeout: 10000 });
  });

  test("Test Case Shows State Badge", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with a test case
    const folderName = `State Badge Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `State Badge Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Find the test case row
    const testCaseRow = page.locator(`[data-row-id="${testCaseId}"]`).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });

    // The row should contain a state badge (default state is usually "New" or "Draft")
    // Look for state text in the state column
    await expect(testCaseRow).toContainText(/New|Draft|Ready|Approved/i);
  });
});
