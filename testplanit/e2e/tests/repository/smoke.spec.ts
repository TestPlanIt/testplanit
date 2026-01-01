import { test, expect } from "../../fixtures";
import { RepositoryPage } from "../../page-objects/repository/repository.page";

/**
 * Repository Smoke Tests
 *
 * Critical path validation tests for the Repository page functionality.
 * These tests verify the core user journeys work correctly.
 *
 * Run with: pnpm test:e2e --grep @smoke
 */
test.describe("Repository Smoke Tests @smoke", () => {
  let repositoryPage: RepositoryPage;

  test.beforeEach(async ({ page }) => {
    repositoryPage = new RepositoryPage(page);
  });

  async function getTestProjectId(
    api: import("../../fixtures/api.fixture").ApiHelper
  ): Promise<number> {
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("navigate to repository page and display folder tree @smoke", async ({
    page,
    api,
  }) => {
    const projectId = await getTestProjectId(api);

    await repositoryPage.goto(projectId);

    await expect(repositoryPage.leftPanel).toBeVisible();
    expect(page.url()).toContain(`/projects/repository/${projectId}`);
  });

  test("create a new folder @smoke", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    await repositoryPage.goto(projectId);

    const folderName = `E2E Smoke Folder ${Date.now()}`;
    await repositoryPage.createFolder(folderName);

    await repositoryPage.verifyFolderExists(folderName);
  });

  test("select a folder and view its contents @smoke", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `E2E Smoke Selection ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    await repositoryPage.verifyFolderExists(folderName);
  });

  test("create a test case in a folder @smoke", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `E2E Smoke TC Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    const testCaseName = `E2E Smoke Test Case ${Date.now()}`;
    await api.createTestCase(projectId, folderId, testCaseName);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);

    await repositoryPage.verifyTestCaseExists(testCaseName);
  });

  test("search for test cases @smoke", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `E2E Smoke Search ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    const uniqueSearchTerm = `SmokeSearch${Date.now()}`;
    const testCaseName = `Test Case ${uniqueSearchTerm}`;
    await api.createTestCase(projectId, folderId, testCaseName);

    await repositoryPage.goto(projectId);
    await repositoryPage.selectFolder(folderId);
    await repositoryPage.searchTestCases(uniqueSearchTerm);

    await repositoryPage.verifyTestCaseExists(testCaseName);
  });
});

/**
 * Authentication Smoke Tests
 */
test.describe("Authentication Smoke Tests @smoke", () => {
  test("authenticated and access protected pages @smoke", async ({ page }) => {
    await page.goto("/en-US/projects");

    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/signin");
    expect(page.url()).toContain("/projects");
  });

  test("display user information in header @smoke", async ({ page }) => {
    await page.goto("/en-US");
    await page.waitForLoadState("networkidle");

    expect(page.url()).not.toContain("/signin");
  });
});
