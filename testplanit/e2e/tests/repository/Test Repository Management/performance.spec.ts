import { expect, test } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * Performance Tests
 *
 * Test cases for performance benchmarks in the repository.
 */
test.describe("Performance", () => {
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

  test("Repository Loading Performance", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    let loadTime: number | undefined;

    await test.step("Load the repository and measure elapsed time", async () => {
      // Measure time to load repository
      const startTime = Date.now();

      await repositoryPage.goto(projectId);
      await repositoryPage.waitForRepositoryLoad();

      loadTime = Date.now() - startTime;
    });

    await test.step("Verify the repository loads within 5 seconds", async () => {
      // Repository should load within reasonable time (5 seconds)
      // Note: In CI environments, load times can vary due to resource contention
      expect(loadTime!).toBeLessThan(5000);
    });
  });
});
