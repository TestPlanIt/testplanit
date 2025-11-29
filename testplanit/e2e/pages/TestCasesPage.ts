import { type Page, type Locator, expect } from "@playwright/test";

export class TestCasesPage {
  readonly page: Page;
  readonly dashboardHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dashboardHeading = page.getByTestId("dashboard-card");
  }

  async goto() {
    // Navigation still targets /case
    await this.page.goto("/en-US/case");
  }

  async expectDashboardHeadingToBeVisible() {
    await expect(this.dashboardHeading).toBeVisible();
  }
}
