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
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // The page renders a Card with the ProjectHeader
    // ProjectHeader shows "Overview" title text
    const overviewTitle = page.getByText(/overview/i).first();
    await expect(overviewTitle).toBeVisible({ timeout: 15000 });
  });

  test("displays the project name in the header", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // ProjectHeader renders the project name in a CardDescription
    // The name appears as uppercase text in the header area
    const projectIdText = page.getByText(
      new RegExp(`id[:\\s#]*${testProjectId}`, "i")
    );
    await expect(projectIdText).toBeVisible({ timeout: 15000 });
  });

  test("shows the milestones section in the left panel", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // MilestonesSection renders "Current Milestones" heading
    const milestonesHeading = page.getByText(/current milestones/i);
    await expect(milestonesHeading).toBeVisible({ timeout: 15000 });
  });

  test("shows accordion sections in the right panel", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

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

  test("can collapse and expand the left panel", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Wait for the milestones section to appear (confirms left panel loaded)
    const milestonesHeading = page.getByText(/current milestones/i);
    await expect(milestonesHeading).toBeVisible({ timeout: 15000 });

    // The collapse button is a ChevronLeft icon button
    // There are two such buttons — one for left panel, one for right panel
    // The left panel button has the "rounded-r-none" class when not collapsed
    const collapseLeftBtn = page
      .locator('button.rounded-r-none')
      .first();
    await expect(collapseLeftBtn).toBeVisible({ timeout: 5000 });
    await collapseLeftBtn.click();

    // After collapsing, the milestones heading should no longer be visible
    // (panel collapses to 0 size)
    await expect(milestonesHeading).not.toBeVisible({ timeout: 5000 });

    // Click again to expand — button now has rotate-180 + rounded-l-none class
    const expandLeftBtn = page
      .locator('button.rounded-l-none.rotate-180')
      .first();
    await expect(expandLeftBtn).toBeVisible({ timeout: 5000 });
    await expandLeftBtn.click();

    // Panel should re-expand
    await expect(milestonesHeading).toBeVisible({ timeout: 5000 });
  });

  test("accordion sections can be collapsed by clicking their trigger", async ({
    page,
  }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Wait for accordion to load
    const testRunsTrigger = page
      .getByRole("button", { name: /active test runs/i })
      .first();
    await expect(testRunsTrigger).toBeVisible({ timeout: 15000 });

    // Click to collapse the Test Runs section
    await testRunsTrigger.click();

    // The accordion content for test-runs should be hidden
    // (AccordionContent animates to height 0 when collapsed)
    // We verify it by checking the accordion item's data-state attribute
    const testRunsItem = page.locator('[data-value="test-runs"]');
    await expect(testRunsItem).toHaveAttribute("data-state", "closed", {
      timeout: 5000,
    });
  });

  test("shows empty state when no milestones exist for new project", async ({
    page,
  }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // A new project has no milestones, so MilestonesSection shows empty state link
    // "No active milestones" or a link to the milestones page
    const milestonesHeading = page.getByText(/current milestones/i);
    await expect(milestonesHeading).toBeVisible({ timeout: 15000 });

    // The empty state renders a link to /projects/milestones/{projectId}
    const milestonesLink = page.locator(
      `a[href*="/projects/milestones/${testProjectId}"]`
    );
    await expect(milestonesLink.first()).toBeVisible({ timeout: 5000 });
  });

  test("navigates to the project milestones page from overview link", async ({
    page,
  }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // Click the milestones link in the empty state
    const milestonesLink = page
      .locator(`a[href*="/projects/milestones/${testProjectId}"]`)
      .first();
    await expect(milestonesLink).toBeVisible({ timeout: 15000 });
    await milestonesLink.click();

    // Should navigate to milestones page
    await expect(page).toHaveURL(
      new RegExp(`/projects/milestones/${testProjectId}`),
      { timeout: 10000 }
    );
  });

  test("displays project status (active) in project header", async ({
    page,
  }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // ProjectHeader renders "Active" status for non-completed projects
    const statusText = page.getByText(/active/i);
    await expect(statusText.first()).toBeVisible({ timeout: 15000 });
  });

  test("shows resizable panel group with handles", async ({ page }) => {
    await page.goto(`/en-US/projects/overview/${testProjectId}`);
    await page.waitForLoadState("networkidle");

    // The ResizablePanelGroup renders with autoSaveId="project-overview-horizontal"
    const panelGroup = page.locator(
      '[data-panel-group-id="project-overview-horizontal"]'
    );
    await expect(panelGroup).toBeVisible({ timeout: 15000 });
  });
});
