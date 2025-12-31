import { defineConfig, devices } from "@playwright/test";
import path from "path";

const isCI = !!process.env.CI;
// Use port 3002 for E2E tests so dev server can run on 3000 simultaneously
const E2E_PORT = process.env.E2E_PORT || "3002";
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "./tests",

  // Global test timeout
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if test.only is left in source code
  forbidOnly: isCI,

  // Retry on CI only
  retries: isCI ? 2 : 0,

  // Limit workers on CI for stability
  workers: isCI ? 2 : undefined,

  // Reporter configuration
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  // Global setup for authentication
  globalSetup: require.resolve("./global-setup"),

  // Shared settings for all projects
  use: {
    baseURL,

    // Locale handling - default to en-US
    locale: "en-US",

    // Collect trace on first retry
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure for debugging
    video: "on-first-retry",

    // Browser context options
    viewport: { width: 1280, height: 720 },

    // Action timeout
    actionTimeout: 15 * 1000,

    // Navigation timeout
    navigationTimeout: 30 * 1000,
  },

  // Project configurations
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(__dirname, ".auth/admin.json"),
      },
    },
  ],

  // Local dev server configuration
  // Note: The server is started with .env.e2e loaded via dotenv-cli
  // Run: pnpm test:e2e (which uses dotenv -e .env.e2e)
  webServer: isCI
    ? undefined
    : {
        command: `pnpm dev --port ${E2E_PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.E2E_FRESH_SERVER,
        timeout: 120 * 1000,
        env: {
          // The .env.e2e is loaded by the parent process via dotenv-cli
          // so the dev server inherits the E2E database configuration
        },
      },

  // Output directory
  outputDir: "test-results",
});
