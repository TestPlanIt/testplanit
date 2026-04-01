import { expect, test } from "../../fixtures";

/**
 * Tag Detail Page Filters
 *
 * Tests for the filter controls on the tag detail page:
 * - Case type filter (All / Manual / Automated)
 * - Hide completed Sessions toggle
 * - Hide completed Test Runs toggle
 * - Clear all filters
 * - Filter persistence via localStorage
 */
test.describe("Tag Detail Page Filters", () => {
  let projectId: number;
  let folderId: number;
  let tagId: number;
  let manualCaseId: number;
  let automatedCaseId: number;

  test.beforeEach(async ({ api }) => {
    // Create a project with test data
    projectId = await api.createProject(
      `Tag Filter Test ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    const folders = await api.getFolders(projectId);
    folderId = folders[0].id;

    // Create a tag
    tagId = await api.createTag(`filter-test-${Date.now()}`);

    // Create manual and automated test cases
    manualCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Manual Case ${Date.now()}`
    );
    automatedCaseId = await api.createTestCase(
      projectId,
      folderId,
      `Automated Case ${Date.now()}`
    );

    // Mark one case as automated
    await api.addTagToTestCase(manualCaseId, tagId);
    await api.addTagToTestCase(automatedCaseId, tagId);

    // Create sessions: one active, one completed
    const activeSessionId = await api.createSession(
      projectId,
      `Active Session ${Date.now()}`,
      { isCompleted: false }
    );
    const completedSessionId = await api.createSession(
      projectId,
      `Completed Session ${Date.now()}`,
      { isCompleted: true }
    );
    await api.addTagToSession(activeSessionId, tagId);
    await api.addTagToSession(completedSessionId, tagId);

    // Create test runs: one active, one completed
    const activeRunId = await api.createTestRun(
      projectId,
      `Active Run ${Date.now()}`
    );
    const completedRunId = await api.createTestRun(
      projectId,
      `Completed Run ${Date.now()}`
    );

    // Mark one run as completed
    await api.updateTestRun(completedRunId, { isCompleted: true });

    await api.addTagToTestRun(activeRunId, tagId);
    await api.addTagToTestRun(completedRunId, tagId);
  });

  test("should display filter bar with all controls", async ({ page }) => {
    await page.goto(
      `/en-US/projects/tags/${projectId}/${tagId}`
    );
    await page.waitForLoadState("load");

    // Filter bar should be visible
    await expect(
      page.getByTestId("case-type-filter-select")
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByTestId("hide-completed-sessions-switch")
    ).toBeVisible();
    await expect(
      page.getByTestId("hide-completed-runs-switch")
    ).toBeVisible();
  });

  test("should filter test cases by type", async ({ page }) => {
    // Mark the automated case
    const response = await page.request.patch(
      `/api/model/repositoryCases/update`,
      {
        data: {
          where: { id: automatedCaseId },
          data: { automated: true },
        },
      }
    );
    expect(response.ok()).toBeTruthy();

    await page.goto(
      `/en-US/projects/tags/${projectId}/${tagId}`
    );
    await page.waitForLoadState("load");

    // Should show both cases by default (tab count = 2)
    const casesTab = page.getByRole("tab", { name: /Test Cases/ });
    await expect(casesTab).toBeVisible({ timeout: 10000 });
    await expect(casesTab).toContainText("(2)");

    // Filter to Manual only
    await page.getByTestId("case-type-filter-select").click();
    await page.getByRole("option", { name: "Manual" }).click();

    // Count should update to 1
    await expect(casesTab).toContainText("(1)");

    // Filter to Automated only
    await page.getByTestId("case-type-filter-select").click();
    await page.getByRole("option", { name: "Automated" }).click();

    await expect(casesTab).toContainText("(1)");

    // Back to All
    await page.getByTestId("case-type-filter-select").click();
    await page.getByRole("option", { name: "All" }).click();

    await expect(casesTab).toContainText("(2)");
  });

  test("should hide completed sessions", async ({ page }) => {
    await page.goto(
      `/en-US/projects/tags/${projectId}/${tagId}`
    );
    await page.waitForLoadState("load");

    // Click sessions tab
    const sessionsTab = page.getByRole("tab", { name: /Sessions/ });
    await expect(sessionsTab).toBeVisible({ timeout: 10000 });
    await expect(sessionsTab).toContainText("(2)");

    // Toggle hide completed sessions
    await page.getByTestId("hide-completed-sessions-switch").click();

    // Count should drop to 1
    await expect(sessionsTab).toContainText("(1)");

    // Toggle back
    await page.getByTestId("hide-completed-sessions-switch").click();
    await expect(sessionsTab).toContainText("(2)");
  });

  test("should hide completed test runs", async ({ page }) => {
    await page.goto(
      `/en-US/projects/tags/${projectId}/${tagId}`
    );
    await page.waitForLoadState("load");

    // Check test runs tab
    const runsTab = page.getByRole("tab", { name: /Test Runs/ });
    await expect(runsTab).toBeVisible({ timeout: 10000 });
    await expect(runsTab).toContainText("(2)");

    // Toggle hide completed runs
    await page.getByTestId("hide-completed-runs-switch").click();

    // Count should drop to 1
    await expect(runsTab).toContainText("(1)");

    // Toggle back
    await page.getByTestId("hide-completed-runs-switch").click();
    await expect(runsTab).toContainText("(2)");
  });

  test("should show active filter count and allow clearing", async ({
    page,
  }) => {
    await page.goto(
      `/en-US/projects/tags/${projectId}/${tagId}`
    );
    await page.waitForLoadState("load");

    // No clear button initially
    await expect(
      page.getByTestId("clear-all-filters")
    ).not.toBeVisible({ timeout: 10000 });

    // Enable a filter
    await page.getByTestId("hide-completed-sessions-switch").click();

    // Badge with count should appear
    const clearButton = page.getByTestId("clear-all-filters");
    await expect(clearButton).toBeVisible();
    await expect(clearButton).toContainText("1");

    // Enable another filter
    await page.getByTestId("hide-completed-runs-switch").click();
    await expect(clearButton).toContainText("2");

    // Clear all filters
    await clearButton.click();

    // Filters should be reset
    await expect(
      page.getByTestId("clear-all-filters")
    ).not.toBeVisible();

    // Counts should be back to full
    const sessionsTab = page.getByRole("tab", { name: /Sessions/ });
    await expect(sessionsTab).toContainText("(2)");
    const runsTab = page.getByRole("tab", { name: /Test Runs/ });
    await expect(runsTab).toContainText("(2)");
  });

  test("should show empty state when all items filtered out", async ({
    page,
    api,
  }) => {
    // Create a tag with only completed sessions
    const emptyTagId = await api.createTag(`empty-filter-${Date.now()}`);
    const completedSessionId = await api.createSession(
      projectId,
      `Only Completed ${Date.now()}`,
      { isCompleted: true }
    );
    await api.addTagToSession(completedSessionId, emptyTagId);

    await page.goto(
      `/en-US/projects/tags/${projectId}/${emptyTagId}`
    );
    await page.waitForLoadState("load");

    // Click sessions tab
    const sessionsTab = page.getByRole("tab", { name: /Sessions/ });
    await expect(sessionsTab).toBeVisible({ timeout: 10000 });
    await sessionsTab.click();

    // Toggle hide completed sessions
    await page.getByTestId("hide-completed-sessions-switch").click();

    // Should show filtered empty state
    await expect(
      page.getByText("No items match the current filters")
    ).toBeVisible();
  });
});
