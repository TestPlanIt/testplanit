import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Pagination Tests
 *
 * Test cases for pagination functionality in the repository.
 */
test.describe("Pagination", () => {
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

  test("Navigate Pages", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with many test cases (if needed for pagination)
    const folderName = `Pagination Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create enough test cases to trigger pagination
    for (let i = 0; i < 30; i++) {
      await api.createTestCase(projectId, folderId, `Pagination Case ${i} ${Date.now()}`);
    }

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Look for pagination controls
    const pagination = page.locator('[data-testid="pagination"], .pagination, [aria-label="Pagination"]');
    await expect(pagination).toBeVisible({ timeout: 5000 });

    // Navigate to next page
    const nextButton = pagination.locator('button:has-text("Next"), [aria-label="Next page"]').first();
    await expect(nextButton).toBeEnabled();
    await nextButton.click();
    await page.waitForLoadState("networkidle");

    // Verify page changed
    const pageIndicator = pagination.locator('text=/Page 2|2 of/');
    await expect(pageIndicator).toBeVisible({ timeout: 3000 });
  });

  test("Change Page Size", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    const folderName = `Page Size Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);

    // Create test cases
    for (let i = 0; i < 25; i++) {
      await api.createTestCase(projectId, folderId, `Size Case ${i} ${Date.now()}`);
    }

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Look for page size selector
    const pageSizeSelect = page.locator('[data-testid="page-size-select"], select[aria-label*="page size"]');
    await expect(pageSizeSelect).toBeVisible({ timeout: 5000 });
    await pageSizeSelect.selectOption("50");
    await page.waitForLoadState("networkidle");

    // Verify more items are shown
    const rows = page.locator('[data-testid^="case-row-"]');
    expect(await rows.count()).toBeGreaterThan(20);
  });
});
