import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Test Case Management Tests
 *
 * Test cases for managing test cases within folders in the repository.
 */
test.describe("Test Case Management", () => {
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

  test("Select Folder to View Test Cases @smoke", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with some test cases
    const folderName = `Folder Cases View ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Test Case ${Date.now()}`;
    await api.createTestCase(projectId, folderId, testCaseName);

    await repositoryPage.goto(projectId);

    // Click on the folder to select it
    await repositoryPage.selectFolder(folderId);

    // Verify that the test case is displayed in the right panel
    const testCaseRow = page.locator(`text="${testCaseName}"`).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });
  });

  test("Create Test Case in Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder via API (folder creation is tested separately)
    const folderName = `E2E TC Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the folder first
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Create a test case via UI using page object method
    const testCaseName = `E2E Test Case ${Date.now()}`;
    await repositoryPage.createTestCase(testCaseName);

    // Verify the test case was created and is visible in the table
    // The table should automatically refetch after creation via query invalidation
    await repositoryPage.verifyTestCaseExists(testCaseName);
  });

  test("View Test Cases in Selected Folder Only", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create two folders with different test cases
    const folder1Name = `Folder1 Isolation ${Date.now()}`;
    const folder1Id = await api.createFolder(projectId, folder1Name);
    const case1Name = `Case In Folder1 ${Date.now()}`;
    await api.createTestCase(projectId, folder1Id, case1Name);

    const folder2Name = `Folder2 Isolation ${Date.now()}`;
    const folder2Id = await api.createFolder(projectId, folder2Name);
    const case2Name = `Case In Folder2 ${Date.now()}`;
    await api.createTestCase(projectId, folder2Id, case2Name);

    await repositoryPage.goto(projectId);

    // Select folder 1
    await repositoryPage.selectFolder(folder1Id);
    await page.waitForLoadState("networkidle");

    // Verify only folder 1's test case is visible
    await expect(page.locator(`text="${case1Name}"`).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`text="${case2Name}"`)).not.toBeVisible({
      timeout: 3000,
    });

    // Select folder 2
    await repositoryPage.selectFolder(folder2Id);
    await page.waitForLoadState("networkidle");

    // Verify only folder 2's test case is visible
    await expect(page.locator(`text="${case2Name}"`).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`text="${case1Name}"`)).not.toBeVisible({
      timeout: 3000,
    });
  });

  test("Click Test Case to View Details", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with a test case
    const folderName = `Details Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Details Case ${Date.now()}`;
    const testCaseId = await api.createTestCase(
      projectId,
      folderId,
      testCaseName
    );

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Find the test case row - it should be visible in the table
    const testCaseRow = page.locator(`[data-row-id="${testCaseId}"]`).first();
    await expect(testCaseRow).toBeVisible({ timeout: 10000 });

    // Get the link in the Name column
    // The link is inside a cell and contains the test case name
    const testCaseLink = testCaseRow.locator("a").first();
    await expect(testCaseLink).toBeVisible({ timeout: 5000 });

    // Get the href and verify it's the correct detail URL
    const href = await testCaseLink.getAttribute("href");
    expect(href).toContain(`/projects/repository/${projectId}/${testCaseId}`);

    // Navigate directly using the href to avoid any click interception issues
    await page.goto(href!);
    await page.waitForLoadState("networkidle");

    // Verify we're on the detail page
    await expect(page).toHaveURL(
      new RegExp(`/projects/repository/${projectId}/${testCaseId}`)
    );
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

  test("Add Case Button Opens Modal", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder
    const folderName = `Add Case Modal Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Click the Add Case button
    const addCaseButton = page
      .getByTestId("add-case-button")
      .or(page.locator('button:has-text("Add Case")'))
      .first();
    await expect(addCaseButton).toBeVisible({ timeout: 5000 });
    await addCaseButton.click();

    // Verify modal opens with name input (it's a textarea with data-testid="case-name-input")
    const nameInput = page.getByTestId("case-name-input");
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    // Close modal with Escape
    await page.keyboard.press("Escape");
    await expect(nameInput).not.toBeVisible({ timeout: 3000 });
  });

  test("Test Case Row Has Action Buttons", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with a test case
    const folderName = `Actions Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const testCaseName = `Actions Case ${Date.now()}`;
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

    // The row should have action buttons (at least 1 button in Actions column)
    const actionButtons = testCaseRow.locator("button");
    const buttonCount = await actionButtons.count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test("Select All Checkbox in Table Header", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with multiple test cases
    const folderName = `Select All Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(
      projectId,
      folderId,
      `Select All Case 1 ${Date.now()}`
    );
    await api.createTestCase(
      projectId,
      folderId,
      `Select All Case 2 ${Date.now()}`
    );
    await api.createTestCase(
      projectId,
      folderId,
      `Select All Case 3 ${Date.now()}`
    );

    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Find the "Select All" checkbox in the table header
    // The checkbox can be a native input[type="checkbox"] or a Radix checkbox (button[role="checkbox"])
    const headerRow = page.locator("thead tr").first();
    const selectAllCheckbox = headerRow
      .locator('[role="checkbox"], input[type="checkbox"]')
      .first();
    await expect(selectAllCheckbox).toBeVisible({ timeout: 10000 });

    // Click to select all
    await selectAllCheckbox.click();

    // Verify bulk edit button appears (indicates items are selected)
    // Need to wait for the button to become visible after selection state changes
    const bulkEditButton = page
      .locator('[data-testid="bulk-edit-button"]')
      .first();
    await expect(bulkEditButton).toBeVisible({ timeout: 5000 });
  });
});
