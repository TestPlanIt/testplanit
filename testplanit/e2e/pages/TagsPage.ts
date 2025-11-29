import { type Page, type Locator, expect } from "@playwright/test";

export class TagsPage {
  readonly page: Page;
  readonly dashboardHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dashboardHeading = page.getByTestId("dashboard-card");
  }

  async goto() {
    await this.page.goto("/en-US/tags");
  }

  async expectDashboardHeadingToBeVisible() {
    await expect(this.dashboardHeading).toBeVisible();
  }
}
