import { type Page, type Locator, expect } from "@playwright/test";

export class SignInPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly createAccountLink: Locator;
  readonly googleSignInButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByRole("textbox", { name: "Email" });
    this.passwordInput = page.getByRole("textbox", { name: "Password" });
    this.signInButton = page.getByRole("button", { name: "Sign In" });
    this.createAccountLink = page.getByRole("link", {
      name: "Create a new account",
    });
    this.googleSignInButton = page.getByRole("button", {
      name: "Continue with Google",
    });
  }

  async goto() {
    await this.page.goto("/signin");
    await this.page.waitForLoadState("networkidle");
  }

  async login(email: string, password: string) {
    await this.page.waitForLoadState("networkidle");
    await expect(this.emailInput).toBeVisible();
    await this.emailInput.fill(email);

    await expect(this.passwordInput).toBeVisible();
    await this.passwordInput.fill(password);

    await expect(this.signInButton).toBeVisible();
    await this.signInButton.click();

    // Wait for navigation to complete - Next.js will handle the locale prefix
    await this.page.waitForURL("**/", { timeout: 10000 });

    // Wait for the page to be fully loaded
    await this.page.waitForLoadState("networkidle");
  }

  async expectSignInButtonToBeVisible() {
    await expect(this.signInButton).toBeVisible();
  }

  async expectCreateAccountLinkToBeVisible() {
    await expect(this.createAccountLink).toBeVisible();
  }

  async expectLoginToBeSuccessful() {
    // Check if we're redirected to the root path
    await this.page.waitForURL("**/", { timeout: 10000 });
    // Wait for the page to be fully loaded
    await this.page.waitForLoadState("networkidle");
  }
}
