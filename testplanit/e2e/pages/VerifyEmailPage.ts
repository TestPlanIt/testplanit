import { type Page, type Locator, expect } from "@playwright/test";

export class VerifyEmailPage {
  readonly page: Page;
  // Locator added to target a reliable element on the resulting page (dashboard)
  readonly dashboardHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    // Target the "Your Assignments" text
    this.dashboardHeading = page.getByTestId("dashboard-card");
  }

  async goto() {
    await this.page.goto("/en-US/verify-email");
  }

  // Assertion method updated to reflect the dashboard state
  async expectDashboardHeadingToBeVisible() {
    // Check for the dashboard heading instead of the URL
    await expect(this.dashboardHeading).toBeVisible();
  }

  // Add other assertion methods as needed
}
