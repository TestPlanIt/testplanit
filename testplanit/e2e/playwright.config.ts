import { defineConfig, devices } from "@playwright/test";
import path from "path";

const isCI = !!process.env.CI;
// Use port 3002 for E2E tests so dev server can run on 3000 simultaneously
const E2E_PORT = process.env.E2E_PORT || "3002";
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`;
// Set E2E_VIDEO=on to always record video
const recordVideo = process.env.E2E_VIDEO === "on";
// Set E2E_PROD=on to run against production build (faster, more stable)
const useProdBuild = process.env.E2E_PROD === "on";

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

  // Limit workers for stability (dev server can get overwhelmed)
  // Production build can handle more workers than dev server
  workers: isCI ? 2 : useProdBuild ? 5 : 1,

  // Reporter configuration
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
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

    // Video recording: E2E_VIDEO=on for always, otherwise on retries
    video: recordVideo ? "on" : "retain-on-failure",

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
  //
  // RECOMMENDED: Use production build for faster, more stable tests:
  //   pnpm build && E2E_PROD=on pnpm test:e2e
  //
  // Alternative: Start dev server manually in separate terminal:
  //   Terminal 1: cd testplanit && dotenv -e .env.e2e -- pnpm dev --port 3002
  //   Terminal 2: cd testplanit/e2e && pnpm test:e2e
  webServer: isCI
    ? undefined
    : {
        command: useProdBuild
          ? `pnpm start --port ${E2E_PORT}`
          : `pnpm dev --port ${E2E_PORT}`,
        url: baseURL,
        reuseExistingServer: true, // Always reuse if available
        timeout: useProdBuild ? 60 * 1000 : 180 * 1000, // Prod starts faster
        stdout: "pipe",
        stderr: "pipe",
      },

  // Output directory
  outputDir: "test-results",
});
