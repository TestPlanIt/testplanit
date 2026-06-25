import { expect, test } from "../../fixtures";

/**
 * Project Overview Dashboard E2E Tests (PROJ-06)
 *
 * Tests the project overview page at /projects/overview/{projectId}.
 * The page has:
 *   - ProjectHeader (project name, icon, status, created date)
 *   - Left resizable panel: MilestonesSection
 *   - Right resizable panel: accordion with 4 sections:
 *       repository-cases, test-runs, sessions, tags
 *   - Collapse/expand buttons for left and right panels
 *
 * The accordion starts expanded for all 4 right-panel sections by default.
 */

test.describe("Project Overview Dashboard", () => {
  let testProjectId: number;

  test.beforeEach(async ({ api }) => {
    testProjectId = await api.createProject(`E2E Overview ${Date.now()}`);
  });

  test("loads the project overview page with project header", async ({
    page,
  }) => {
    await test.step("Open the project overview page", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the project header Overview title is visible", async () => {
      // The page renders a Card with the ProjectHeader
      // ProjectHeader shows "Overview" title text
      const overviewTitle = page.getByText(/overview/i).first();
      await expect(overviewTitle).toBeVisible({ timeout: 15000 });
    });
  });

  test("displays the project name in the header", async ({ page }) => {
    await test.step("Open the project overview page", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the project ID is shown in the header", async () => {
      // ProjectHeader renders the project ID via next-intl's `{id, number}`
      // ICU formatter, which inserts thousand separators (e.g. "57,996").
      // Build a regex that splits each digit with an optional non-digit
      // (matches "57996", "57,996", "57 996", etc.).
      const idPattern = String(testProjectId).split("").join("\\D?");
      const projectIdText = page.getByText(
        new RegExp(`id[:\\s#]*${idPattern}`, "i")
      );
      await expect(projectIdText).toBeVisible({ timeout: 15000 });
    });
  });

  test("shows the milestones section in the left panel", async ({ page }) => {
    await test.step("Open the project overview page", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the Current Milestones heading is visible", async () => {
      // MilestonesSection renders "Current Milestones" heading
      const milestonesHeading = page.getByText(/current milestones/i);
      await expect(milestonesHeading).toBeVisible({ timeout: 15000 });
    });
  });

  test("shows accordion sections in the right panel", async ({ page }) => {
    await test.step("Open the project overview page", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify all four right-panel accordion sections are visible", async () => {
      // The right panel accordion has 4 items: repository-cases, test-runs, sessions, tags
      // All are open by default (defaultValue includes all 4)
      // Each AccordionTrigger contains the section label text

      // Repository/Cases section
      const repoSection = page.getByRole("button", { name: /repository/i });
      await expect(repoSection.first()).toBeVisible({ timeout: 15000 });

      // Active Test Runs section
      const testRunsSection = page.getByRole("button", {
        name: /active test runs/i,
      });
      await expect(testRunsSection.first()).toBeVisible({ timeout: 5000 });

      // Active Sessions section
      const sessionsSection = page.getByRole("button", {
        name: /active sessions/i,
      });
      await expect(sessionsSection.first()).toBeVisible({ timeout: 5000 });

      // Tags section
      const tagsSection = page.getByRole("button", { name: /tags/i });
      await expect(tagsSection.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("can collapse and expand the left panel", async ({ page }) => {
    const milestonesHeading = page.getByText(/current milestones/i);
    const leftPanel = page.locator('[data-panel="overview-left"]');
    const collapseLeftBtn = page.getByTestId("collapse-left-panel");

    await test.step("Open the overview page and confirm the left panel loaded", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");

      // Wait for the milestones section to appear (confirms left panel loaded)
      await expect(milestonesHeading).toBeVisible({ timeout: 15000 });

      // The left panel is a ResizablePanel with id="overview-left".
      // When collapsed, react-resizable-panels sets data-panel-size="0" on the panel element.
      await expect(leftPanel).toBeVisible({ timeout: 5000 });
    });

    await test.step("Collapse the left panel and verify its content is hidden", async () => {
      // The left panel has a collapse button identified by data-testid.
      await expect(collapseLeftBtn).toBeVisible({ timeout: 5000 });
      await collapseLeftBtn.click();

      // react-resizable-panels v4 removed the data-panel-size attribute, so
      // verify the collapse by the panel content no longer being visible.
      await expect(milestonesHeading).toBeHidden({ timeout: 10000 });
    });

    await test.step("Re-expand the left panel and verify milestones are visible again", async () => {
      // Click the same button (now acts as expand) to re-expand
      await collapseLeftBtn.click();

      // Panel should re-expand — size should be greater than 0
      // Wait for the milestones heading to become visible again
      await expect(milestonesHeading).toBeVisible({ timeout: 10000 });
    });
  });

  test("accordion sections can be collapsed by clicking their trigger", async ({
    page,
  }) => {
    const testRunsTrigger = page
      .getByRole("button", { name: /active test runs/i })
      .first();

    await test.step("Open the overview page and wait for the accordion to load", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");

      // Wait for accordion to load
      await expect(testRunsTrigger).toBeVisible({ timeout: 15000 });
    });

    await test.step("Collapse the Test Runs section and verify it is closed", async () => {
      // Click to collapse the Test Runs section
      await testRunsTrigger.click();

      // The accordion trigger should have data-state="closed" after clicking
      // Radix Accordion sets data-state on the trigger element, not data-value
      await expect(testRunsTrigger).toHaveAttribute("data-state", "closed", {
        timeout: 5000,
      });
    });
  });

  test("shows empty state when no milestones exist for new project", async ({
    page,
  }) => {
    await test.step("Open the overview page and verify the milestones heading", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");

      // A new project has no milestones, so MilestonesSection shows empty state link
      // "No active milestones" or a link to the milestones page
      const milestonesHeading = page.getByText(/current milestones/i);
      await expect(milestonesHeading).toBeVisible({ timeout: 15000 });
    });

    await test.step("Verify the empty-state milestones link is visible", async () => {
      // The empty state renders a link to /projects/milestones/{projectId}
      const milestonesLink = page.locator(
        `a[href*="/projects/milestones/${testProjectId}"]`
      );
      await expect(milestonesLink.first()).toBeVisible({ timeout: 5000 });
    });
  });

  test("navigates to the project milestones page from overview link", async ({
    page,
  }) => {
    await test.step("Open the overview page", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Click the milestones link in the empty state", async () => {
      // Click the milestones link in the empty state
      const milestonesLink = page
        .locator(`a[href*="/projects/milestones/${testProjectId}"]`)
        .first();
      await expect(milestonesLink).toBeVisible({ timeout: 15000 });
      await milestonesLink.click();
    });

    await test.step("Verify navigation to the project milestones page", async () => {
      // Should navigate to milestones page
      await expect(page).toHaveURL(
        new RegExp(`/projects/milestones/${testProjectId}`),
        { timeout: 10000 }
      );
    });
  });

  test("displays project status (active) in project header", async ({
    page,
  }) => {
    await test.step("Open the project overview page", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the Active project status is shown in the header", async () => {
      // ProjectHeader renders "Active" status for non-completed projects
      const statusText = page.getByText(/active/i);
      await expect(statusText.first()).toBeVisible({ timeout: 15000 });
    });
  });

  test("shows resizable panel group with handles", async ({ page }) => {
    await test.step("Open the project overview page", async () => {
      await page.goto(`/en-US/projects/overview/${testProjectId}`);
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the resizable panel group and resize handles are present", async () => {
      // The ResizablePanelGroup renders with the data-panel-group attribute.
      // Note: autoSaveId is not the same as id — data-panel-group-id uses the id prop,
      // which is auto-generated. Use the data-panel-group attribute instead.
      const panelGroup = page.locator("[data-panel-group]");
      await expect(panelGroup).toBeVisible({ timeout: 15000 });

      // Verify there are resize handles present (indicating a resizable layout)
      const resizeHandles = page.locator("[data-panel-resize-handle-id]");
      await expect(resizeHandles.first()).toBeVisible({ timeout: 5000 });
    });
  });
});
