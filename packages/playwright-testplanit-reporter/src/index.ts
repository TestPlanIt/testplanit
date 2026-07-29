/**
 * @testplanit/playwright-reporter - Playwright reporter for TestPlanIt
 *
 * Reports test results directly to your TestPlanIt instance.
 *
 * @example
 * ```typescript
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   reporter: [
 *     ['@testplanit/playwright-reporter', {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       runName: 'E2E Tests - {date} {time}',
 *     }],
 *   ],
 * });
 * ```
 *
 * @packageDocumentation
 */

export { default, default as TestPlanItReporter, RUN_ID_ENV_VAR } from './reporter.js';
export type {
  TestPlanItReporterOptions,
  TrackedTestResult,
  ReporterState,
  RunLinkInput,
  RunAttachmentInput,
} from './types.js';

// Runtime helpers: attach links/files or set metadata on the RUN itself from
// inside a test or hook (delivered to the reporter via reserved
// `testplanit:run-*` attachments).
export { attachToRun, setRunMetadata } from './runLevel.js';
export type { RunAttachTarget } from './runLevel.js';

// Re-export useful types from the API package
export { TestPlanItClient, TestPlanItError } from '@testplanit/api';
export type { TestRun, RepositoryCase, TestRunResult, Status, Attachment, RunMetadata } from '@testplanit/api';
