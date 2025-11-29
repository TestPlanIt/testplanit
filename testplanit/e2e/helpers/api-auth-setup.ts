import { test as base, Page } from "@playwright/test";

// Extend the base test to include authentication
export const test = base.extend({
  // Override the request fixture to be authenticated
  request: async ({ page, request }, use) => {
    // Navigate to signin page
    await page.goto("/en-US/signin");

    // Fill in admin credentials
    await page.getByTestId("email-input").fill("admin@testplanit.com");
    await page.getByTestId("password-input").fill("admin");

    // Click sign in
    await page.getByTestId("signin-button").click({ force: true });

    // Wait for navigation to complete
    await page.waitForURL((url) => !url.pathname.includes("/signin"), {
      timeout: 15000,
    });

    // Now use the authenticated request context
    /* eslint-disable-next-line react-hooks/rules-of-hooks */
    await use(request);
  },
});

export { expect } from "@playwright/test";
