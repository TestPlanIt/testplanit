import { type Page, type Locator, expect } from "@playwright/test";

export class SignUpPage {
  readonly page: Page;
  readonly signUpButton: Locator;
  // Add other relevant locators for the sign-up form if needed

  constructor(page: Page) {
    this.page = page;
    // Try multiple selectors - button with type submit should work
    this.signUpButton = page.locator('button[type="submit"]').first();
    // Initialize other locators here
  }

  async goto() {
    await this.page.goto("/en-US/signup");
    await this.page.waitForLoadState("networkidle");
  }

  async expectSignUpButtonToBeVisible() {
    // First wait for any button to be visible to ensure page is loaded
    await this.page.waitForSelector('button', { timeout: 10000 });
    // Then check if our specific button is visible
    await expect(this.signUpButton).toBeVisible({ timeout: 10000 });
  }

  // Add methods for interacting with the sign-up form
}
