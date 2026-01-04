import { Page, Locator, expect } from "@playwright/test";

/**
 * Base page object with common methods for all pages
 */
export abstract class BasePage {
  protected readonly page: Page;
  protected readonly locale: string;

  constructor(page: Page, locale: string = "en-US") {
    this.page = page;
    this.locale = locale;
  }

  /**
   * Navigate to a path with i18n locale prefix
   */
  async navigate(path: string): Promise<void> {
    const fullPath = path.startsWith("/")
      ? `/${this.locale}${path}`
      : `/${this.locale}/${path}`;
    await this.page.goto(fullPath);
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Dismiss any onboarding/tour overlays that may be blocking interactions
   */
  async dismissOnboardingOverlay(): Promise<void> {
    // Check for NextStep onboarding overlay
    const overlay = this.page.locator('[data-name="nextstep-overlay"]');
    if (await overlay.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Try to close it by pressing Escape or clicking skip/close button
      await this.page.keyboard.press("Escape");
      // Wait for overlay to potentially close
      await expect(overlay).not.toBeVisible({ timeout: 2000 }).catch(() => {});

      // If still visible, try clicking any skip/close buttons
      if (await overlay.isVisible().catch(() => false)) {
        const closeButton = this.page.locator('[data-name="nextstep-overlay"] button:has-text("Skip"), [data-name="nextstep-overlay"] button:has-text("Close"), [data-name="nextstep-overlay"] button:has-text("Done")').first();
        if (await closeButton.isVisible().catch(() => false)) {
          await closeButton.click();
          // Wait for overlay to close after clicking button
          await expect(overlay).not.toBeVisible({ timeout: 2000 }).catch(() => {});
        }
      }
    }
  }

  /**
   * Get element by test ID
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Wait for a toast notification to appear
   */
  async waitForToast(message?: string): Promise<void> {
    const toastLocator = this.page.locator('[role="status"], [data-sonner-toast]');
    await expect(toastLocator.first()).toBeVisible({ timeout: 10000 });
    if (message) {
      await expect(toastLocator.first()).toContainText(message);
    }
  }

  /**
   * Wait for toast to disappear
   */
  async waitForToastToDisappear(): Promise<void> {
    const toastLocator = this.page.locator('[role="status"], [data-sonner-toast]');
    await expect(toastLocator).not.toBeVisible({ timeout: 10000 });
  }

  /**
   * Take a screenshot for debugging
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `test-results/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  /**
   * Get the current URL path (without locale)
   */
  async getCurrentPath(): Promise<string> {
    const url = this.page.url();
    const path = new URL(url).pathname;
    // Remove locale prefix
    return path.replace(new RegExp(`^/${this.locale}`), "") || "/";
  }
}
