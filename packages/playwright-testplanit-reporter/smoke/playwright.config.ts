import { defineConfig } from '@playwright/test';
import * as path from 'path';

/**
 * Throwaway smoke harness for @testplanit/playwright-reporter.
 *
 * Drives the locally built reporter (../dist/index.js) against a running
 * TestPlanIt dev instance. The tests are plain assertions (no `page` fixture),
 * so no browser is launched or downloaded.
 *
 * Configure via env (see smoke/.env.example). Run from the package dir:
 *   set -a; . smoke/.env; set +a
 *   pnpm exec playwright test -c smoke/playwright.config.ts
 */

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const autoCreate = process.env.TPI_AUTOCREATE === '1';

// templateId may be a numeric ID or a template name.
const rawTemplate = process.env.TPI_TEMPLATE;
const templateId =
  rawTemplate === undefined ? undefined : Number.isNaN(Number(rawTemplate)) ? rawTemplate : Number(rawTemplate);

export default defineConfig({
  testDir: './tests',
  // Report every attempt: bump TPI_RETRIES to see retries produce multiple results.
  retries: Number(process.env.TPI_RETRIES ?? 0),
  reporter: [
    ['list'],
    [
      path.resolve(__dirname, '../dist/index.js'),
      {
        domain: required('TPI_DOMAIN'),
        apiToken: required('TPI_TOKEN'),
        projectId: Number(required('TPI_PROJECT_ID')),
        runName: 'Playwright Smoke - {date} {time} ({browser})',
        verbose: true,
        ...(autoCreate
          ? {
              autoCreateTestCases: true,
              createFolderHierarchy: true,
              parentFolderId: process.env.TPI_PARENT_FOLDER || 'Playwright Smoke',
              templateId,
            }
          : {}),
      },
    ],
  ],
  // Project name surfaces as {browser}. No browser launches — tests use no page fixture.
  projects: [{ name: process.env.TPI_BROWSER || 'chromium' }],
});
