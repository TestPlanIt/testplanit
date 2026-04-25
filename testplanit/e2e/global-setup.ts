import { chromium, FullConfig } from "@playwright/test";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

const AUTH_DIR = path.join(__dirname, ".auth");
const ADMIN_AUTH_FILE = path.join(AUTH_DIR, "admin.json");
const WORKERS_PID_FILE = path.join(AUTH_DIR, "workers.pid");

/**
 * Spawn the BullMQ workers (`pnpm workers`) as a detached child process so
 * the copy-move / sync / etc. queues actually have consumers during the
 * E2E run. Without this, any test that submits a job (`Copy data carry-
 * over verification`, `Move operation`, etc.) will time out waiting for
 * a job that nobody is consuming. global-teardown.ts kills the process
 * group when the suite finishes.
 *
 * Playwright's `webServer` config can't host this — workers don't expose
 * HTTP, and using a second `webServer` entry that shares Next's URL gets
 * silently skipped due to `reuseExistingServer: true` (or fails port-
 * conflict checks if false).
 */
function spawnWorkers(): void {
  console.log("Spawning BullMQ workers (pnpm workers)...");
  const child = spawn("pnpm", ["workers"], {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    detached: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (typeof child.pid !== "number") {
    console.error("Failed to spawn workers — no PID returned");
    return;
  }
  fs.writeFileSync(WORKERS_PID_FILE, String(child.pid));
  child.unref();
  console.log(`Workers spawned with PID ${child.pid}`);
}

async function globalSetup(config: FullConfig) {
  console.log("Running global setup...");

  // Step 1: Reset and seed the database
  console.log("Resetting and seeding test database...");
  try {
    execSync("pnpm test:e2e:setup-db", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
      env: process.env,
    });
    console.log("Database reset complete.");
  } catch (error) {
    console.error("Failed to reset database:", error);
    throw error;
  }

  // Ensure auth directory exists
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  // Always re-authenticate after database reset (auth session was cleared by setup-db)

  // Get base URL from config
  const baseURL = config.projects[0]?.use?.baseURL || "http://localhost:3000";

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
    const emailInput = page
      .locator(
        '[data-testid="email-input"], input[type="email"], input[name="email"]'
      )
      .first();
    const passwordInput = page
      .locator(
        '[data-testid="password-input"], input[type="password"], input[name="password"]'
      )
      .first();
    const submitButton = page
      .locator('[data-testid="signin-button"], button[type="submit"]')
      .first();

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

  // Spawn BullMQ workers as a detached child process. global-teardown
  // kills the process group when the suite finishes.
  spawnWorkers();

  console.log("Global setup complete.");
}

export default globalSetup;
