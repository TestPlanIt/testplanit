import { APIRequestContext, Page } from "@playwright/test";

/**
 * Login via UI (more reliable than API for this app)
 * @param page - Playwright page object
 * @param email - User email
 * @param password - User password
 */
export async function apiLogin(page: Page, email: string, password: string): Promise<void> {
  // Navigate to signin page
  await page.goto("/en-US/signin");
  
  // Fill in credentials
  await page.getByTestId("email-input").fill(email);
  await page.getByTestId("password-input").fill(password);
  
  // Click sign in
  await page.getByTestId("signin-button").click();
  
  // Wait for navigation to complete
  await page.waitForURL((url) => !url.pathname.includes('/signin'), { timeout: 15000 });
}

// Legacy UI-based login (kept for backward compatibility)
export async function authenticateAsAdmin(page: Page): Promise<void> {
  // Use API login for better performance
  await apiLogin(page, "admin@testplanit.com", "admin");
}

// Convenience function for admin login
export async function loginAsAdmin(page: Page): Promise<void> {
  await apiLogin(page, "admin@testplanit.com", "admin");
}

// Convenience function for test user login
export async function loginAsTestUser(page: Page): Promise<void> {
  await apiLogin(page, "testuser@example.com", "password123");
}

export async function getAuthenticatedContext(page: Page): Promise<APIRequestContext> {
  // First authenticate via API
  await authenticateAsAdmin(page);
  
  // Return the authenticated request context
  return page.request;
}