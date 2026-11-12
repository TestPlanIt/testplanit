import { expect, test } from "../../fixtures";

/**
 * Reports tab switching regression.
 *
 * Guards the "clicking Reports bounces back to Report Builder" bug: after
 * building + running a custom report, the report-type Select briefly emits an
 * empty onValueChange during the tab transition, which used to be coerced to a
 * fallback report type and reverted the tab (and reportType + URL) back to the
 * builder. The fix keeps the user on the Reports tab.
 */
test.describe("Reports - tab switching", () => {
  test("running a custom report then clicking Reports stays on Reports @smoke", async ({
    api,
    page,
  }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(
      `E2E Report Tab Switch ${uniqueId}`
    );
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(
      projectId,
      rootFolderId,
      `Tab Switch TC ${uniqueId}`
    );

    await test.step("Build and run a custom (test-execution) report", async () => {
      await page.goto(
        `/en-US/projects/reports/${projectId}?tab=builder&reportType=test-execution&dimensions=status&metrics=testCaseCount`
      );
      await page.waitForLoadState("networkidle");

      const runButton = page.locator('[data-testid="run-report-button"]');
      await expect(runButton).toBeEnabled({ timeout: 10_000 });
      await runButton.click();
      await page.waitForLoadState("networkidle");

      // Sanity: we are on the Report Builder tab with the custom report.
      await expect(
        page.locator('[data-testid="report-builder-tab"]')
      ).toHaveAttribute("data-state", "active");
      await expect(page).toHaveURL(/tab=builder/);
    });

    await test.step("Click Reports and verify it stays on the Reports tab", async () => {
      await page.locator('[data-testid="reports-tab"]').click();

      // The regression: previously the tab bounced straight back to builder.
      // toHaveAttribute polls, so it tolerates a brief transition but fails if
      // the tab ends up reverted to the builder.
      await expect(page.locator('[data-testid="reports-tab"]')).toHaveAttribute(
        "data-state",
        "active"
      );
      await expect(
        page.locator('[data-testid="report-builder-tab"]')
      ).toHaveAttribute("data-state", "inactive");
      await expect(page).toHaveURL(/tab=reports/);
      // A pre-built report selector is shown (not the previous custom report).
      await expect(page).not.toHaveURL(/reportType=test-execution/);
      await expect(
        page.locator('[data-testid="report-type-select"]').first()
      ).toBeVisible();
    });
  });

  test("a run that finishes right after a tab click does not pull the user back", async ({
    api,
    page,
  }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(
      `E2E Report Tab Race ${uniqueId}`
    );
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(
      projectId,
      rootFolderId,
      `Tab Race TC ${uniqueId}`
    );

    await page.goto(
      `/en-US/projects/reports/${projectId}?tab=builder&reportType=test-execution&dimensions=status&metrics=testCaseCount`
    );
    await page.waitForLoadState("networkidle");
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeEnabled({ timeout: 10_000 });

    // Hold the report response until the tab click has been made, and slow
    // the tab navigation down so the address bar is still on the builder tab
    // when the run finishes.
    let releaseRun!: () => void;
    const runHeld = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    await page.route("**/api/report-builder/test-execution", async (route) => {
      await runHeld;
      await route.continue();
    });
    await page.route(
      (url) => url.searchParams.has("_rsc"),
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.continue();
      }
    );

    await runButton.click();
    await page.locator('[data-testid="reports-tab"]').click();
    await expect(page.locator('[data-testid="reports-tab"]')).toHaveAttribute(
      "data-state",
      "active"
    );
    releaseRun();

    await expect(page).toHaveURL(/tab=reports/);
    await expect(page).not.toHaveURL(/reportType=test-execution/);
    await expect(page.locator('[data-testid="reports-tab"]')).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("a run that finishes after a tab click leaves the new report's results alone", async ({
    api,
    page,
  }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(
      `E2E Report Tab Stale ${uniqueId}`
    );
    const rootFolderId = await api.getRootFolderId(projectId);
    await api.createTestCase(
      projectId,
      rootFolderId,
      `Tab Stale TC ${uniqueId}`
    );

    await page.goto(
      `/en-US/projects/reports/${projectId}?tab=builder&reportType=test-execution&dimensions=status&metrics=testCaseCount`
    );
    await page.waitForLoadState("networkidle");
    const runButton = page.locator('[data-testid="run-report-button"]');
    await expect(runButton).toBeEnabled({ timeout: 10_000 });

    let releaseRun!: () => void;
    const runHeld = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    await page.route("**/api/report-builder/test-execution", async (route) => {
      await runHeld;
      await route.continue();
    });

    await runButton.click();
    await page.locator('[data-testid="reports-tab"]').click();

    // The pre-built report the tab opens on has loaded its own results.
    const trendColumn = page.getByRole("columnheader", {
      name: /Automated Cases/,
    });
    await expect(trendColumn).toBeVisible();

    const staleResponse = page.waitForResponse(
      "**/api/report-builder/test-execution"
    );
    releaseRun();
    await (await staleResponse).finished();
    // Give the page a moment to act on the late response, if it is going to.
    await page.waitForTimeout(1_000);

    await expect(trendColumn).toBeVisible();
    await expect(page.getByText("No results found.")).toBeHidden();
  });

  test("Reports <-> Report Builder round-trip is stable", async ({
    api,
    page,
  }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const projectId = await api.createProject(
      `E2E Report Tab Roundtrip ${uniqueId}`
    );

    await page.goto(`/en-US/projects/reports/${projectId}`);
    await page.waitForLoadState("networkidle");

    // The page opens on the Reports tab by default.
    await expect(page.locator('[data-testid="reports-tab"]')).toHaveAttribute(
      "data-state",
      "active"
    );

    await test.step("Switch to Report Builder", async () => {
      await page.locator('[data-testid="report-builder-tab"]').click();
      await expect(
        page.locator('[data-testid="report-builder-tab"]')
      ).toHaveAttribute("data-state", "active");
      await expect(page).toHaveURL(/tab=builder/);
    });

    await test.step("Switch back to Reports", async () => {
      await page.locator('[data-testid="reports-tab"]').click();
      await expect(page.locator('[data-testid="reports-tab"]')).toHaveAttribute(
        "data-state",
        "active"
      );
      await expect(page).toHaveURL(/tab=reports/);
    });
  });
});
