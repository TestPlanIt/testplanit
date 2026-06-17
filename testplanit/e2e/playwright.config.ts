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

// Optionally report results to a TestPlanIt instance via the local reporter.
// Inert unless TPI_DOMAIN + TPI_TOKEN + TPI_PROJECT_ID are set, so normal E2E
// runs are unaffected. Used to dogfood @testplanit/playwright-reporter: with
// TPI_AUTOCREATE=1 it creates a case per test (named by describe path + title)
// and captures each test.step() as that case's steps.
const tpiTemplate = process.env.TPI_TEMPLATE;
const tpiReporter: [string, Record<string, unknown>][] =
  process.env.TPI_DOMAIN && process.env.TPI_TOKEN && process.env.TPI_PROJECT_ID
    ? [
        [
          path.resolve(
            __dirname,
            "../../packages/playwright-testplanit-reporter/dist/index.js"
          ),
          {
            domain: process.env.TPI_DOMAIN,
            apiToken: process.env.TPI_TOKEN,
            projectId: Number(process.env.TPI_PROJECT_ID),
            runName: "E2E Suite - {date} {time}",
            verbose: process.env.TPI_VERBOSE === "1",
            ...(process.env.TPI_AUTOCREATE === "1"
              ? {
                  autoCreateTestCases: true,
                  createFolderHierarchy: true,
                  parentFolderId: process.env.TPI_PARENT_FOLDER || "E2E Suite",
                  // Template ID or name; needs a Steps field for clean rendering.
                  templateId:
                    tpiTemplate && Number.isNaN(Number(tpiTemplate))
                      ? tpiTemplate
                      : tpiTemplate
                        ? Number(tpiTemplate)
                        : undefined,
                }
              : {}),
            // Keep created cases' steps in sync with the spec on every run.
            overwriteSteps: process.env.TPI_OVERWRITE_STEPS === "1",
          },
        ],
      ]
    : [];

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

  // Retry on CI, and on the prod-build local suite. 8 parallel workers
  // against a single DB / Elasticsearch / webserver instance produces
  // enough race conditions (ES indexing lag, mutation-then-read races,
  // access-manifest cache contention) that one retry catches the
  // overwhelming majority of false failures. Real bugs still fail twice.
  retries: isCI ? 2 : useProdBuild ? 1 : 0,

  // Limit workers for stability. High local parallelism against a single
  // shared DB / Elasticsearch / Valkey / Next instance produces deadlocks and
  // mutation-then-read races, so the prod-build suite defaults to a calmer 4
  // (was 8). Override with E2E_WORKERS=N to tune for your hardware.
  workers: process.env.E2E_WORKERS
    ? Number(process.env.E2E_WORKERS)
    : isCI
      ? 2
      : useProdBuild
        ? 4
        : 1,

  // Reporter configuration
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
    ...tpiReporter,
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
  //
  // E2E env vars sourced from .env.e2e (loaded by `dotenv -e .env.e2e --` in
  // package.json scripts) include WEBHOOK_OUTBOUND_ALLOW_HTTP=true so the
  // outbound-webhook E2E can point at a local node:http stub server. Both the
  // next server (started below) and the BullMQ workers (spawned by
  // global-setup.ts via `pnpm workers`) inherit process.env from this loader.
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

  // Global teardown stops the BullMQ workers spawned by globalSetup.
  globalTeardown: require.resolve("./global-teardown"),

  // Output directory
  outputDir: "test-results",
});
