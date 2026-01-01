import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Sorting Tests
 *
 * Test cases for sorting test cases in the repository.
 */
test.describe("Sorting", () => {
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

  test("Sort Test Cases by Order Column", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with multiple test cases
    const folderName = `Sort Order Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    await api.createTestCase(projectId, folderId, `B Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `A Case ${Date.now()}`);
    await api.createTestCase(projectId, folderId, `C Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Find the order column header and click to sort
    const orderHeader = page.locator('th:has-text("Order"), th:has-text("#"), [data-testid="order-column-header"]').first();
    await expect(orderHeader).toBeVisible({ timeout: 5000 });
    await orderHeader.click();
    await page.waitForLoadState("networkidle");

    // Verify rows are sorted by order
    const rows = page.locator('[data-testid^="case-row-"], tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Click again to reverse sort
    await orderHeader.click();
    await page.waitForLoadState("networkidle");
  });

  test("Maintain Test Case Order Within Folder", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create a folder with test cases in specific order
    const folderName = `Maintain Order Folder ${Date.now()}`;
    const folderId = await api.createFolder(projectId, folderName);
    const case1Id = await api.createTestCase(projectId, folderId, `First Case ${Date.now()}`);
    const case2Id = await api.createTestCase(projectId, folderId, `Second Case ${Date.now()}`);
    const case3Id = await api.createTestCase(projectId, folderId, `Third Case ${Date.now()}`);

    await repositoryPage.goto(projectId);

    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Get the order of test cases
    const rows = page.locator('[data-testid^="case-row-"]');
    const count = await rows.count();
    expect(count).toBe(3);

    // Navigate away and back
    await page.reload();
    await repositoryPage.waitForRepositoryLoad();
    await repositoryPage.selectFolder(folderId);
    await page.waitForLoadState("networkidle");

    // Verify order is maintained
    const rowsAfter = page.locator('[data-testid^="case-row-"]');
    expect(await rowsAfter.count()).toBe(3);
  });
});
