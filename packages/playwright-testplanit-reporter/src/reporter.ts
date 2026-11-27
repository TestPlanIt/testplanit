import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import { TestPlanItClient } from '@testplanit/api';
import type { JUnitResultType, Status } from '@testplanit/api';
import type {
  TestPlanItReporterOptions,
  TrackedTestResult,
  PendingAttachment,
  ReporterState,
  RunAttachmentInput,
} from './types.js';
import {
  applyEnvTemplate,
  guessMimeType,
  isRunLevelAttachment,
  parseRunLevelAttachment,
  runLevelOpKey,
  type RunLevelOp,
} from './runLevel.js';

// Matches ANSI escape sequences (CSI ... final byte). Built from \u001b
// string escapes so the source file stays free of literal control characters.
const ANSI_PATTERN = new RegExp(
  '[\\u001b\\u009b][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]',
  'g',
);

/** Remove ANSI escape codes (Playwright colourises error messages and stdout). */
function stripAnsi(input: string | undefined): string | undefined {
  if (!input) return input;
  return input.replace(ANSI_PATTERN, '');
}

/**
 * Environment variable holding the ID of a test run created by the pipeline.
 * Every execution that sees it attaches to that run instead of creating one,
 * which is how a suite split across shards, machines or retry waves lands in a
 * single run.
 */
export const RUN_ID_ENV_VAR = 'TESTPLANIT_RUN_ID';

/** Playwright attaches no error to a `test.fail()` test that passed, so the reporter supplies one. */
const UNEXPECTED_PASS_MESSAGE = 'Expected to fail, but passed.';

/** Suite name used per execution when the run is pinned by the pipeline. */
const EXTERNALLY_MANAGED_SUITE_NAME = '{suite} - {browser}/{platform} - {spec}';

/**
 * Parse a test run ID from an environment variable. Anything that isn't a
 * positive integer is ignored, so an unset or templated-but-unresolved variable
 * falls through to the reporter's normal run resolution.
 */
function parseEnvTestRunId(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : undefined;
}

/**
 * Playwright reporter for TestPlanIt.
 *
 * Reports test results directly to your TestPlanIt instance. Mirrors the
 * behaviour of `@testplanit/wdio-reporter`.
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
 */
export default class TestPlanItReporter implements Reporter {
  private client: TestPlanItClient;
  private options: TestPlanItReporterOptions;
  private state: ReporterState;

  /** Memoized initialization (create test run, fetch statuses). */
  private initPromise: Promise<void> | null = null;
  /** Memoized JUnit suite creation. */
  private suitePromise: Promise<void> | null = null;
  /** In-flight result-reporting / upload operations awaited in onEnd. */
  private pendingOperations: Set<Promise<void>> = new Set();
  private reportedResultCount = 0;

  /** Run-name placeholder context, captured from reported tests. */
  private currentSpec?: string;
  private currentProject?: string;
  private rootSuiteName?: string;
  /** Shard this process is running, from Playwright's `--shard` (onBegin). */
  private shard?: { current: number; total: number };

  /**
   * When true, the run was created outside this reporter — pinned by the
   * `testRunId` option or the `TESTPLANIT_RUN_ID` environment variable. The
   * reporter attaches results to it but never creates, mutates or completes it.
   */
  private externallyManaged = false;

  /**
   * `runAttachments` entries whose file couldn't be read at initialization
   * (typically artifacts produced by the tests themselves). Retried once in
   * onEnd, before the run is completed.
   */
  private deferredRunAttachments: RunAttachmentInput[] = [];
  /**
   * Keys of runtime run-level ops already applied this session, so retried
   * tests (which re-run their attachToRun/setRunMetadata calls) don't create
   * duplicate run attachments.
   */
  private appliedRunOps = new Set<string>();
  /** Result kinds already warned about for having no status in the project. */
  private warnedNoStatus = new Set<string>();

  constructor(options: TestPlanItReporterOptions) {
    this.options = {
      caseIdPattern: /\[(\d+)\]/g,
      caseIdAnnotation: 'testplanit',
      autoCreateTestCases: false,
      captureSteps: true,
      overwriteSteps: false,
      createFolderHierarchy: false,
      uploadAttachments: true,
      includeStackTrace: true,
      excludeSkipped: false,
      completeRunOnFinish: true,
      timeout: 30000,
      maxRetries: 3,
      verbose: false,
      ...options,
    };

    if (!this.options.domain) {
      throw new Error('TestPlanIt reporter: domain is required');
    }
    if (!this.options.apiToken) {
      throw new Error('TestPlanIt reporter: apiToken is required');
    }
    if (!this.options.projectId) {
      throw new Error('TestPlanIt reporter: projectId is required');
    }

    this.client = new TestPlanItClient({
      baseUrl: this.options.domain,
      apiToken: this.options.apiToken,
      timeout: this.options.timeout,
      maxRetries: this.options.maxRetries,
    });

    // Pin the run when its ID is known up front. A name given as `testRunId` is
    // resolved later, during initialization, since it needs an API call.
    let pinnedTestRunId: number | undefined;
    if (typeof this.options.testRunId === 'number') {
      pinnedTestRunId = this.options.testRunId;
      this.markExternallyManaged(`the testRunId option (${pinnedTestRunId})`);
    } else {
      const envTestRunId = parseEnvTestRunId(process.env[RUN_ID_ENV_VAR]);
      if (envTestRunId !== undefined) {
        pinnedTestRunId = envTestRunId;
        this.markExternallyManaged(`${RUN_ID_ENV_VAR}=${pinnedTestRunId}`);
      }
    }

    this.state = {
      testRunId: pinnedTestRunId,
      resolvedIds: {},
      results: new Map(),
      caseIdMap: new Map(),
      testRunCaseMap: new Map(),
      caseStepsMap: new Map(),
      folderPathMap: new Map(),
      caseAutomatedMap: new Map(),
      caseTagsMap: new Map(),
      tagIdMap: new Map(),
      statusIds: {},
      initialized: false,
      stats: {
        testCasesFound: 0,
        testCasesCreated: 0,
        testCasesMoved: 0,
        testStepsCreated: 0,
        caseTagsAdded: 0,
        caseTagsRemoved: 0,
        foldersCreated: 0,
        resultsPassed: 0,
        resultsFailed: 0,
        resultsSkipped: 0,
        expectedFailures: 0,
        attachmentsUploaded: 0,
        attachmentsFailed: 0,
        apiErrors: 0,
        startTime: new Date(),
      },
    };
  }

  /** Tell Playwright this reporter writes to stdout (summary + warnings). */
  printsToStdio(): boolean {
    return true;
  }

  /**
   * Record that the run belongs to the pipeline rather than this execution.
   * Completion is disabled so one shard cannot close a run that other shards,
   * machines or retry waves are still reporting into.
   */
  private markExternallyManaged(source: string): void {
    this.externallyManaged = true;
    if (this.options.completeRunOnFinish) {
      this.options.completeRunOnFinish = false;
      this.log(
        `Test run pinned by ${source} — completeRunOnFinish disabled; the pipeline completes the run`,
      );
    }
  }

  private log(message: string, ...args: unknown[]): void {
    if (this.options.verbose) {
      console.log(`[TestPlanIt] ${message}`, ...args);
    }
  }

  private logError(message: string, error?: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error ?? '');
    const stack = error instanceof Error && error.stack ? `\n${error.stack}` : '';
    console.error(`[TestPlanIt] ERROR: ${message}`, errorMsg, stack);
  }

  /**
   * Track an async operation so onEnd waits for it to complete.
   */
  private trackOperation(operation: Promise<void>): void {
    this.pendingOperations.add(operation);
    operation.finally(() => {
      this.pendingOperations.delete(operation);
    });
  }

  // ============================================================================
  // Playwright Reporter hooks
  // ============================================================================

  onBegin(config: FullConfig, _suite: Suite): void {
    this.log('Reporter started');
    this.log(`  Domain: ${this.options.domain}`);
    this.log(`  Project ID: ${this.options.projectId}`);
    if (config.shard) {
      this.shard = config.shard;
      this.log(`  Shard: ${config.shard.current}/${config.shard.total}`);
    }
    // Initialization is deferred until the first reportable result so specs
    // with no matching tests don't create empty test runs.
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // test.fail() sets expectedStatus to 'failed': failing is expected, passing is a failure.
    const expectedFailure = result.status === 'failed' && test.expectedStatus === 'failed';
    const unexpectedPass = result.status === 'passed' && test.expectedStatus === 'failed';
    const status = unexpectedPass ? 'failed' : this.normalizeStatus(result.status);
    const { caseIds: titleIds, cleanTitle } = this.parseCaseIds(test.title);
    // Link via annotations (recommended), tags, or the title — combined + deduped.
    const caseIds = [
      ...new Set([
        ...this.getAnnotationCaseIds(test, result),
        ...this.getTagCaseIds(test),
        ...titleIds,
      ]),
    ];
    const suitePath = this.getSuitePath(test);
    const suiteName = suitePath.join(' > ');
    const fullTitle = suiteName ? `${suiteName} > ${cleanTitle}` : cleanTitle;
    const projectName = this.getProjectName(test);
    const specFile = test.location?.file;

    // Capture run-name placeholder context from the reported tests.
    if (specFile) this.currentSpec = specFile;
    if (projectName) this.currentProject = projectName;
    if (!this.rootSuiteName && suitePath.length > 0) this.rootSuiteName = suitePath[0];

    const startedAt = result.startTime ? new Date(result.startTime) : new Date();
    const durationMs = result.duration ?? 0;
    const finishedAt = new Date(startedAt.getTime() + durationMs);

    // We report every attempt, so the UID is unique per (test, retry).
    const uid = `${projectName ?? ''}:${test.id}:${result.retry}`;

    // Capture test.step() titles when they can be used: seeding created cases
    // (captureSteps) or overwriting existing/linked cases (overwriteSteps).
    const wantSteps =
      (this.options.autoCreateTestCases === true && this.options.captureSteps !== false) ||
      this.options.overwriteSteps === true;
    const stepTitles = wantSteps ? this.extractStepTitles(result.steps) : undefined;

    // Capture the test's tags when they can be used: seeding created cases
    // (captureTags) or keeping existing/linked cases in sync (overwriteTags).
    const wantTags =
      (this.options.autoCreateTestCases === true && this.options.captureTags !== false) ||
      this.options.overwriteTags === true;
    const tags = wantTags ? this.extractCaseTags(test) : undefined;

    const tracked: TrackedTestResult = {
      caseId: caseIds[0],
      suiteName,
      suitePath,
      testName: cleanTitle,
      fullTitle,
      originalTitle: test.title,
      status,
      expectedFailure,
      duration: durationMs,
      errorMessage: unexpectedPass ? UNEXPECTED_PASS_MESSAGE : stripAnsi(result.error?.message),
      stackTrace: this.options.includeStackTrace ? stripAnsi(result.error?.stack) : undefined,
      startedAt,
      finishedAt,
      browser: projectName,
      platform: process.platform,
      retryAttempt: result.retry,
      // parallelIndex is the stable 0..workers-1 lane; workerIndex increments
      // on worker restarts and would fragment the timeline.
      worker:
        typeof result.parallelIndex === 'number'
          ? String(result.parallelIndex)
          : undefined,
      uid,
      specFile,
      systemOut: this.joinOutput(result.stdout),
      systemErr: this.joinOutput(result.stderr),
      stepTitles,
      tags,
    };

    this.state.results.set(uid, tracked);
    this.log(
      `Test ${status}:`,
      cleanTitle,
      caseIds.length > 0 ? `(Case IDs: ${caseIds.join(', ')})` : '',
    );

    // Partition off reserved `testplanit:run-*` attachments (produced by the
    // attachToRun/setRunMetadata helpers) — they are run-level operations,
    // never uploaded to the result.
    const attachments: PendingAttachment[] = [];
    for (const a of result.attachments ?? []) {
      const pending: PendingAttachment = {
        name: a.name,
        contentType: a.contentType,
        path: a.path,
        body: a.body,
      };
      if (isRunLevelAttachment(a.name)) {
        const op = parseRunLevelAttachment(pending);
        if (!op) {
          this.logError(`Ignoring malformed run-level attachment "${a.name}"`);
          continue;
        }
        const key = runLevelOpKey(op);
        if (this.appliedRunOps.has(key)) {
          this.log(`Skipping duplicate run-level operation: ${key}`);
          continue;
        }
        this.appliedRunOps.add(key);
        this.trackOperation(this.applyRunLevelOp(op));
        continue;
      }
      attachments.push(pending);
    }

    const reportPromise = this.reportResult(tracked, caseIds, attachments);
    this.trackOperation(reportPromise);
  }

  onError(error: TestError): void {
    // Non-test errors (config/global). Surface in verbose mode only.
    this.log('Playwright reported an error:', stripAnsi(error.message) ?? error.message);
  }

  async onEnd(_result: FullResult): Promise<void> {
    // Nothing tracked and never initialized → silently skip.
    if (this.state.results.size === 0 && !this.initPromise) {
      this.log('No test results to report, skipping');
      return;
    }

    this.log('Run ended, waiting for initialization and pending results...');

    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // Captured in state.initError below.
      }
    }

    // Wait for all in-flight result reports and attachment uploads.
    await Promise.allSettled([...this.pendingOperations]);

    if (this.state.initError) {
      console.error('\n[TestPlanIt] FAILED: Reporter initialization failed');
      console.error(`  Error: ${this.state.initError.message}`);
      console.error('  No results were reported to TestPlanIt.');
      console.error('  Please check your configuration and API connectivity.');
      return;
    }

    if (!this.state.testRunId) {
      this.log('No test run created, skipping summary');
      return;
    }

    // Attach run files that weren't readable at initialization (e.g. reports
    // produced by the tests), before the run is completed.
    await this.applyDeferredRunAttachments();

    if (this.reportedResultCount === 0) {
      this.log('No results were reported to TestPlanIt, skipping summary');
      return;
    }

    if (this.externallyManaged) {
      this.log(`Skipping test run completion (test run ${this.state.testRunId} is managed externally)`);
    } else if (this.options.completeRunOnFinish) {
      try {
        await this.client.completeTestRun(this.state.testRunId, this.options.projectId);
        this.log('Test run completed:', this.state.testRunId);
      } catch (error) {
        this.logError('Failed to complete test run:', error);
      }
    }

    this.printSummary();
  }

  // ============================================================================
  // Reporting
  // ============================================================================

  private async reportResult(
    result: TrackedTestResult,
    caseIds: number[],
    attachments: PendingAttachment[],
  ): Promise<void> {
    try {
      // Checked before any API work so an all-skipped spec never creates a run.
      if (this.options.excludeSkipped && result.status === 'skipped') {
        this.log(`Excluding skipped test (excludeSkipped): ${result.testName}`);
        return;
      }

      // Skip results we can't link before doing any work (avoids empty runs).
      if (caseIds.length === 0 && !this.options.autoCreateTestCases) {
        console.warn(
          `[TestPlanIt] WARNING: Skipping "${result.testName}" - no case ID found and autoCreateTestCases is disabled. ` +
            `Set autoCreateTestCases: true to automatically find or create test cases by name.`,
        );
        return;
      }

      await this.initialize();

      if (!this.state.testRunId) {
        this.logError('No test run ID available, skipping result');
        return;
      }

      await this.ensureJUnitTestSuite();

      if (!this.state.testSuiteId) {
        this.logError('No test suite ID available, skipping result');
        return;
      }

      // Resolve the repository case ID.
      let repositoryCaseId: number | undefined;
      if (caseIds.length > 0) {
        repositoryCaseId = caseIds[0];
        // An explicitly linked case may be manually authored — it is now
        // receiving automated results, so flip it to automated. (The
        // auto-create path handles this inside findOrCreateTestCase.)
        await this.ensureCaseAutomated(repositoryCaseId);
        // Keep an explicitly linked case's steps in sync with the script.
        // (The auto-create path syncs inside resolveAutoCreatedCaseId.)
        if (this.options.overwriteSteps) {
          await this.writeCaseSteps(repositoryCaseId, result.stepTitles, true);
        }
        if (this.options.overwriteTags) {
          await this.writeCaseTags(repositoryCaseId, result.tags, true);
        }
      } else if (this.options.autoCreateTestCases) {
        repositoryCaseId = await this.resolveAutoCreatedCaseId(result);
      }

      if (!repositoryCaseId) {
        this.log('No repository case ID, skipping result');
        return;
      }

      // Ensure the case is part of the run (memoized per case).
      const runCaseKey = `${this.state.testRunId}_${repositoryCaseId}`;
      await this.getTestRunCaseId(runCaseKey, repositoryCaseId);

      const expectedFailureStatus = result.expectedFailure ? this.state.expectedFailureStatus : undefined;
      if (expectedFailureStatus) result.status = expectedFailureStatus.category;
      // Without a status, TestPlanIt classifies the result by its JUnit type.
      const statusId = expectedFailureStatus?.id ?? this.state.statusIds[result.status];
      if (!statusId) this.warnNoStatus(result.status);
      const junitType = this.mapStatusToJUnitType(result.status);

      const junitResult = await this.client.createJUnitTestResult({
        testSuiteId: this.state.testSuiteId,
        repositoryCaseId,
        type: junitType,
        message: result.errorMessage,
        content: result.stackTrace,
        statusId,
        time: result.duration / 1000, // ms → seconds
        executedAt: result.finishedAt,
        file: result.specFile,
        worker: result.worker,
        systemOut: result.systemOut,
        systemErr: result.systemErr,
      });

      result.junitResultId = junitResult.id;
      this.reportedResultCount++;
      this.log('Created JUnit test result:', junitResult.id, '(type:', junitType + ')');

      if (expectedFailureStatus) this.state.stats.expectedFailures++;
      if (result.status === 'failed') {
        this.state.stats.resultsFailed++;
      } else if (result.status === 'skipped') {
        this.state.stats.resultsSkipped++;
      } else {
        this.state.stats.resultsPassed++;
      }

      // Attachments are available immediately in Playwright, so upload inline.
      await this.uploadAttachments(result, attachments);
    } catch (error) {
      this.state.stats.apiErrors++;
      this.logError(`Failed to report result for ${result.testName}:`, error);
    }
  }

  /**
   * Resolve (and cache) the repository case ID for an auto-created test case,
   * creating the folder hierarchy first when enabled.
   */
  private resolveAutoCreatedCaseId(result: TrackedTestResult): Promise<number> {
    const caseKey = this.createCaseKey(result.suiteName, result.testName);
    let promise = this.state.caseIdMap.get(caseKey);
    if (promise) return promise;

    promise = (async () => {
      const templateId = this.state.resolvedIds.templateId;
      if (!this.state.resolvedIds.parentFolderId || !templateId) {
        throw new Error('autoCreateTestCases requires parentFolderId and templateId');
      }

      let folderId = this.state.resolvedIds.parentFolderId;
      if (this.options.createFolderHierarchy && result.suitePath.length > 0) {
        try {
          folderId = await this.getFolderId(result.suitePath);
        } catch (error) {
          // A folder failure must not cost the run a result — file the case
          // under the configured parent folder instead.
          this.logError(
            `Failed to create folder hierarchy "${result.suitePath.join(' > ')}", using parent folder:`,
            error,
          );
        }
      }

      const { testCase, action } = await this.client.findOrCreateTestCase({
        projectId: this.options.projectId,
        folderId,
        templateId,
        name: result.testName,
        className: result.suiteName || undefined,
        source: 'API',
        automated: true,
      });

      if (action === 'created') {
        this.state.stats.testCasesCreated++;
        // Seed authored steps on a freshly created case.
        if (this.options.captureSteps !== false) {
          await this.writeCaseSteps(testCase.id, result.stepTitles, false);
        }
        if (this.options.captureTags !== false) {
          await this.writeCaseTags(testCase.id, result.tags, false);
        }
      } else {
        // 'found' or 'moved' — an existing case. Only touch its steps when
        // overwriteSteps is enabled.
        if (action === 'found') this.state.stats.testCasesFound++;
        else this.state.stats.testCasesMoved++;
        if (this.options.overwriteSteps) {
          await this.writeCaseSteps(testCase.id, result.stepTitles, true);
        }
        if (this.options.overwriteTags) {
          await this.writeCaseTags(testCase.id, result.tags, true);
        }
      }

      this.log(`${action} test case:`, testCase.id, testCase.name, 'in folder:', folderId);
      return testCase.id;
    })();

    this.state.caseIdMap.set(caseKey, promise);
    // Don't poison every test sharing this key if a transient error occurs.
    promise.catch(() => this.state.caseIdMap.delete(caseKey));
    return promise;
  }

  /**
   * Write captured `test.step()` titles as authored steps on a case (memoized
   * so it runs once per case per run). When `replace` is set, the case's
   * existing steps are soft-deleted first — but a test with no captured steps
   * never clears anything, so an existing case is never accidentally emptied.
   *
   * Best-effort: failures are logged but never bubble up, so result reporting
   * is never blocked by step syncing.
   */
  private writeCaseSteps(
    testCaseId: number,
    stepTitles: string[] | undefined,
    replace: boolean,
  ): Promise<void> {
    if (!stepTitles || stepTitles.length === 0) return Promise.resolve();

    let promise = this.state.caseStepsMap.get(testCaseId);
    if (promise) return promise;

    promise = (async () => {
      if (replace) {
        try {
          const removed = await this.client.softDeleteCaseSteps(testCaseId);
          this.log(`Cleared ${removed} existing step(s) on case:`, testCaseId);
        } catch (error) {
          // Don't create new steps on top of un-cleared ones — that would
          // duplicate. Skip the sync for this case and leave it as-is.
          this.logError(
            `Failed to clear existing steps on case ${testCaseId}; skipping step sync:`,
            error,
          );
          return;
        }
      }

      // One batched createMany instead of N creates — keeps the API call
      // count (and rate-limit pressure) low when reporting large suites.
      try {
        const steps = stepTitles.map((step, order) => ({ step, order }));
        await this.client.createSteps({ testCaseId, steps });
        this.state.stats.testStepsCreated += stepTitles.length;
        this.log(`${replace ? 'Replaced' : 'Created'} ${stepTitles.length} step(s) on case:`, testCaseId);
      } catch (error) {
        this.logError(`Failed to create steps on case ${testCaseId}:`, error);
      }
    })();

    this.state.caseStepsMap.set(testCaseId, promise);
    promise.catch(() => this.state.caseStepsMap.delete(testCaseId));
    return promise;
  }

  /**
   * Put the test's tags on a case (memoized so it runs once per case per
   * run). Without `replace` the tags are added to what the case has. With
   * `replace` the case ends up with exactly these tags, so a tag removed in
   * the code is removed from the case, and a test with no tags clears them.
   *
   * Best-effort: failures are logged but never bubble up, so result reporting
   * is never blocked by tag syncing.
   */
  private writeCaseTags(
    testCaseId: number,
    tags: string[] | undefined,
    replace: boolean,
  ): Promise<void> {
    if (!tags) return Promise.resolve();
    if (tags.length === 0 && !replace) return Promise.resolve();

    let promise = this.state.caseTagsMap.get(testCaseId);
    if (promise) return promise;

    promise = (async () => {
      try {
        const tagIds = await Promise.all(tags.map((name) => this.resolveCaseTagId(name)));
        const { added, removed } = await this.client.setTestCaseTags(testCaseId, tagIds, { replace });
        this.state.stats.caseTagsAdded += added;
        this.state.stats.caseTagsRemoved += removed;
        if (added > 0 || removed > 0) {
          this.log(`Tags on case ${testCaseId}: added ${added}, removed ${removed}`);
        }
      } catch (error) {
        this.logError(`Failed to set tags on case ${testCaseId}; continuing:`, error);
      }
    })();

    this.state.caseTagsMap.set(testCaseId, promise);
    return promise;
  }

  /** Resolve (and cache) a tag name to its ID, creating the tag if needed. */
  private resolveCaseTagId(name: string): Promise<number> {
    let promise = this.state.tagIdMap.get(name);
    if (promise) return promise;

    promise = this.client
      .resolveTagIds(this.options.projectId, [name])
      .then((ids) => ids[0]);
    this.state.tagIdMap.set(name, promise);
    // A failed lookup is retried by the next case that uses the tag.
    promise.catch(() => this.state.tagIdMap.delete(name));
    return promise;
  }

  /**
   * Flip an explicitly linked case to `automated: true` when it isn't
   * already, so a case that started manual but now receives automated results
   * reflects that in TestPlanIt. Checked once per case per run (memoized).
   * Skips the write when the case is already automated and never throws — a
   * failure logs and is swallowed so it can't abort reporting the result.
   */
  private ensureCaseAutomated(caseId: number): Promise<void> {
    let promise = this.state.caseAutomatedMap.get(caseId);
    if (promise) return promise;

    promise = (async () => {
      try {
        const testCase = await this.client.getTestCase(caseId);
        if (testCase?.automated === true) return;
        await this.client.updateTestCase(caseId, { automated: true });
        this.log('Flipped case to automated:', caseId);
      } catch (error) {
        this.logError(`Failed to set automated on case ${caseId}; continuing:`, error);
      }
    })();

    this.state.caseAutomatedMap.set(caseId, promise);
    return promise;
  }

  /** Resolve (and cache) the folder ID for a describe path. */
  private getFolderId(suitePath: string[]): Promise<number> {
    const key = suitePath.join(' > ');
    let promise = this.state.folderPathMap.get(key);
    if (promise) return promise;

    promise = this.client
      .findOrCreateFolderPath(this.options.projectId, suitePath, this.state.resolvedIds.parentFolderId)
      .then((folder) => {
        this.log('Created/found folder:', folder.name, '(ID:', folder.id + ')');
        return folder.id;
      });

    this.state.folderPathMap.set(key, promise);
    promise.catch(() => this.state.folderPathMap.delete(key));
    return promise;
  }

  /** Add the case to the run once (memoized per case). */
  private getTestRunCaseId(runCaseKey: string, repositoryCaseId: number): Promise<number> {
    let promise = this.state.testRunCaseMap.get(runCaseKey);
    if (promise) return promise;

    promise = this.client
      .findOrAddTestCaseToRun({ testRunId: this.state.testRunId!, repositoryCaseId })
      .then((testRunCase) => {
        this.log('Added case to run:', testRunCase.id);
        return testRunCase.id;
      })
      .catch((err: unknown) => {
        // A pinned run may have its composition locked (the team froze the
        // case list before dispatching to CI). The result still belongs to
        // the run — TestPlanIt shows it as "not in this run" — so report it
        // rather than dropping it.
        this.log(
          'Could not add case to run (composition locked?); reporting the result anyway:',
          err instanceof Error ? err.message : String(err)
        );
        return 0;
      });

    this.state.testRunCaseMap.set(runCaseKey, promise);
    return promise;
  }

  private async uploadAttachments(
    result: TrackedTestResult,
    attachments: PendingAttachment[],
  ): Promise<void> {
    if (!this.options.uploadAttachments || attachments.length === 0 || !result.junitResultId) {
      return;
    }

    const filtered = attachments.filter((a) => this.attachmentMatches(a));
    if (filtered.length === 0) return;

    const sanitizedTestName = result.testName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const note = this.buildAttachmentNote(result);

    const uploads = filtered.map(async (att) => {
      try {
        const buffer = att.body ?? (att.path ? await fs.readFile(att.path) : undefined);
        if (!buffer || buffer.length === 0) {
          this.log(`Skipping empty attachment "${att.name}" for ${result.testName}`);
          return;
        }

        const baseName = att.path
          ? path.basename(att.path)
          : `${att.name || 'attachment'}${this.extForContentType(att.contentType)}`;
        const fileName = `${sanitizedTestName}_${result.status}_${baseName}`;

        await this.client.uploadJUnitAttachment(
          result.junitResultId!,
          buffer,
          fileName,
          att.contentType || 'application/octet-stream',
          note,
        );
        this.state.stats.attachmentsUploaded++;
        this.log(`Uploaded attachment ${fileName} for ${result.testName}`);
      } catch (error) {
        this.state.stats.attachmentsFailed++;
        this.logError(`Failed to upload attachment "${att.name}":`, error);
      }
    });

    await Promise.allSettled(uploads);
  }

  private attachmentMatches(att: PendingAttachment): boolean {
    const types = this.options.attachmentTypes;
    if (!types || types.length === 0) return true;
    return types.some(
      (t) => att.name === t || (att.contentType ? att.contentType.startsWith(t) : false),
    );
  }

  private buildAttachmentNote(result: TrackedTestResult): string {
    const parts: string[] = [`Test: ${result.testName}`];
    if (result.suiteName) parts.push(`Suite: ${result.suiteName}`);
    parts.push(`Status: ${result.status}`);
    if (result.browser) parts.push(`Browser: ${result.browser}`);
    if (result.errorMessage) {
      const preview =
        result.errorMessage.length > 200
          ? result.errorMessage.substring(0, 200) + '...'
          : result.errorMessage;
      parts.push(`Error: ${preview}`);
    }
    return parts.join('\n');
  }

  // ============================================================================
  // Run-level attachments (links, files, metadata on the run itself)
  // ============================================================================

  /**
   * Apply one runtime run-level operation (from an attachToRun /
   * setRunMetadata call in a test). Initializes the reporter if needed —
   * an explicit run-level call is a reason to create the run. Failures are
   * logged and swallowed; they never fail the test run.
   */
  private async applyRunLevelOp(op: RunLevelOp): Promise<void> {
    try {
      await this.initialize();
      const testRunId = this.state.testRunId;
      if (!testRunId) return;

      switch (op.kind) {
        case 'link': {
          await this.client.addTestRunLink(testRunId, op.url, op.name, op.note);
          this.log(`Attached link to run: ${op.url}`);
          break;
        }
        case 'file': {
          const buffer = op.body ?? (op.path ? await fs.readFile(op.path) : undefined);
          if (!buffer || buffer.length === 0) {
            this.log(`Skipping empty run attachment "${op.name}"`);
            return;
          }
          await this.client.uploadTestRunAttachment(
            testRunId,
            buffer,
            op.name,
            op.contentType || guessMimeType(op.name),
          );
          this.log(`Attached file to run: ${op.name}`);
          break;
        }
        case 'metadata': {
          await this.client.setTestRunMetadata(testRunId, op.metadata);
          this.log(`Set run metadata: ${Object.keys(op.metadata).join(', ')}`);
          break;
        }
      }
    } catch (error) {
      this.logError(`Failed to apply run-level ${op.kind}:`, error);
    }
  }

  /**
   * Apply the declarative run-level options (`runLinks`, `runMetadata`,
   * `runAttachments`) to the just-created test run. Called once from
   * initialization, and only when the reporter created the run itself —
   * appending to an existing run (`testRunId`) skips this so re-runs don't
   * attach duplicates. Every failure is logged and swallowed.
   */
  private async applyRunLevelConfig(): Promise<void> {
    const testRunId = this.state.testRunId;
    if (!testRunId) return;

    // Links (e.g. CI build URL)
    for (const link of this.options.runLinks ?? []) {
      try {
        const url = applyEnvTemplate(link.url ?? '');
        if (url.missing.length > 0 || !url.value.trim()) {
          this.logError(
            `Skipping run link "${link.url}": unresolved environment variable(s) ${url.missing.join(', ') || '(empty url)'}`,
          );
          continue;
        }
        const name = link.name ? applyEnvTemplate(link.name).value.trim() : '';
        const note = link.note ? applyEnvTemplate(link.note).value : undefined;
        await this.client.addTestRunLink(testRunId, url.value, name || undefined, note);
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
            `Skipping run metadata "${rawKey}": unresolved environment variable(s) ${value.missing.join(', ')}`,
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
        await this.client.setTestRunMetadata(testRunId, metadata);
        this.log(`Set run metadata: ${Object.keys(metadata).join(', ')}`);
      } catch (error) {
        this.logError('Failed to set run metadata:', error);
      }
    }

    // File attachments — defer paths that can't be read yet to onEnd
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
              `Skipping run attachment "${attachment.path}": unresolved environment variable(s) ${templatedPath.missing.join(', ')}`,
            );
            continue;
          }
          resolved.path = templatedPath.value;
        }
        const uploaded = await this.uploadRunFile(testRunId, resolved);
        if (!uploaded && resolved.path && !resolved.buffer) {
          // Not readable yet — likely produced by the tests. Retry in onEnd.
          this.log(
            `Run attachment not readable yet, will retry after tests finish: ${resolved.path}`,
          );
          this.deferredRunAttachments.push(resolved);
        }
      } catch (error) {
        this.logError(
          `Failed to attach run file "${attachment.name ?? attachment.path}":`,
          error,
        );
      }
    }
  }

  /**
   * Read and upload one declarative run attachment. Returns false when a
   * path-based entry can't be read (so the caller can defer it); invalid
   * entries are logged and count as handled (true).
   */
  private async uploadRunFile(testRunId: number, input: RunAttachmentInput): Promise<boolean> {
    let buffer: Buffer;
    let name: string;

    if (input.buffer) {
      if (!input.name) {
        this.logError('runAttachments: "name" is required when attaching a buffer');
        return true;
      }
      buffer = input.buffer;
      name = input.name;
    } else if (input.path) {
      try {
        buffer = await fs.readFile(input.path);
      } catch {
        return false;
      }
      name = input.name && input.name.trim() ? input.name : path.basename(input.path);
    } else {
      this.logError('runAttachments: provide a "path" or "buffer"');
      return true;
    }

    const mimeType = input.mimeType ?? guessMimeType(name);
    await this.client.uploadTestRunAttachment(testRunId, buffer, name, mimeType);
    this.log(`Attached file to run: ${name}`);
    return true;
  }

  /**
   * Retry `runAttachments` entries whose file wasn't readable at
   * initialization. Called from onEnd before the run is completed.
   */
  private async applyDeferredRunAttachments(): Promise<void> {
    const testRunId = this.state.testRunId;
    if (!testRunId || this.deferredRunAttachments.length === 0) return;

    for (const attachment of this.deferredRunAttachments) {
      try {
        const uploaded = await this.uploadRunFile(testRunId, attachment);
        if (!uploaded) {
          this.logError(`Run attachment still not readable, skipping: ${attachment.path}`);
        }
      } catch (error) {
        this.logError(
          `Failed to attach run file "${attachment.name ?? attachment.path}":`,
          error,
        );
      }
    }
    this.deferredRunAttachments = [];
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initialize(): Promise<void> {
    if (this.state.initialized) return Promise.resolve();
    if (this.state.initError) return Promise.reject(this.state.initError);
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      this.log('Initializing reporter...');
      await this.resolveOptionIds();

      // Fail fast on misconfigured auto-create before creating an (empty) run.
      if (
        this.options.autoCreateTestCases &&
        (!this.state.resolvedIds.parentFolderId || !this.state.resolvedIds.templateId)
      ) {
        throw new Error('autoCreateTestCases requires parentFolderId and templateId');
      }

      await this.fetchStatusMappings();

      if (this.externallyManaged) {
        // Declarative run-level options are intentionally NOT applied to a run
        // the pipeline owns — every shard would attach duplicates.
        await this.validateExternallyManagedTestRun();
      } else if (!this.state.testRunId) {
        await this.createTestRun();
        this.log(`Created test run with ID: ${this.state.testRunId}`);
        // Apply run-level links, metadata, and file attachments exactly once
        // on the freshly created run. Internally logs and swallows every
        // failure — run-level attachments must never fail the run.
        await this.applyRunLevelConfig();
      }

      this.state.initialized = true;
      this.log('Reporter initialized successfully');
    } catch (error) {
      this.state.initError = error instanceof Error ? error : new Error(String(error));
      this.logError('Failed to initialize reporter:', error);
      throw this.state.initError;
    }
  }

  /**
   * Confirm a pinned run is reachable. A failure here is reported but not fatal:
   * the reporter keeps attaching results to the pinned ID rather than creating a
   * replacement run, which would reintroduce the duplicates pinning prevents.
   */
  private async validateExternallyManagedTestRun(): Promise<void> {
    try {
      const testRun = await this.client.getTestRun(this.state.testRunId!);
      this.log(`Using externally managed test run: ${testRun.name} (ID: ${testRun.id})`);

      if (testRun.isDeleted) {
        this.logError(`Externally managed test run ${testRun.id} is deleted; results may not be visible`);
      } else if (testRun.isCompleted) {
        this.log(`Externally managed test run ${testRun.id} is already completed; still attaching results`);
      }
    } catch (error) {
      this.logError(
        `Could not read externally managed test run ${this.state.testRunId}; still attaching results to it`,
        error,
      );
    }
  }

  private async resolveOptionIds(): Promise<void> {
    const projectId = this.options.projectId;

    // A numeric ID from the option or the environment already pinned the run,
    // so the name lookup is skipped.
    if (typeof this.options.testRunId === 'string' && !this.state.testRunId) {
      const testRun = await this.client.findTestRunByName(projectId, this.options.testRunId);
      if (!testRun) {
        throw new Error(`Test run not found: "${this.options.testRunId}"`);
      }
      this.state.testRunId = testRun.id;
      this.state.resolvedIds.testRunId = testRun.id;
      this.log(`Resolved test run "${this.options.testRunId}" -> ${testRun.id}`);
      this.markExternallyManaged(`the testRunId option ("${this.options.testRunId}")`);
    }

    // Configuration, milestone, workflow state and tags are only read when this
    // reporter creates the run; on a pinned run those values are already set and
    // belong to whoever created it. Folder and template resolution still runs —
    // those drive test case creation, not the run.
    if (this.externallyManaged) {
      this.log('Skipping configuration/milestone/state/tag resolution for externally managed test run');
    } else {
      await this.resolveRunFieldIds();
    }

    if (typeof this.options.parentFolderId === 'string') {
      let folder = await this.client.findFolderByName(projectId, this.options.parentFolderId);
      if (!folder) {
        if (this.options.createFolderHierarchy || this.options.autoCreateTestCases) {
          folder = await this.client.createFolder({ projectId, name: this.options.parentFolderId });
          this.log(`Created parent folder "${this.options.parentFolderId}" -> ${folder.id}`);
        } else {
          throw new Error(`Folder not found: "${this.options.parentFolderId}"`);
        }
      }
      this.state.resolvedIds.parentFolderId = folder.id;
    } else if (typeof this.options.parentFolderId === 'number') {
      this.state.resolvedIds.parentFolderId = this.options.parentFolderId;
    }

    if (typeof this.options.templateId === 'string') {
      const template = await this.client.findTemplateByName(projectId, this.options.templateId);
      if (!template) throw new Error(`Template not found: "${this.options.templateId}"`);
      this.state.resolvedIds.templateId = template.id;
    } else if (typeof this.options.templateId === 'number') {
      this.state.resolvedIds.templateId = this.options.templateId;
    }

  }

  /** Resolve the option names that are only read when creating a test run. */
  private async resolveRunFieldIds(): Promise<void> {
    const projectId = this.options.projectId;

    if (typeof this.options.configId === 'string') {
      const config = await this.client.findConfigurationByName(projectId, this.options.configId);
      if (!config) throw new Error(`Configuration not found: "${this.options.configId}"`);
      this.state.resolvedIds.configId = config.id;
    } else if (typeof this.options.configId === 'number') {
      this.state.resolvedIds.configId = this.options.configId;
    }

    if (typeof this.options.milestoneId === 'string') {
      const milestone = await this.client.findMilestoneByName(projectId, this.options.milestoneId);
      if (!milestone) throw new Error(`Milestone not found: "${this.options.milestoneId}"`);
      this.state.resolvedIds.milestoneId = milestone.id;
    } else if (typeof this.options.milestoneId === 'number') {
      this.state.resolvedIds.milestoneId = this.options.milestoneId;
    }

    if (typeof this.options.stateId === 'string') {
      const state = await this.client.findWorkflowStateByName(projectId, this.options.stateId);
      if (!state) throw new Error(`Workflow state not found: "${this.options.stateId}"`);
      this.state.resolvedIds.stateId = state.id;
    } else if (typeof this.options.stateId === 'number') {
      this.state.resolvedIds.stateId = this.options.stateId;
    }

    if (this.options.tagIds && this.options.tagIds.length > 0) {
      this.state.resolvedIds.tagIds = await this.client.resolveTagIds(projectId, this.options.tagIds);
      this.log(`Resolved tags: ${this.state.resolvedIds.tagIds.join(', ')}`);
    }
  }

  private async fetchStatusMappings(): Promise<void> {
    const statuses: Array<'passed' | 'failed' | 'skipped' | 'blocked'> = ['passed', 'failed', 'skipped', 'blocked'];
    for (const status of statuses) {
      const statusId = await this.client.getStatusId(this.options.projectId, status);
      if (statusId) {
        this.state.statusIds[status] = statusId;
        this.log(`Status mapping: ${status} -> ${statusId}`);
      }
    }
    await this.resolveExpectedFailureStatus();
  }

  private warnNoStatus(kind: TrackedTestResult['status']): void {
    if (this.warnedNoStatus.has(kind)) return;
    this.warnedNoStatus.add(kind);
    console.warn(
      `[TestPlanIt] WARNING: project ${this.options.projectId} has no status for ${kind} results that is enabled ` +
        `and has the Automation scope. They are recorded without a status.`,
    );
  }

  /**
   * Resolve `expectedFailureStatus` to one of the project's statuses. Statuses
   * are admin-defined, so how a result counts comes from the status's flags,
   * never from its name.
   */
  private async resolveExpectedFailureStatus(): Promise<void> {
    const wanted = this.options.expectedFailureStatus;
    if (wanted === undefined || wanted === null || wanted === '') return;

    const statuses = await this.client.getStatuses(this.options.projectId);
    let match: Status | undefined;
    if (typeof wanted === 'number') {
      match = statuses.find((s) => s.id === wanted);
    } else {
      const name = wanted.trim().toLowerCase();
      match = statuses.find((s) => s.name.toLowerCase() === name || s.systemName.toLowerCase() === name);
      if (!match && (name === 'passed' || name === 'failed' || name === 'skipped' || name === 'blocked')) {
        const statusId = this.state.statusIds[name];
        match = statuses.find((s) => s.id === statusId);
      }
    }

    if (!match) {
      console.warn(
        `[TestPlanIt] WARNING: expectedFailureStatus ${JSON.stringify(wanted)} does not match a status of project ` +
          `${this.options.projectId} that is enabled and has the Automation scope. ` +
          `Expected failures will be recorded as failed.`,
      );
      return;
    }

    let category: 'passed' | 'failed' | 'skipped' = 'skipped';
    if (match.isSuccess) category = 'passed';
    else if (match.isFailure) category = 'failed';
    this.state.expectedFailureStatus = { id: match.id, name: match.name, category };
    this.log(`Expected failures will be recorded as "${match.name}" (${match.id})`);
  }

  private async createTestRun(): Promise<void> {
    const runName = this.formatRunName(this.options.runName || '{suite} - {date} {time}');
    const testRunType = this.options.testRunType ?? 'JUNIT';
    this.log('Creating test run:', runName, '(type:', testRunType + ')');

    const testRun = await this.client.createTestRun({
      projectId: this.options.projectId,
      name: runName,
      testRunType,
      configId: this.state.resolvedIds.configId,
      milestoneId: this.state.resolvedIds.milestoneId,
      stateId: this.state.resolvedIds.stateId,
      tagIds: this.state.resolvedIds.tagIds,
    });

    this.state.testRunId = testRun.id;
  }

  private ensureJUnitTestSuite(): Promise<void> {
    if (this.state.testSuiteId) return Promise.resolve();
    if (!this.suitePromise) this.suitePromise = this.createJUnitTestSuite();
    return this.suitePromise;
  }

  private async createJUnitTestSuite(): Promise<void> {
    if (!this.state.testRunId) {
      throw new Error('Cannot create JUnit test suite without a test run ID');
    }
    const suiteName = this.formatRunName(this.resolveTestSuiteNameTemplate());
    this.log('Creating JUnit test suite...');

    const testSuite = await this.client.createJUnitTestSuite({
      testRunId: this.state.testRunId,
      name: suiteName,
      // Suite totals are computed by the backend from JUnitTestResult rows.
      time: 0,
      tests: 0,
      failures: 0,
      errors: 0,
      skipped: 0,
    });

    this.state.testSuiteId = testSuite.id;
    this.log('Created JUnit test suite with ID:', testSuite.id);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private normalizeStatus(status: TestResult['status']): 'passed' | 'failed' | 'skipped' {
    if (status === 'passed') return 'passed';
    if (status === 'skipped') return 'skipped';
    // 'failed' | 'timedOut' | 'interrupted'
    return 'failed';
  }

  private mapStatusToJUnitType(status: 'passed' | 'failed' | 'skipped'): JUnitResultType {
    switch (status) {
      case 'passed':
        return 'PASSED';
      case 'skipped':
        return 'SKIPPED';
      default:
        return 'FAILURE';
    }
  }

  /**
   * Extract case IDs from a test title using the configured pattern.
   * @example "[1761] [1762] should load" -> { caseIds: [1761, 1762], cleanTitle: "should load" }
   */
  private parseCaseIds(title: string): { caseIds: number[]; cleanTitle: string } {
    const pattern = this.options.caseIdPattern || /\[(\d+)\]/g;
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : new RegExp(pattern.source, 'g');
    const caseIds: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(title)) !== null) {
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          caseIds.push(parseInt(match[i], 10));
          break;
        }
      }
      // Guard against zero-width matches causing an infinite loop.
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }

    const cleanTitle = title.replace(regex, '').trim().replace(/\s+/g, ' ');
    return { caseIds, cleanTitle };
  }

  /**
   * Collect case IDs from annotations of the configured type, on the test and
   * the current result. The description holds the ID(s); non-digits are ignored.
   */
  private getAnnotationCaseIds(test: TestCase, result: TestResult): number[] {
    const type = this.options.caseIdAnnotation;
    if (!type) return [];
    const annotations = [...(test.annotations ?? []), ...(result.annotations ?? [])];
    const ids: number[] = [];
    for (const annotation of annotations) {
      if (annotation?.type === type && annotation.description) {
        for (const digits of String(annotation.description).match(/\d+/g) ?? []) {
          ids.push(parseInt(digits, 10));
        }
      }
    }
    return ids;
  }

  /** Collect case IDs from Playwright tags by applying the configured pattern. */
  private getTagCaseIds(test: TestCase): number[] {
    const tags = test.tags ?? [];
    const ids: number[] = [];
    for (const tag of tags) {
      ids.push(...this.parseCaseIds(tag).caseIds);
    }
    return ids;
  }

  /**
   * The test's Playwright tags as case tag names: the leading `@` is dropped,
   * duplicates are removed, and a tag that links the test to a case (it
   * matches `caseIdPattern`) is left out.
   */
  private extractCaseTags(test: TestCase): string[] {
    const names = new Set<string>();
    for (const tag of test.tags ?? []) {
      if (this.parseCaseIds(tag).caseIds.length > 0) continue;
      const name = tag.replace(/^@+/, '').trim();
      if (name) names.add(name);
    }
    return [...names];
  }

  /** Collect the describe-block titles (outermost first) for a test. */
  private getSuitePath(test: TestCase): string[] {
    const titles: string[] = [];
    let suite: Suite | undefined = test.parent;
    while (suite) {
      if (suite.type === 'describe' && suite.title) {
        titles.unshift(suite.title);
      }
      suite = suite.parent;
    }
    return titles;
  }

  /** Resolve the Playwright project name (≈ browser) for a test. */
  private getProjectName(test: TestCase): string | undefined {
    let suite: Suite | undefined = test.parent;
    while (suite) {
      if (suite.type === 'project' && suite.title) return suite.title;
      suite = suite.parent;
    }
    return undefined;
  }

  private joinOutput(chunks: (string | Buffer)[] | undefined): string | undefined {
    if (!chunks || chunks.length === 0) return undefined;
    const text = chunks
      .map((c) => (typeof c === 'string' ? c : c.toString('utf-8')))
      .join('');
    const cleaned = stripAnsi(text);
    return cleaned && cleaned.length > 0 ? cleaned : undefined;
  }

  private createCaseKey(suiteName: string, testName: string): string {
    return `${suiteName}::${testName}`;
  }

  /**
   * Flatten Playwright `test.step()` calls into ordered step titles.
   *
   * Only user steps (`category === 'test.step'`) are kept — auto-instrumented
   * categories (`pw:api`, `expect`, `hook`, `fixture`) are skipped, but we
   * still descend through them so a `test.step()` nested inside one is not
   * lost. Nested user steps are emitted in execution order and prefixed with a
   * depth marker so the hierarchy survives as plain text.
   */
  private extractStepTitles(steps: TestStep[] | undefined, depth = 0): string[] {
    if (!steps || steps.length === 0) return [];

    const titles: string[] = [];
    for (const step of steps) {
      if (step.category === 'test.step') {
        const title = step.title?.trim();
        if (title) {
          titles.push(`${'› '.repeat(depth)}${title}`);
          // A counted step deepens the hierarchy for its children.
          titles.push(...this.extractStepTitles(step.steps, depth + 1));
        } else {
          // Untitled step contributes no row; keep its children at this depth.
          titles.push(...this.extractStepTitles(step.steps, depth));
        }
      } else {
        // Skipped node: descend without consuming a depth level.
        titles.push(...this.extractStepTitles(step.steps, depth));
      }
    }
    return titles;
  }

  /**
   * Template for this execution's JUnit suite name.
   *
   * A pinned run collects a suite per execution, so its default names them by
   * project and spec to tell shards apart. A run this reporter created holds one
   * suite, named after the run.
   */
  private resolveTestSuiteNameTemplate(): string {
    if (this.options.testSuiteName) {
      return this.options.testSuiteName;
    }
    if (this.externallyManaged) {
      return EXTERNALLY_MANAGED_SUITE_NAME;
    }
    return this.options.runName || '{suite} - {date} {time}';
  }

  private formatRunName(template: string): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const browser = this.currentProject || 'unknown';
    const platform = process.platform;
    // Playwright's own --shard, the natural label when one run collects the
    // results of several shards. An unsharded execution ran everything.
    const shard = this.shard ? `${this.shard.current}/${this.shard.total}` : '1/1';

    let spec = 'unknown';
    if (this.currentSpec) {
      const parts = this.currentSpec.split(/[\\/]/);
      spec = parts[parts.length - 1] || 'unknown';
      spec = spec.replace(/\.(spec|test)\.(ts|js|mjs|cjs|tsx|jsx)$/, '');
    }

    const suite = this.rootSuiteName || (spec !== 'unknown' ? spec : 'Tests');

    return template
      .replace('{date}', date)
      .replace('{time}', time)
      .replace('{browser}', browser)
      .replace('{platform}', platform)
      .replace('{spec}', spec)
      .replace('{shard}', shard)
      .replace('{suite}', suite);
  }

  private extForContentType(contentType: string | undefined): string {
    switch (contentType) {
      case 'image/png':
        return '.png';
      case 'image/jpeg':
        return '.jpg';
      case 'image/webp':
        return '.webp';
      case 'video/webm':
        return '.webm';
      case 'application/zip':
        return '.zip';
      case 'text/plain':
        return '.txt';
      case 'application/json':
        return '.json';
      default:
        return '';
    }
  }

  private printSummary(): void {
    const stats = this.state.stats;
    const duration = ((Date.now() - stats.startTime.getTime()) / 1000).toFixed(1);
    const totalResults = stats.resultsPassed + stats.resultsFailed + stats.resultsSkipped;
    const totalCases = stats.testCasesFound + stats.testCasesCreated + stats.testCasesMoved;

    console.log('\n[TestPlanIt] ═══════════════════════════════════════════════════════');
    console.log('[TestPlanIt] Results Summary');
    console.log('[TestPlanIt] ═══════════════════════════════════════════════════════');
    console.log(`[TestPlanIt]   Test Run ID: ${this.state.testRunId}`);
    console.log(`[TestPlanIt]   Duration: ${duration}s`);
    console.log('[TestPlanIt]');
    console.log('[TestPlanIt]   Test Results:');
    console.log(`[TestPlanIt]     ✓ Passed:  ${stats.resultsPassed}`);
    console.log(`[TestPlanIt]     ✗ Failed:  ${stats.resultsFailed}`);
    console.log(`[TestPlanIt]     ○ Skipped: ${stats.resultsSkipped}`);
    console.log(`[TestPlanIt]     Total:     ${totalResults}`);
    if (stats.expectedFailures > 0 && this.state.expectedFailureStatus) {
      console.log(
        `[TestPlanIt]     Expected failures recorded as "${this.state.expectedFailureStatus.name}": ${stats.expectedFailures}`,
      );
    }

    if (this.options.autoCreateTestCases && totalCases > 0) {
      console.log('[TestPlanIt]');
      console.log('[TestPlanIt]   Test Cases:');
      console.log(`[TestPlanIt]     Found (existing): ${stats.testCasesFound}`);
      console.log(`[TestPlanIt]     Created (new):    ${stats.testCasesCreated}`);
      if (stats.testCasesMoved > 0) {
        console.log(`[TestPlanIt]     Moved (restored): ${stats.testCasesMoved}`);
      }
      if (stats.testStepsCreated > 0) {
        console.log(`[TestPlanIt]     Steps created:    ${stats.testStepsCreated}`);
      }
    }

    if (stats.caseTagsAdded > 0 || stats.caseTagsRemoved > 0) {
      console.log('[TestPlanIt]');
      console.log('[TestPlanIt]   Test Case Tags:');
      console.log(`[TestPlanIt]     Added:   ${stats.caseTagsAdded}`);
      console.log(`[TestPlanIt]     Removed: ${stats.caseTagsRemoved}`);
    }

    if (this.options.uploadAttachments && (stats.attachmentsUploaded > 0 || stats.attachmentsFailed > 0)) {
      console.log('[TestPlanIt]');
      console.log('[TestPlanIt]   Attachments:');
      console.log(`[TestPlanIt]     Uploaded: ${stats.attachmentsUploaded}`);
      if (stats.attachmentsFailed > 0) {
        console.log(`[TestPlanIt]     Failed:   ${stats.attachmentsFailed}`);
      }
    }

    if (stats.apiErrors > 0) {
      console.log('[TestPlanIt]');
      console.log(`[TestPlanIt]   ⚠ API Errors: ${stats.apiErrors}`);
    }

    console.log('[TestPlanIt]');
    console.log(
      `[TestPlanIt]   View results: ${this.options.domain}/projects/runs/${this.options.projectId}/${this.state.testRunId}`,
    );
    console.log('[TestPlanIt] ═══════════════════════════════════════════════════════\n');
  }

  /** Expose the internal state (for testing/debugging). */
  getState(): ReporterState {
    return this.state;
  }
}
