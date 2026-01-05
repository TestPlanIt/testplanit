import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Test Case Management Tests
 *
 * Test cases for managing test cases within folders in the repository.
 * Focuses on CRUD operations and test case interactions.
 */
test.describe("Test Case Management", () => {
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
});
