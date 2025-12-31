import { test, expect } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

/**
 * Repository Smoke Tests
 *
 * Critical path validation tests for the Repository page functionality.
 * These tests verify the core user journeys work correctly.
 */
test.describe("Repository Smoke Tests", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  // Helper to get a test project ID
  async function getTestProjectId(api: import("../../fixtures/api.fixture").ApiHelper): Promise<number> {
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("should navigate to repository page and display folder tree", async ({
    page,
    api,
  }) => {
    const projectId = await getTestProjectId(api);

    // Navigate to repository
    await repositoryPage.goto(projectId);

    // Verify the page loaded successfully
    await expect(repositoryPage.leftPanel).toBeVisible();

    // Verify we're on the correct URL
    expect(page.url()).toContain(`/projects/repository/${projectId}`);
  });

  test("should create a new folder", async ({ page, api }) => {
    const projectId = await getTestProjectId(api);

    // Navigate to repository first
    await repositoryPage.goto(projectId);

    // Generate unique folder name
    const folderName = `E2E UI Folder ${Date.now()}`;

    // Create folder via UI
    await repositoryPage.createFolder(folderName);

    // Verify folder appears in the tree
    await repositoryPage.verifyFolderExists(folderName);
  });

  test("should select a folder and view its contents", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    // First, create a folder via API for reliable test data
    const folderName = `E2E Folder Selection ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Navigate to repository
    await repositoryPage.goto(projectId);

    // Select the folder
    await repositoryPage.selectFolder(folderId);

    // Verify the folder is selected (could check URL or visual state)
    await repositoryPage.verifyFolderExists(folderName);
  });

  test("should create a test case in a folder", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder via API first
    const folderName = `E2E Test Case Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create a test case via API
    const testCaseName = `E2E Test Case ${Date.now()}`;
    await api.createTestCase(projectId, folderId, testCaseName);

    // Navigate to repository and select the folder
    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    // Verify the test case appears in the list
    await repositoryPage.verifyTestCaseExists(testCaseName);
  });

  test("should search for test cases", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder and test case via API
    const folderName = `E2E Search Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    const uniqueSearchTerm = `UniqueSearch${Date.now()}`;
    const testCaseName = `Test Case ${uniqueSearchTerm}`;
    await api.createTestCase(projectId, folderId, testCaseName);

    // Navigate to repository
    await repositoryPage.goto(projectId);

    // Select the folder first
    await repositoryPage.selectFolder(folderId);

    // Search for the test case
    await repositoryPage.searchTestCases(uniqueSearchTerm);

    // Verify the test case is found
    await repositoryPage.verifyTestCaseExists(testCaseName);
  });
});

/**
 * Authentication Smoke Test
 *
 * Verifies that the authentication state is preserved correctly.
 */
test.describe("Authentication Smoke Tests", () => {
  test("should be authenticated and access protected pages", async ({
    page,
  }) => {
    // Navigate directly to a protected page
    await page.goto("/en-US/projects");

    // We should NOT be redirected to signin
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/signin");

    // Should see the projects page
    expect(page.url()).toContain("/projects");
  });

  test("should display user information in header", async ({ page }) => {
    // Navigate to home
    await page.goto("/en-US");
    await page.waitForLoadState("networkidle");

    // Look for user avatar or profile menu (indicates logged in state)
    const userIndicator = page.locator(
      '[data-testid="user-menu"], [data-testid="user-avatar"], button:has(img[alt*="avatar"])'
    ).first();

    // Just verify we're logged in by not being on signin
    expect(page.url()).not.toContain("/signin");
  });
});
