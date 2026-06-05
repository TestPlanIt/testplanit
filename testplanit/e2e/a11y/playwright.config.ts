import { defineConfig, devices } from "@playwright/test";
import path from "path";
import baseConfig from "../playwright.config";

/**
 * Accessibility-scan Playwright config. Reuses the base e2e config's wiring —
 * `globalSetup` (reset+seed DB, log in as admin → storageState, spawn BullMQ
 * workers), `globalTeardown` (stop workers), `webServer`, timeouts and `use`
 * (those are absolute paths / plain values, safe to spread) — but swaps in:
 *   - testDir = this directory (so only the a11y specs run)
 *   - a `setup` project that seeds rich fixture data, gated before the scan
 *   - its own report/output dirs so it never clobbers the main e2e artifacts
 */

const E2E_PORT = process.env.E2E_PORT || "3002";
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`;
const authFile = path.join(__dirname, "..", ".auth", "admin.json");

export default defineConfig({
  ...baseConfig,
  testDir: __dirname,
  outputDir: path.join(__dirname, "test-results"),

  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: path.join(__dirname, "playwright-report"),
        open: "never",
      },
    ],
  ],

  projects: [
    {
      name: "setup",
      testMatch: /fixtures\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL, storageState: authFile },
    },
    {
      name: "a11y",
      testMatch: /scan\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], baseURL, storageState: authFile },
    },
  ],
});
