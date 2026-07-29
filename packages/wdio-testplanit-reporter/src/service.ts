/**
 * WebdriverIO Launcher Service for TestPlanIt.
 *
 * Manages the test run lifecycle in the main WDIO process:
 * - onPrepare: Creates the test run and JUnit test suite ONCE before any workers start
 * - onComplete: Completes the test run ONCE after all workers finish
 *
 * This ensures all spec files across all worker batches report to a single test run,
 * regardless of `maxInstances` or execution order.
 *
 * @example
 * ```javascript
 * // wdio.conf.js
 * import { TestPlanItService } from '@testplanit/wdio-reporter';
 *
 * export const config = {
 *   services: [
 *     [TestPlanItService, {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       runName: 'E2E Tests - {date}',
 *     }]
 *   ],
 *   reporters: [
 *     ['@testplanit/wdio-reporter', {
 *       domain: 'https://testplanit.example.com',
 *       apiToken: process.env.TESTPLANIT_API_TOKEN,
 *       projectId: 1,
 *       autoCreateTestCases: true,
 *       parentFolderId: 10,
 *       templateId: 1,
 *     }]
 *   ]
 * }
 * ```
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import { TestPlanItClient } from '@testplanit/api';
import type { RunAttachmentInput, TestPlanItServiceOptions } from './types.js';
import {
  writeSharedState,
  deleteSharedState,
  parseEnvTestRunId,
  RUN_ID_ENV_VAR,
  type SharedState,
} from './shared.js';
import {
  applyEnvTemplate,
  attachFileToRun,
  createRuntimeApi,
  type RuntimeApiContext,
} from './runLevel.js';

/**
 * WebdriverIO Launcher Service for TestPlanIt.
 *
 * Creates a single test run before any workers start and completes it
 * after all workers finish. Workers read the shared state file to find
 * the pre-created test run and report results to it.
 */
export default class TestPlanItService {
  private options: TestPlanItServiceOptions;
  private client: TestPlanItClient;
  private verbose: boolean;
  private testRunId?: number;
  private testSuiteId?: number;
  /**
   * `runAttachments` entries whose file didn't exist yet at onPrepare
   * (typically artifacts produced by the tests themselves). Retried once in
   * onComplete, before the run is completed.
   */
  private deferredRunAttachments: RunAttachmentInput[] = [];
  /**
   * When true, the run was created by the pipeline rather than this service —
   * pinned by the `testRunId` option or `TESTPLANIT_RUN_ID`. The service reports
   * into it but never creates or completes it.
   */
  private externallyManaged = false;
  /**
   * Whether onPrepare exported the created run's ID into the environment, and
   * what was there before. Restored in onComplete so a second launcher in the
   * same process doesn't inherit a finished run and treat it as pinned.
   */
  private exportedRunIdEnv = false;
  private previousRunIdEnv?: string;

  constructor(serviceOptions: TestPlanItServiceOptions) {
    // Validate required options
    if (!serviceOptions.domain) {
      throw new Error('TestPlanIt service: domain is required');
    }
    if (!serviceOptions.apiToken) {
      throw new Error('TestPlanIt service: apiToken is required');
    }
    if (!serviceOptions.projectId) {
      throw new Error('TestPlanIt service: projectId is required');
    }

    this.options = {
      completeRunOnFinish: true,
      runName: 'Automated Tests - {date} {time}',
      testRunType: 'MOCHA',
      timeout: 30000,
      maxRetries: 3,
      verbose: false,
      ...serviceOptions,
    };

    this.verbose = this.options.verbose ?? false;

    const pinnedTestRunId =
      this.options.testRunId ?? parseEnvTestRunId(process.env[RUN_ID_ENV_VAR]);
    if (pinnedTestRunId !== undefined) {
      this.testRunId = pinnedTestRunId;
      this.externallyManaged = true;
      if (this.options.completeRunOnFinish) {
        this.options.completeRunOnFinish = false;
        this.log(
          `Test run ${pinnedTestRunId} pinned externally — completeRunOnFinish disabled; the pipeline completes the run`
        );
      }
    }

    this.client = new TestPlanItClient({
      baseUrl: this.options.domain,
      apiToken: this.options.apiToken,
      timeout: this.options.timeout,
      maxRetries: this.options.maxRetries,
    });
  }

  /**
   * Log a message if verbose mode is enabled
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.verbose) {
      console.log(`[TestPlanIt Service] ${message}`, ...args);
    }
  }

  /**
   * Log an error (always logs, not just in verbose mode)
   */
  private logError(message: string, error?: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error ?? '');
    console.error(`[TestPlanIt Service] ERROR: ${message}`, errorMsg);
  }

  /**
   * Format run name with available placeholders.
   * Note: {browser}, {spec}, and {suite} are NOT available in the service context
   * since it runs before any workers start.
   */
  private formatRunName(template: string): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const platform = process.platform;

    return template
      .replace('{date}', date)
      .replace('{time}', time)
      .replace('{platform}', platform)
      .replace('{browser}', 'unknown')
      .replace('{spec}', 'unknown')
      .replace('{suite}', 'Tests');
  }

  /**
   * Resolve string option IDs to numeric IDs using the API client.
   */
  private async resolveIds(): Promise<{
    configId?: number;
    milestoneId?: number;
    stateId?: number;
    tagIds?: number[];
  }> {
    const projectId = this.options.projectId;
    const resolved: {
      configId?: number;
      milestoneId?: number;
      stateId?: number;
      tagIds?: number[];
    } = {};

    if (typeof this.options.configId === 'string') {
      const config = await this.client.findConfigurationByName(projectId, this.options.configId);
      if (!config) {
        throw new Error(`Configuration not found: "${this.options.configId}"`);
      }
      resolved.configId = config.id;
      this.log(`Resolved configuration "${this.options.configId}" -> ${config.id}`);
    } else if (typeof this.options.configId === 'number') {
      resolved.configId = this.options.configId;
    }

    if (typeof this.options.milestoneId === 'string') {
      const milestone = await this.client.findMilestoneByName(projectId, this.options.milestoneId);
      if (!milestone) {
        throw new Error(`Milestone not found: "${this.options.milestoneId}"`);
      }
      resolved.milestoneId = milestone.id;
      this.log(`Resolved milestone "${this.options.milestoneId}" -> ${milestone.id}`);
    } else if (typeof this.options.milestoneId === 'number') {
      resolved.milestoneId = this.options.milestoneId;
    }

    if (typeof this.options.stateId === 'string') {
      const state = await this.client.findWorkflowStateByName(projectId, this.options.stateId);
      if (!state) {
        throw new Error(`Workflow state not found: "${this.options.stateId}"`);
      }
      resolved.stateId = state.id;
      this.log(`Resolved workflow state "${this.options.stateId}" -> ${state.id}`);
    } else if (typeof this.options.stateId === 'number') {
      resolved.stateId = this.options.stateId;
    }

    if (this.options.tagIds && this.options.tagIds.length > 0) {
      resolved.tagIds = await this.client.resolveTagIds(projectId, this.options.tagIds);
      this.log(`Resolved tags: ${resolved.tagIds.join(', ')}`);
    }

    return resolved;
  }

  /** Context object for the shared run-level attachment helpers. */
  private runtimeContext(): RuntimeApiContext {
    return {
      client: this.client,
      projectId: this.options.projectId,
      log: (message, ...args) => this.log(message, ...args),
      logError: (message, error) => this.logError(message, error),
    };
  }

  /**
   * Apply the declarative run-level options (`runLinks`, `runMetadata`,
   * `runAttachments`) to the test run. Runs once in the launcher process.
   * Every failure is logged and swallowed — run-level attachments must never
   * fail the test run.
   */
  private async applyRunLevelConfig(): Promise<void> {
    if (!this.testRunId) return;
    const ctx = this.runtimeContext();

    // Links and metadata describe the run as a whole. On a run shared by several
    // executions they belong to the pipeline that created it — applying them per
    // execution would duplicate every link and let the last shard overwrite the
    // metadata. Attachments are per-execution artifacts, so they still apply.
    if (this.externallyManaged) {
      if (this.options.runLinks?.length || this.options.runMetadata) {
        this.log('Skipping run links and metadata for externally managed test run');
      }
    } else {
      await this.applyRunIdentity();
    }

    // File attachments — defer paths that don't exist yet to onComplete
    for (const attachment of this.options.runAttachments ?? []) {
      try {
        const resolved: RunAttachmentInput = { ...attachment };
        if (resolved.name) {
          resolved.name = applyEnvTemplate(resolved.name).value;
        }
        if (!resolved.buffer && resolved.path) {
          const templatedPath = applyEnvTemplate(resolved.path);
          if (templatedPath.missing.length > 0) {
            this.logError(
              `Skipping run attachment "${attachment.path}": unresolved environment variable(s) ${templatedPath.missing.join(', ')}`
            );
            continue;
          }
          resolved.path = templatedPath.value;
          if (!fs.existsSync(resolved.path)) {
            this.log(
              `Run attachment not found yet, will retry after tests finish: ${resolved.path}`
            );
            this.deferredRunAttachments.push(resolved);
            continue;
          }
        }
        await attachFileToRun(ctx, this.testRunId, resolved);
        this.log(`Attached file to run: ${resolved.name ?? resolved.path}`);
      } catch (error) {
        this.logError(
          `Failed to attach run file "${attachment.name ?? attachment.path}":`,
          error
        );
      }
    }
  }

  /**
   * Apply the run-identity options (`runLinks`, `runMetadata`) to a run this
   * service created.
   */
  private async applyRunIdentity(): Promise<void> {
    if (!this.testRunId) return;

    // Links (e.g. CI build URL)
    for (const link of this.options.runLinks ?? []) {
      try {
        const url = applyEnvTemplate(link.url ?? '');
        if (url.missing.length > 0 || !url.value.trim()) {
          this.logError(
            `Skipping run link "${link.url}": unresolved environment variable(s) ${url.missing.join(', ') || '(empty url)'}`
          );
          continue;
        }
        const name = link.name ? applyEnvTemplate(link.name).value.trim() : '';
        const note = link.note ? applyEnvTemplate(link.note).value : undefined;
        await this.client.addTestRunLink(
          this.testRunId,
          url.value,
          name || undefined,
          note
        );
        this.log(`Attached link to run: ${url.value}`);
      } catch (error) {
        this.logError(`Failed to attach run link "${link.url}":`, error);
      }
    }

    // Metadata (rendered into the run's docs)
    const metadata: Record<string, string | number | boolean> = {};
    for (const [rawKey, rawValue] of Object.entries(this.options.runMetadata ?? {})) {
      const key = applyEnvTemplate(rawKey).value.trim();
      if (!key) continue;
      if (typeof rawValue === 'string') {
        const value = applyEnvTemplate(rawValue);
        if (value.missing.length > 0 && !value.value.trim()) {
          this.logError(
            `Skipping run metadata "${rawKey}": unresolved environment variable(s) ${value.missing.join(', ')}`
          );
          continue;
        }
        metadata[key] = value.value;
      } else {
        metadata[key] = rawValue;
      }
    }
    if (Object.keys(metadata).length > 0) {
      try {
        await this.client.setTestRunMetadata(this.testRunId, metadata);
        this.log(`Set run metadata: ${Object.keys(metadata).join(', ')}`);
      } catch (error) {
        this.logError('Failed to set run metadata:', error);
      }
    }
  }

  /**
   * Attach `runAttachments` entries that were deferred in onPrepare because
   * their file didn't exist yet. Called from onComplete before the run is
   * completed. Failures are logged and swallowed.
   */
  private async applyDeferredRunAttachments(): Promise<void> {
    if (!this.testRunId || this.deferredRunAttachments.length === 0) return;
    const ctx = this.runtimeContext();

    for (const attachment of this.deferredRunAttachments) {
      try {
        if (attachment.path && !fs.existsSync(attachment.path)) {
          this.logError(
            `Run attachment still not found, skipping: ${attachment.path}`
          );
          continue;
        }
        await attachFileToRun(ctx, this.testRunId, attachment);
        this.log(`Attached file to run: ${attachment.name ?? attachment.path}`);
      } catch (error) {
        this.logError(
          `Failed to attach run file "${attachment.name ?? attachment.path}":`,
          error
        );
      }
    }
    this.deferredRunAttachments = [];
  }

  /**
   * onPrepare - Runs once in the main process before any workers start.
   *
   * Creates the test run and JUnit test suite, then writes shared state
   * so all worker reporters can find and use the pre-created run.
   */
  async onPrepare(): Promise<void> {
    this.log('Preparing test run...');
    this.log(`  Domain: ${this.options.domain}`);
    this.log(`  Project ID: ${this.options.projectId}`);

    try {
      // Clean up any stale shared state from a previous run
      deleteSharedState(this.options.projectId);

      // Format the run name
      const runName = this.formatRunName(this.options.runName ?? 'Automated Tests - {date} {time}');

      if (this.externallyManaged) {
        // Configuration, milestone, state and tags belong to whoever created
        // the run, so they are neither resolved nor applied here.
        this.log(`Using externally managed test run: ${this.testRunId}`);
      } else {
        // Resolve string IDs to numeric IDs
        const resolved = await this.resolveIds();

        // Create the test run
        this.log(`Creating test run: "${runName}" (type: ${this.options.testRunType})`);
        const testRun = await this.client.createTestRun({
          projectId: this.options.projectId,
          name: runName,
          testRunType: this.options.testRunType,
          configId: resolved.configId,
          milestoneId: resolved.milestoneId,
          stateId: resolved.stateId,
          tagIds: resolved.tagIds,
        });
        this.testRunId = testRun.id;
        this.log(`Created test run with ID: ${this.testRunId}`);

        // Workers are forked from this process, so exporting the ID here is
        // what makes them inherit it. Each worker's reporter then sees a
        // pinned run and takes the externally managed path: it attaches
        // results only, and never creates a run, joins one through the
        // shared-state file, or completes one. This service still owns
        // completion, in onComplete.
        this.previousRunIdEnv = process.env[RUN_ID_ENV_VAR];
        this.exportedRunIdEnv = true;
        process.env[RUN_ID_ENV_VAR] = String(this.testRunId);
        this.log(`Exported ${RUN_ID_ENV_VAR}=${this.testRunId} for workers`);
      }

      const testRunId = this.testRunId;
      if (!testRunId) {
        throw new Error('No test run available to report into');
      }

      // Create the JUnit test suite. A pinned run collects one suite per
      // execution, so `testSuiteName` is how shards are told apart. The
      // launcher process has no browser or spec to name them by, so it also
      // resolves {env:VAR} — a shard ID from the pipeline is the usable handle.
      const suiteName = this.options.testSuiteName
        ? this.formatRunName(applyEnvTemplate(this.options.testSuiteName).value)
        : runName;
      this.log('Creating JUnit test suite...');
      const testSuite = await this.client.createJUnitTestSuite({
        testRunId,
        name: suiteName,
        time: 0,
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
      });
      this.testSuiteId = testSuite.id;
      this.log(`Created JUnit test suite with ID: ${this.testSuiteId}`);

      // Write shared state file for workers to read
      const sharedState: SharedState = {
        testRunId,
        testSuiteId: this.testSuiteId,
        createdAt: new Date().toISOString(),
        activeWorkers: 0, // Not used in service-managed mode
        managedByService: true,
      };
      writeSharedState(this.options.projectId, sharedState);
      this.log('Wrote shared state file for workers');

      // Apply run-level links, metadata, and file attachments exactly once.
      // Internally logs and swallows every failure — the run must not fail.
      await this.applyRunLevelConfig();

      // Always print this so users can see which run results land in
      if (this.externallyManaged) {
        console.log(`[TestPlanIt Service] Reporting into test run ${this.testRunId}`);
      } else {
        console.log(`[TestPlanIt Service] Test run created: "${runName}" (ID: ${this.testRunId})`);
      }
    } catch (error) {
      this.logError('Failed to prepare test run:', error);
      // Clean up shared state on failure so reporters fall back to self-managed mode
      deleteSharedState(this.options.projectId);
      // Same reason: don't leave workers pinned to a run this service could
      // not finish setting up.
      this.restoreRunIdEnv();
      throw error;
    }
  }

  /**
   * before - Runs in each worker process once the browser session is ready.
   *
   * Installs the `browser.testplanit` runtime API so tests and hooks can
   * attach links/files or set metadata on the managed run without importing
   * `@testplanit/api`:
   *
   * ```javascript
   * await browser.testplanit.attachToRun({ url: buildUrl, name: 'CI Build' });
   * await browser.testplanit.attachToRun({ path: './report.html' });
   * await browser.testplanit.setRunMetadata({ version: '1.2.3' });
   * ```
   *
   * The run ID is resolved from the shared state file on every call, so all
   * workers reach the same service-managed run.
   */
  before(_capabilities: unknown, _specs: unknown, browser?: unknown): void {
    const target = (browser ??
      (globalThis as Record<string, any>).browser) as
      | Record<string, unknown>
      | undefined;
    if (!target) {
      this.log('No browser object available; skipping runtime API install');
      return;
    }
    target.testplanit = createRuntimeApi(this.runtimeContext());
    this.log('Installed browser.testplanit runtime API');
  }

  /**
   * afterTest - Runs in each worker process after each test.
   *
   * Captures a screenshot on test failure when `captureScreenshots` is enabled.
   * The screenshot is intercepted and uploaded by the reporter automatically.
   */
  async afterTest(
    _test: Record<string, unknown>,
    _context: Record<string, unknown>,
    result: { error?: Error; passed: boolean },
  ): Promise<void> {
    if (!this.options.captureScreenshots || result.passed) {
      return;
    }

    try {
      // `browser` is a WDIO global available in worker processes
      await (globalThis as Record<string, any>).browser?.takeScreenshot();
    } catch (error) {
      this.log('Failed to capture screenshot:', error);
    }
  }

  /**
   * onComplete - Runs once in the main process after all workers finish.
   *
   * Completes the test run and cleans up the shared state file.
   */
  async onComplete(exitCode: number): Promise<void> {
    this.log(`All workers finished (exit code: ${exitCode})`);

    try {
      // Attach run files that didn't exist yet at onPrepare (e.g. logs or
      // reports produced by the tests), before the run is completed.
      await this.applyDeferredRunAttachments();

      if (this.externallyManaged) {
        this.log(`Skipping test run completion (test run ${this.testRunId} is managed externally)`);
      } else if (this.testRunId && this.options.completeRunOnFinish) {
        this.log(`Completing test run ${this.testRunId}...`);
        await this.client.completeTestRun(this.testRunId, this.options.projectId);
        this.log('Test run completed successfully');
      }

      // Print summary
      if (this.testRunId) {
        console.log('\n[TestPlanIt Service] ══════════════════════════════════════════');
        console.log(`[TestPlanIt Service]   Test Run ID: ${this.testRunId}`);
        if (this.externallyManaged) {
          console.log('[TestPlanIt Service]   Status: Left open (completed by the pipeline)');
        } else if (this.options.completeRunOnFinish) {
          console.log('[TestPlanIt Service]   Status: Completed');
        }
        console.log(`[TestPlanIt Service]   View: ${this.options.domain}/projects/runs/${this.options.projectId}/${this.testRunId}`);
        console.log('[TestPlanIt Service] ══════════════════════════════════════════\n');
      }
    } catch (error) {
      // Don't re-throw — failing onComplete would hide the actual test results
      this.logError('Failed to complete test run:', error);
    } finally {
      // Always clean up shared state
      deleteSharedState(this.options.projectId);
      this.log('Cleaned up shared state file');
      this.restoreRunIdEnv();
    }
  }

  /**
   * Undo the onPrepare export. All workers have finished by the time
   * onComplete runs, so nothing still needs to read it — and leaving a
   * completed run's ID in the environment would make the next launcher in
   * this process treat that run as its own pinned one.
   */
  private restoreRunIdEnv(): void {
    if (!this.exportedRunIdEnv) return;
    if (this.previousRunIdEnv === undefined) {
      delete process.env[RUN_ID_ENV_VAR];
    } else {
      process.env[RUN_ID_ENV_VAR] = this.previousRunIdEnv;
    }
    this.exportedRunIdEnv = false;
    this.previousRunIdEnv = undefined;
  }
}
