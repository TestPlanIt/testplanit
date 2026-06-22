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
    let projectId: number | undefined;

    await test.step("Create a project and test run with cases in different statuses", async () => {
      projectId = await api.createProject(`SortToggle ${ts}`);
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
      const [rc1, rc2] = await api.addTestCasesToTestRun(testRunId, [
        c1,
        c2,
        c3,
      ]);

      const passedId = await api.getStatusId("passed");
      const failedId = await api.getStatusId("failed");
      await api.setTestRunCaseStatus(rc1, passedId);
      await api.setTestRunCaseStatus(rc2, failedId);
      // rc3 left untested (no status)
    });

    const toggle = page.locator(`[data-testid="sort-toggle"]`).first();

    await test.step("Open the test runs list and locate the sort toggle", async () => {
      await page.goto(`/en-US/projects/runs/${projectId!}?page=1&pageSize=25`);
      await page.waitForLoadState("networkidle");

      // Find the sort toggle for our test run row
      await expect(toggle).toBeVisible();
    });

    await test.step("Confirm initial tooltip shows Group by status", async () => {
      // Hover to confirm initial tooltip says "Group by status"
      await toggle.hover();
      await expect(page.getByText("Group by status").first()).toBeVisible();
    });

    await test.step("Click to switch to Sort by date mode", async () => {
      // Click — switches to "sort by date" mode
      await toggle.click();
      await toggle.hover();
      await expect(page.getByText("Sort by date").first()).toBeVisible();
    });

    await test.step("Click again to return to Group by status mode", async () => {
      // Click again — back to "group by status"
      await toggle.click();
      await toggle.hover();
      await expect(page.getByText("Group by status").first()).toBeVisible();
    });

    await test.step("Verify the status bar still renders segments", async () => {
      // The status bar should still be rendering segments
      await expect(
        page.locator('[data-testid="test-run-cases-status-bar"]').first()
      ).toBeVisible();
    });
  });
});

test.describe("Sort toggle on sessions list page", () => {
  test("toggle switches state and does not break the bar", async ({
    api,
    page,
    request,
  }) => {
    const ts = Date.now();
    let projectId: number | undefined;

    await test.step("Create a session with a result so the summary bar renders", async () => {
      projectId = await api.createProject(`SortToggleSession ${ts}`);
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
    });

    const toggle = page.locator('[data-testid="sort-toggle"]').first();

    await test.step("Open the sessions list and locate the sort toggle", async () => {
      await page.goto(
        `/en-US/projects/sessions/${projectId!}?page=1&pageSize=25`
      );
      await page.waitForLoadState("networkidle");

      await expect(toggle).toBeVisible();
    });

    await test.step("Confirm initial tooltip shows Group by status", async () => {
      await toggle.hover();
      await expect(page.getByText("Group by status").first()).toBeVisible();
    });

    await test.step("Click to switch to Sort by date mode", async () => {
      await toggle.click();
      await toggle.hover();
      await expect(page.getByText("Sort by date").first()).toBeVisible();
    });
  });
});
