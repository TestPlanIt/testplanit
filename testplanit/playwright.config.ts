import path from "path";
import { defineConfig, devices } from "@playwright/test";
import { defaultLocale } from "./i18n/navigation";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * Path to the file storing authentication state.
 * Use path.join to ensure cross-platform compatibility and correct resolution from workspace root.
 */
const storageStatePath = path.join(__dirname, "e2e", ".auth", "admin.json");

const baseURL = process.env.NEXTAUTH_URL || "http://localhost:3000";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  // globalSetup is now used to handle login
  // Commenting out for now as it breaks tests that need different auth
  // globalSetup: path.join(__dirname, "e2e", "global.setup.ts"),

  testDir: "./e2e",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 1,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 6,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["list"], ["html", { open: "never" }]],
  /* Shared settings for all the projects below. */
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "on",
    // storageState: storageStatePath, // Disabled - tests handle their own auth
    ...devices["Desktop Chrome"],
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      // This project uses the top-level use settings
    },

    // Remove the specific auth/unauth projects
    /*
    {
      name: "chromium-auth", ...
    },
    {
      name: "chromium-unauth", ...
    },
    */

    // You might add firefox, webkit projects here if needed, without storageState
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: "pnpm turbo:testdb",
    url: `${baseURL}/${defaultLocale}`,
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120 * 1000,
  },

  /* Exit after tests complete */
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
});
