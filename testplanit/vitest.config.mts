import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./vitest.setup.tsx",
    css: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    reporters: ["default", "junit"],
    outputFile: {
      junit: "./test-results/junit.xml",
    },
    // CI-specific settings to prevent EPIPE errors and worker crashes
    // Use threads pool instead of forks for better stability in CI
    ...(process.env.CI
      ? {
          pool: "threads",
          singleThread: true,
          isolate: false,
          maxConcurrency: 1,
          sequence: {
            concurrent: false,
          },
        }
      : {
          pool: "forks",
          isolate: true,
        }),
    exclude: [
      "node_modules/",
      "dist/",
      ".next/",
      "coverage/",
      "e2e/**",
      "**/*.config.{js,ts}",
      "vitest.setup.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["**/*.{ts,tsx}"],
      exclude: [
        "node_modules/",
        "dist/",
        ".next/",
        "coverage/",
        "**/*.config.{js,ts}",
        "**/*.d.ts",
        "**/types.ts",
        "**/types/**",
        "**/constants.ts",
        "**/constants/**",
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "main.tsx",
        "vitest.setup.ts",
        "app/layout.tsx",
        "app/[locale]/layout.tsx",
        "e2e/**",
      ],
    },
    server: {
      deps: {
        inline: ["next-intl", "lucide-react"],
      },
    },
  },
});
