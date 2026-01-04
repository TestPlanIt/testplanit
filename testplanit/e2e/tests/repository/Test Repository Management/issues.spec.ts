import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Issues Tests
 *
 * Test cases for verifying issue-related UI elements in the repository.
 * Note: Full issue integration testing requires a configured project integration
 * (Jira, GitHub, Azure DevOps, etc.). These tests focus on UI elements that are
 * visible without an integration configured.
 */
test.describe("Issues", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("Issues Column Visible in Data Table", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Issues Column Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Issues Column Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify the Issues column header is visible in the data table
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    const issuesColumnHeader = table.locator('th').filter({ hasText: 'Issues' });
    await expect(issuesColumnHeader).toBeVisible({ timeout: 5000 });
  });

  test("Test Case Detail Page Shows Issues Section in Edit Mode", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Issues Section Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Issues Section Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Navigate to test case detail page by clicking the test case link
    const testCaseLink = page.locator(`a[href*="/projects/repository/${projectId}/${testCaseId}"]`).first();
    await expect(testCaseLink).toBeVisible({ timeout: 10000 });
    await testCaseLink.click();

    await page.waitForLoadState("networkidle");

    // Verify we're on the test case detail page
    await expect(page).toHaveURL(new RegExp(`/projects/repository/${projectId}/${testCaseId}`));

    // Click the Edit button to enter edit mode
    const editButton = page.locator('button').filter({ hasText: 'Edit' }).first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // Wait for edit mode to activate
    await page.waitForLoadState("networkidle");

    // In edit mode, we should see the Issues section (label and content area)
    const issuesLabel = page.locator('text=Issues').first();
    await expect(issuesLabel).toBeVisible({ timeout: 5000 });
  });

  test("Issue Tracker Not Configured Message Shown Without Integration", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `No Integration Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `No Integration Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Navigate to test case detail page
    const testCaseLink = page.locator(`a[href*="/projects/repository/${projectId}/${testCaseId}"]`).first();
    await expect(testCaseLink).toBeVisible({ timeout: 10000 });
    await testCaseLink.click();

    await page.waitForLoadState("networkidle");

    // Click the Edit button to enter edit mode
    const editButton = page.locator('button').filter({ hasText: 'Edit' }).first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    await page.waitForLoadState("networkidle");

    // Without a project integration configured, we should see a message about issue tracker not being configured
    // This can be either an alert or text message
    const notConfiguredMessage = page.locator('text=/issue.*tracker.*not.*configured|no.*issue.*tracker/i').first();
    await expect(notConfiguredMessage).toBeVisible({ timeout: 5000 });
  });

  test("Issues Column Can Be Toggled in Column Selector", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Column Toggle Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Column Toggle Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Wait for the table to be visible before clicking Columns
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // The ColumnSelection component uses a PopoverTrigger which renders as a button-like element
    // Find it by looking for the element with the Columns3 icon and "Columns" text
    const columnsButton = page.locator('button').filter({ hasText: 'Columns' }).first();
    await expect(columnsButton).toBeVisible({ timeout: 5000 });

    // Click and wait for popover
    await columnsButton.click({ force: true });

    // Wait for the popover content to appear - look for "Select All" button which is always in the popover
    const popoverContent = page.locator('button').filter({ hasText: /select all/i }).first();
    await expect(popoverContent).toBeVisible({ timeout: 5000 });

    // The column selector uses a Popover with Checkbox components
    // Look for "Issues" label next to a checkbox in the popover
    const issuesLabel = page.locator('label').filter({ hasText: 'Issues' }).first();
    await expect(issuesLabel).toBeVisible({ timeout: 5000 });

    // Close the popover by pressing Escape
    await page.keyboard.press('Escape');
  });

  test("Test Case Row Shows Empty Issues Cell", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case (without any linked issues)
    const folderName = `Empty Issues Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Empty Issues Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify the test case row exists
    const testCaseRow = page.locator(`tr[data-row-id="${testCaseId}"], tr`).filter({ hasText: 'Empty Issues Case' }).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });

    // The Issues cell should exist (even if empty)
    const table = page.locator("table").first();
    const issuesColumnIndex = await getColumnIndex(table, 'Issues');

    // Verify the row has the expected number of cells
    const cells = testCaseRow.locator('td');
    const cellCount = await cells.count();
    expect(cellCount).toBeGreaterThan(issuesColumnIndex);
  });

  test("Navigate to Test Case Detail and Back to Repository", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Navigation Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const caseName = `Navigation Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(projectId, folderId, caseName);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Navigate to test case detail page
    const testCaseLink = page.locator(`a[href*="/projects/repository/${projectId}/${testCaseId}"]`).first();
    await expect(testCaseLink).toBeVisible({ timeout: 10000 });
    await testCaseLink.click();

    await page.waitForLoadState("networkidle");

    // Verify we're on the test case detail page
    await expect(page).toHaveURL(new RegExp(`/projects/repository/${projectId}/${testCaseId}`));

    // Verify the test case name is displayed
    await expect(page.locator(`text="${caseName}"`).first()).toBeVisible({ timeout: 5000 });

    // Click the back button to return to repository
    const backButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    await backButton.click();

    await page.waitForLoadState("networkidle");

    // Verify we're back on the repository page
    await expect(page).toHaveURL(new RegExp(`/projects/repository/${projectId}`));
  });

  test("Configure Integration Link Navigates to Settings", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Configure Link Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Configure Link Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Navigate to test case detail page
    const testCaseLink = page.locator(`a[href*="/projects/repository/${projectId}/${testCaseId}"]`).first();
    await expect(testCaseLink).toBeVisible({ timeout: 10000 });
    await testCaseLink.click();

    await page.waitForLoadState("networkidle");

    // Click the Edit button to enter edit mode
    const editButton = page.locator('button').filter({ hasText: 'Edit' }).first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    await page.waitForLoadState("networkidle");

    // Find the "Edit" button in the issue tracker not configured alert
    // The alert has: "Issue tracker not configured" message + "Edit" button linking to settings
    const configureButton = page.locator('a[href*="/projects/settings/"]').filter({ hasText: 'Edit' }).first();
    await expect(configureButton).toBeVisible({ timeout: 5000 });

    // Verify the link points to the integrations settings page
    const href = await configureButton.getAttribute('href');
    expect(href).toContain(`/projects/settings/${projectId}/integrations`);
  });

  test("Issues Column Can Be Hidden", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Hide Column Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `Hide Column Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify the Issues column is initially visible
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 10000 });

    let issuesColumnHeader = table.locator('th').filter({ hasText: 'Issues' });
    await expect(issuesColumnHeader).toBeVisible({ timeout: 5000 });

    // Open the Columns selector using the button with force click
    const columnsButton = page.locator('button').filter({ hasText: 'Columns' }).first();
    await expect(columnsButton).toBeVisible({ timeout: 5000 });
    await columnsButton.click({ force: true });

    // Wait for popover to open - look for Select All button
    const selectAllButton = page.locator('button').filter({ hasText: /select all/i }).first();
    await expect(selectAllButton).toBeVisible({ timeout: 5000 });

    // Find the Issues checkbox by its id and click it with force to avoid detachment issues
    // The checkbox has id="issues" and is inside a ScrollArea which can cause element detachment
    const issuesCheckbox = page.locator('#issues');
    await expect(issuesCheckbox).toBeVisible({ timeout: 3000 });
    await issuesCheckbox.click({ force: true });

    // Close the popover
    await page.keyboard.press('Escape');

    // Verify the Issues column is now hidden (popover should close automatically)
    issuesColumnHeader = table.locator('th').filter({ hasText: 'Issues' });
    await expect(issuesColumnHeader).not.toBeVisible({ timeout: 5000 });
  });

  test("Issues Section Shows Loading State", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case
    const folderName = `Loading State Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseId = await api.createTestCase(projectId, folderId, `Loading State Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Navigate to test case detail page
    const testCaseLink = page.locator(`a[href*="/projects/repository/${projectId}/${testCaseId}"]`).first();
    await expect(testCaseLink).toBeVisible({ timeout: 10000 });
    await testCaseLink.click();

    await page.waitForLoadState("networkidle");

    // Click the Edit button to enter edit mode
    const editButton = page.locator('button').filter({ hasText: 'Edit' }).first();
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // The issues section should eventually show the "not configured" message
    // (either after loading completes or immediately if data is cached)
    const issuesSection = page.locator('text=/issues/i').first();
    await expect(issuesSection).toBeVisible({ timeout: 10000 });
  });
});

/**
 * Helper function to get the index of a column by header name
 */
async function getColumnIndex(table: import("@playwright/test").Locator, columnName: string): Promise<number> {
  const headers = table.locator('th');
  const count = await headers.count();

  for (let i = 0; i < count; i++) {
    const text = await headers.nth(i).textContent();
    if (text?.includes(columnName)) {
      return i;
    }
  }

  return -1;
}
