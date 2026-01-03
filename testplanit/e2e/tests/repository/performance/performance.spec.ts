import { test, expect } from "../../../fixtures";
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
    const projects = await api.getProjects();
    if (projects.length === 0) {
      throw new Error("No projects found in test database. Run seed first.");
    }
    return projects[0].id;
  }

  test("Repository Loading Performance", async ({ api }) => {
    const projectId = await getTestProjectId(api);

    // Measure time to load repository
    const startTime = Date.now();

    await repositoryPage.goto(projectId);
    await repositoryPage.waitForRepositoryLoad();

    const loadTime = Date.now() - startTime;

    // Repository should load within reasonable time (2 seconds)
    expect(loadTime).toBeLessThan(2000);
  });
});
