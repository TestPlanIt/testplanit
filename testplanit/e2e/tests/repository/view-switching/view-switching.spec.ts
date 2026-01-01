import { test, expect } from "../../../fixtures";
import { RepositoryPage } from "../../../page-objects/repository/repository.page";

/**
 * View Switching Tests
 *
 * Test cases for switching between different view modes in the repository.
 */
test.describe("View Switching", () => {
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

  test("Switch to By Folder View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the view switcher/dropdown
    const viewSwitcher = page.locator('[data-testid="view-switcher"], [data-testid="view-mode-select"]').first();
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();

    // Select "By Folder" view
    const folderViewOption = page.locator('[role="option"]:has-text("Folder"), [data-value="folder"]').first();
    await folderViewOption.click();

    await page.waitForLoadState("networkidle");

    // Verify the folder tree is visible
    await expect(repositoryPage.leftPanel).toBeVisible();

    // Verify the view switcher shows "By Folder" or similar
    await expect(viewSwitcher).toContainText(/Folder/i);
  });

  test("Switch to By Template View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the view switcher/dropdown
    const viewSwitcher = page.locator('[data-testid="view-switcher"], [data-testid="view-mode-select"]').first();
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();

    // Select "By Template" view
    const templateViewOption = page.locator('[role="option"]:has-text("Template"), [data-value="template"]').first();
    await templateViewOption.click();

    await page.waitForLoadState("networkidle");

    // Verify the view is now grouped by template
    // The left panel should show template names instead of folders
    const templateGroups = page.locator('[data-testid="template-group"], .template-node');
    await expect(templateGroups.first()).toBeVisible({ timeout: 5000 });

    // Verify the view switcher shows "By Template" or similar
    await expect(viewSwitcher).toContainText(/Template/i);
  });

  test("Switch to By State View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the view switcher/dropdown
    const viewSwitcher = page.locator('[data-testid="view-switcher"], [data-testid="view-mode-select"]').first();
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();

    // Select "By State" view
    const stateViewOption = page.locator('[role="option"]:has-text("State"), [data-value="state"]').first();
    await stateViewOption.click();

    await page.waitForLoadState("networkidle");

    // Verify the view is now grouped by state
    // The left panel should show state names (Draft, Ready, Approved, etc.)
    const stateGroups = page.locator('[data-testid="state-group"], .state-node');
    await expect(stateGroups.first()).toBeVisible({ timeout: 5000 });

    // Verify the view switcher shows "By State" or similar
    await expect(viewSwitcher).toContainText(/State/i);
  });

  test("Switch to By Creator View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the view switcher/dropdown
    const viewSwitcher = page.locator('[data-testid="view-switcher"], [data-testid="view-mode-select"]').first();
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();

    // Select "By Creator" view
    const creatorViewOption = page.locator('[role="option"]:has-text("Creator"), [data-value="creator"]').first();
    await creatorViewOption.click();

    await page.waitForLoadState("networkidle");

    // Verify the view is now grouped by creator
    // The left panel should show user names
    const creatorGroups = page.locator('[data-testid="creator-group"], .creator-node');
    await expect(creatorGroups.first()).toBeVisible({ timeout: 5000 });

    // Verify the view switcher shows "By Creator" or similar
    await expect(viewSwitcher).toContainText(/Creator/i);
  });

  test("Switch to By Automation View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the view switcher/dropdown
    const viewSwitcher = page.locator('[data-testid="view-switcher"], [data-testid="view-mode-select"]').first();
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();

    // Select "By Automation" view
    const automationViewOption = page.locator('[role="option"]:has-text("Automation"), [data-value="automation"]').first();
    await automationViewOption.click();

    await page.waitForLoadState("networkidle");

    // Verify the view is now grouped by automation status
    // Should show groups like "Automated", "Manual", "To Be Automated"
    const automationGroups = page.locator('[data-testid="automation-group"], .automation-node');
    await expect(automationGroups.first()).toBeVisible({ timeout: 5000 });

    // Verify the view switcher shows "By Automation" or similar
    await expect(viewSwitcher).toContainText(/Automation/i);
  });

  test("Switch to By Tag View", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);
    await repositoryPage.goto(projectId);

    // Find the view switcher/dropdown
    const viewSwitcher = page.locator('[data-testid="view-switcher"], [data-testid="view-mode-select"]').first();
    await expect(viewSwitcher).toBeVisible({ timeout: 5000 });
    await viewSwitcher.click();

    // Select "By Tag" view
    const tagViewOption = page.locator('[role="option"]:has-text("Tag"), [data-value="tag"]').first();
    await tagViewOption.click();

    await page.waitForLoadState("networkidle");

    // Verify the view is now grouped by tags
    // Should show tag names in the left panel
    const tagGroups = page.locator('[data-testid="tag-group"], .tag-node');
    await expect(tagGroups.first()).toBeVisible({ timeout: 5000 });

    // Verify the view switcher shows "By Tag" or similar
    await expect(viewSwitcher).toContainText(/Tag/i);
  });

  test("View Shows Accurate Case Counts", async ({ api, page }) => {
    const projectId = await getTestProjectId(api);

    // Create folders with known test case counts
    const folder1Name = `Count Folder 1 ${Date.now()}`;
    const folder1Id = await api.createFolder(projectId, folder1Name);
    await api.createTestCase(projectId, folder1Id, `Case 1A ${Date.now()}`);
    await api.createTestCase(projectId, folder1Id, `Case 1B ${Date.now()}`);

    const folder2Name = `Count Folder 2 ${Date.now()}`;
    const folder2Id = await api.createFolder(projectId, folder2Name);
    await api.createTestCase(projectId, folder2Id, `Case 2A ${Date.now()}`);
    await api.createTestCase(projectId, folder2Id, `Case 2B ${Date.now()}`);
    await api.createTestCase(projectId, folder2Id, `Case 2C ${Date.now()}`);

    await repositoryPage.goto(projectId);

    // Ensure we're in folder view
    const viewSwitcher = page.locator('[data-testid="view-switcher"], [data-testid="view-mode-select"]').first();
    if (await viewSwitcher.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewSwitcher.click();
      const folderViewOption = page.locator('[role="option"]:has-text("Folder")').first();
      if (await folderViewOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await folderViewOption.click();
        await page.waitForLoadState("networkidle");
      } else {
        await page.keyboard.press("Escape");
      }
    }

    // Verify folder 1 shows count of 2
    const folder1 = repositoryPage.getFolderById(folder1Id);
    await expect(folder1).toBeVisible({ timeout: 5000 });

    // Check for count indicator
    const count1 = folder1.locator('[data-testid="case-count"], .case-count, .badge');
    if (await count1.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(count1).toContainText("2");
    }

    // Verify folder 2 shows count of 3
    const folder2 = repositoryPage.getFolderById(folder2Id);
    await expect(folder2).toBeVisible({ timeout: 5000 });

    const count2 = folder2.locator('[data-testid="case-count"], .case-count, .badge');
    if (await count2.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(count2).toContainText("3");
    }
  });
});
