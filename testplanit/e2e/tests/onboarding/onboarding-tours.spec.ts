import { expect, test } from "../../fixtures";

/**
 * Onboarding tours (NextStepOnboarding).
 *
 * The tour overlay portals to <body> and targets elements by selector, so it
 * works no matter where NextStepOnboarding sits in the layout tree. These
 * tests pin the behaviors that manual testing had been covering:
 *
 * - launching each tour from the help menu
 * - step navigation (Next / Previous / progress counter / Finish)
 * - the card being positioned near its spotlighted target (a layout
 *   restructure that breaks spotlight math shows up as the card rendering
 *   far from — typically fully below or beside — its target)
 * - the project tour's URL sync (?tour=&step=) and reload restoration
 *
 * The seeded admin user has the initial-preferences setup completed, so no
 * tour auto-starts; every tour here is launched explicitly.
 */

const card = (page: import("@playwright/test").Page) =>
  page.getByTestId("tour-card");
const cardTitle = (page: import("@playwright/test").Page) =>
  page.getByTestId("tour-card-title");
const progress = (page: import("@playwright/test").Page) =>
  page.getByTestId("tour-card-progress");

async function startTourFromHelpMenu(
  page: import("@playwright/test").Page,
  menuItemName: string
) {
  await page.getByTestId("help-menu-button").first().click();
  await page.getByRole("menuitem", { name: menuItemName }).click();
  await expect(card(page)).toBeVisible({ timeout: 10000 });
}

test.describe("Onboarding tours", () => {
  test("main tour launches from the help menu and navigates steps", async ({
    page,
  }) => {
    await test.step("Open the dashboard and start the Guided Welcome Tour", async () => {
      await page.goto("/en-US");
      await page.waitForLoadState("load");
      await startTourFromHelpMenu(page, "Guided Welcome Tour");
    });

    await test.step("Step 1 shows the welcome card anchored to the header logo", async () => {
      await expect(cardTitle(page)).toHaveText("Welcome to TestPlanIt!");
      await expect(progress(page)).toHaveText(/^1 \/ \d+$/);

      // Spotlight sanity: step 1 anchors to #header-logo with side
      // "bottom-left", so the card must render below the logo and in the
      // logo's horizontal neighborhood. A broken spotlight offset (e.g. a
      // layout change shifting the body's origin) puts the card far away.
      const target = await page.locator("#header-logo").boundingBox();
      const tourCard = await card(page).boundingBox();
      expect(target).not.toBeNull();
      expect(tourCard).not.toBeNull();
      expect(tourCard!.y).toBeGreaterThan(target!.y);
      expect(Math.abs(tourCard!.x - target!.x)).toBeLessThan(400);
    });

    await test.step("Next advances, Previous goes back", async () => {
      await page.getByTestId("tour-card-next").click();
      await expect(progress(page)).toHaveText(/^2 \/ \d+$/);
      await expect(cardTitle(page)).toHaveText("Projects");

      await page.getByTestId("tour-card-prev").click();
      await expect(progress(page)).toHaveText(/^1 \/ \d+$/);
      await expect(cardTitle(page)).toHaveText("Welcome to TestPlanIt!");
    });

    await test.step("Skip closes the tour", async () => {
      await page.getByTestId("tour-card-skip").click();
      await expect(card(page)).toBeHidden({ timeout: 10000 });
    });
  });

  test("main tour can be walked to the end and finished", async ({ page }) => {
    await page.goto("/en-US");
    await page.waitForLoadState("load");
    await startTourFromHelpMenu(page, "Guided Welcome Tour");

    const total = parseInt(
      ((await progress(page).textContent()) ?? "").split("/")[1].trim(),
      10
    );
    expect(total).toBeGreaterThan(1);

    // Walk every step. The Next button doubles as Finish on the last step.
    for (let step = 2; step <= total; step++) {
      await page.getByTestId("tour-card-next").click();
      await expect(progress(page)).toHaveText(
        new RegExp(`^${step} / ${total}$`),
        { timeout: 10000 }
      );
    }
    await expect(page.getByTestId("tour-card-next")).toHaveText(/Finish/);
    await page.getByTestId("tour-card-next").click();
    await expect(card(page)).toBeHidden({ timeout: 10000 });
  });

  test("project tour syncs the URL and restores after a reload", async ({
    page,
    api,
  }) => {
    let projectId: number;

    await test.step("Create a project and open its overview page", async () => {
      projectId = await api.createProject(`E2E Tour Project ${Date.now()}`);
      await page.goto(`/en-US/projects/overview/${projectId}`);
      await page.waitForLoadState("load");
      // The tour's first step anchors to the project selector; start the tour
      // only once it exists, as a user would (nextstepjs renders nothing when
      // a manually started tour's target is missing).
      await expect(page.getByTestId("project-dropdown-trigger")).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step("Start the Project Tour from the help menu", async () => {
      await startTourFromHelpMenu(page, "Project Tour");
      await expect(cardTitle(page)).toHaveText("Project Selector");
      // The tour writes its state into the URL for cross-page navigation.
      await page.waitForURL(/tour=projectTour/, { timeout: 10000 });
    });

    await test.step("Advancing a step updates the URL step marker", async () => {
      await page.getByTestId("tour-card-next").click();
      await expect(cardTitle(page)).toHaveText("Project Sections");
      await page.waitForURL(/tour=projectTour&step=1/, { timeout: 10000 });
    });

    await test.step("Reloading restores the tour at the same step", async () => {
      await page.reload();
      await page.waitForLoadState("load");

      await expect(card(page)).toBeVisible({ timeout: 15000 });
      await expect(cardTitle(page)).toHaveText("Project Sections");
      await expect(progress(page)).toHaveText(/^2 \/ \d+$/);
    });

    await test.step("Skip closes the restored tour", async () => {
      // DOM-level click: the restored card can render partly outside the
      // 720p viewport (spotlight anchors to the full-height sidebar), which
      // defeats Playwright's viewport/stability checks. What this step pins
      // is that skip actually ends the restored tour.
      await page
        .getByTestId("tour-card-skip")
        .evaluate((el) => (el as HTMLElement).click());
      await expect(card(page)).toBeHidden({ timeout: 10000 });
    });
  });

  test("admin tour launches on admin pages", async ({ page }) => {
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("load");
    // First tour step anchors to the admin page title; wait for it as a user would.
    await expect(page.getByTestId("admin-page-title").first()).toBeVisible({
      timeout: 15000,
    });

    await startTourFromHelpMenu(page, "Admin Tour");
    await expect(cardTitle(page)).toHaveText("Welcome to Admin Controls");
    await expect(progress(page)).toHaveText(/^1 \/ \d+$/);

    await page.getByTestId("tour-card-next").click();
    await expect(progress(page)).toHaveText(/^2 \/ \d+$/);

    await page.getByTestId("tour-card-skip").click();
    await expect(card(page)).toBeHidden({ timeout: 10000 });
  });
});
