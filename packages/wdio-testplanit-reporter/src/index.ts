/**
 * @testplanit/wdio-reporter - WebdriverIO reporter for TestPlanIt
 *
 * Reports test results directly to your TestPlanIt instance.
 *
 * @example
 * ```javascript
 * // wdio.conf.js
 * export const config = {
 *   reporters: [
 *     ['@testplanit/wdio-reporter', {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       runName: 'E2E Tests - {date}',
 *     }]
 *   ]
 * }
 * ```
 *
 * @packageDocumentation
 */

export { default, default as TestPlanItReporter } from './reporter.js';
export type { TestPlanItReporterOptions, TrackedTestResult, ReporterState } from './types.js';

// Re-export useful types from the API package
export { TestPlanItClient, TestPlanItError } from '@testplanit/api';
export type { TestRun, RepositoryCase, TestRunResult, Status } from '@testplanit/api';
