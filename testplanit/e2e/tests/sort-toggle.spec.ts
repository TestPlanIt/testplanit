import { expect, test } from "../fixtures";

/**
 * Sort toggle UI tests
 *
 * Verifies the ArrowUpDown toggle on summary bars switches between
 * "Group by status" and "Sort by date" modes on the key pages where
 * regressions were previously found.
 */

test.describe("Sort toggle on test runs list page", () => {
  test("toggle switches state and does not break the bar", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`SortToggle ${ts}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create 3 cases with different statuses to populate the bar
    const [c1, c2, c3] = await Promise.all([
      api.createTestCase(projectId, folderId, `Toggle Case 1 ${ts}`),
      api.createTestCase(projectId, folderId, `Toggle Case 2 ${ts}`),
      api.createTestCase(projectId, folderId, `Toggle Case 3 ${ts}`),
    ]);
    const testRunId = await api.createTestRun(
      projectId,
      `Sort Toggle Run ${ts}`
    );
    const [rc1, rc2] = await api.addTestCasesToTestRun(testRunId, [c1, c2, c3]);

    const passedId = await api.getStatusId("passed");
    const failedId = await api.getStatusId("failed");
    await api.setTestRunCaseStatus(rc1, passedId);
    await api.setTestRunCaseStatus(rc2, failedId);
    // rc3 left untested (no status)

    await page.goto(`/en-US/projects/runs/${projectId}?page=1&pageSize=25`);
    await page.waitForLoadState("networkidle");

    // Find the sort toggle for our test run row
    const toggle = page.locator(`[data-testid="sort-toggle"]`).first();
    await expect(toggle).toBeVisible();

    // Hover to confirm initial tooltip says "Group by status"
    await toggle.hover();
    await expect(page.getByText("Group by status").first()).toBeVisible();

    // Click — switches to "sort by date" mode
    await toggle.click();
    await toggle.hover();
    await expect(page.getByText("Sort by date").first()).toBeVisible();

    // Click again — back to "group by status"
    await toggle.click();
    await toggle.hover();
    await expect(page.getByText("Group by status").first()).toBeVisible();

    // The status bar should still be rendering segments
    await expect(
      page.locator('[data-testid="test-run-cases-status-bar"]').first()
    ).toBeVisible();
  });
});

test.describe("Sort toggle on sessions list page", () => {
  test("toggle switches state and does not break the bar", async ({
    api,
    page,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`SortToggleSession ${ts}`);
    const sessionId = await api.createSession(
      projectId,
      `Sort Toggle Session ${ts}`
    );

    // Add a result so the summary bar renders
    const passedId = await api.getStatusId("passed");
    await request.post(`/api/model/sessionResults/create`, {
      data: {
        data: {
          session: { connect: { id: sessionId } },
          status: { connect: { id: passedId } },
          createdBy: { connect: { id: await api.getCurrentUserId() } },
        },
      },
    });

    await page.goto(`/en-US/projects/sessions/${projectId}?page=1&pageSize=25`);
    await page.waitForLoadState("networkidle");

    const toggle = page.locator('[data-testid="sort-toggle"]').first();
    await expect(toggle).toBeVisible();

    await toggle.hover();
    await expect(page.getByText("Group by status").first()).toBeVisible();

    await toggle.click();
    await toggle.hover();
    await expect(page.getByText("Sort by date").first()).toBeVisible();
  });
});
