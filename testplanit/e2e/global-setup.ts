import { chromium, FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_DIR = path.join(__dirname, ".auth");
const ADMIN_AUTH_FILE = path.join(AUTH_DIR, "admin.json");

async function globalSetup(config: FullConfig) {
  console.log("Running global setup...");

  // Ensure auth directory exists
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  // Skip if auth file already exists and is recent (less than 1 hour old)
  if (fs.existsSync(ADMIN_AUTH_FILE)) {
    const stats = fs.statSync(ADMIN_AUTH_FILE);
    const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageInHours < 1) {
      console.log("Using existing auth session (less than 1 hour old)");
      return;
    }
  }

  // Get base URL from config
  const baseURL =
    config.projects[0]?.use?.baseURL || "http://localhost:3000";

  console.log(`Authenticating admin user against ${baseURL}...`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to signin page
    await page.goto(`${baseURL}/en-US/signin`);

    // Wait for the page to load
    await page.waitForLoadState("networkidle");

    // Fill in credentials
    // Try common input selectors since we may not have test IDs yet
    const emailInput = page.locator(
      '[data-testid="email-input"], input[type="email"], input[name="email"]'
    ).first();
    const passwordInput = page.locator(
      '[data-testid="password-input"], input[type="password"], input[name="password"]'
    ).first();
    const submitButton = page.locator(
      '[data-testid="signin-button"], button[type="submit"]'
    ).first();

    await emailInput.fill("admin@example.com");
    await passwordInput.fill("admin");
    await submitButton.click();

    // Wait for redirect after successful login
    await page.waitForURL(/\/en-US\/?$/, { timeout: 30000 });

    console.log("Admin authentication successful");

    // Save the storage state
    await context.storageState({ path: ADMIN_AUTH_FILE });
    console.log(`Auth state saved to ${ADMIN_AUTH_FILE}`);
  } catch (error) {
    console.error("Authentication failed:", error);
    // Take a screenshot for debugging
    await page.screenshot({
      path: path.join(AUTH_DIR, "auth-failure.png"),
      fullPage: true,
    });
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }

  console.log("Global setup complete.");
}

export default globalSetup;
