import { type Page, type Locator, expect } from "@playwright/test";

export class MilestonesPage {
  readonly page: Page;
  readonly dashboardHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dashboardHeading = page.getByTestId("dashboard-card");
  }

  async goto() {
    // Navigation still targets /milestone
    await this.page.goto("/en-US/milestone");
  }

  async expectDashboardHeadingToBeVisible() {
    await expect(this.dashboardHeading).toBeVisible();
  }
}
