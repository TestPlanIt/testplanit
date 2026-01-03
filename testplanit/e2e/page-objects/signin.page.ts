import { Page, Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

/**
 * Sign-in page object
 */
export class SigninPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page, locale: string = "en-US") {
    super(page, locale);

    // Use multiple selectors to be resilient to implementation changes
    this.emailInput = page.locator(
      '[data-testid="email-input"], input[type="email"], input[name="email"]'
    ).first();
    this.passwordInput = page.locator(
      '[data-testid="password-input"], input[type="password"], input[name="password"]'
    ).first();
    this.submitButton = page.locator(
      '[data-testid="signin-button"], button[type="submit"]'
    ).first();
    this.errorMessage = page.locator('[role="alert"], .text-destructive').first();
  }

  /**
   * Navigate to the signin page
   */
  async goto(): Promise<void> {
    await this.navigate("/signin");
    await this.waitForPageLoad();
  }

  /**
   * Fill in login credentials
   */
  async fillCredentials(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  /**
   * Submit the login form
   */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /**
   * Complete login flow
   */
  async login(email: string, password: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.submit();
    // Wait for redirect to home page
    await this.page.waitForURL(new RegExp(`/${this.locale}/?$`), {
      timeout: 30000,
    });
  }

  /**
   * Verify error message is displayed
   */
  async verifyErrorMessage(expectedMessage?: string): Promise<void> {
    await expect(this.errorMessage).toBeVisible();
    if (expectedMessage) {
      await expect(this.errorMessage).toContainText(expectedMessage);
    }
  }

  /**
   * Check if we're on the signin page
   */
  async isOnSigninPage(): Promise<boolean> {
    const currentPath = await this.getCurrentPath();
    return currentPath.includes("/signin");
  }
}
