import WDIOReporter, { type RunnerStats, type SuiteStats, type TestStats, type AfterCommandArgs, type BeforeCommandArgs } from '@wdio/reporter';
import { TestPlanItClient, automationStepsToCaseSteps } from '@testplanit/api';
import type { NormalizedStatus, JUnitResultType, CaseStepRow, RequestStepDerivationCase } from '@testplanit/api';
import type { TestPlanItReporterOptions, TrackedTestResult, ReporterState } from './types.js';
import { adaptCucumberStepTitles } from './cucumberAdapter.js';
import {
  readSharedState,
  writeSharedStateIfAbsent,
  writeSharedStateForRun,
  deleteSharedState,
  incrementWorkerCount,
  decrementWorkerCount,
  parseEnvTestRunId,
  RUN_ID_ENV_VAR,
} from './shared.js';

/** Suite name used per invocation when the run is pinned by the pipeline. */
const EXTERNALLY_MANAGED_SUITE_NAME = '{suite} - {browser}/{platform} - {spec}';

/**
 * WebdriverIO Reporter for TestPlanIt
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
 */
export default class TestPlanItReporter extends WDIOReporter {
  private client: TestPlanItClient;
  private reporterOptions: TestPlanItReporterOptions;
  private state: ReporterState;
  private currentSuite: string[] = [];
  private initPromise: Promise<void> | null = null;
  private pendingOperations: Set<Promise<void>> = new Set();
  private reportedResultCount = 0;
  private detectedFramework: string | null = null;
  private currentTestUid: string | null = null;
  private currentCid: string | null = null;
  private pendingScreenshots: Map<string, Buffer[]> = new Map();
  /**
   * Low-level automation commands captured per running test uid (via
   * onBeforeCommand), fed to AI step derivation for non-Cucumber tests so the
   * steps reflect what the test actually did. Capped per test to bound payload.
   */
  private testCommands: Map<string, string[]> = new Map();
  private static readonly MAX_COMMANDS_PER_TEST = 100;
  /** Cucumber: accumulated step titles per active scenario suite uid. */
  private pendingScenarioSteps: Map<string, string[]> = new Map();
  /**
   * Non-Cucumber cases (no deterministic steps) collected across the run for a
   * single opt-in, batched LLM step-derivation request at onRunnerEnd. Keyed by
   * testCaseId so a case is requested at most once per run.
   */
  private llmDerivationCases: Map<number, RequestStepDerivationCase> = new Map();
  /** Cucumber: uid of the scenario suite currently open (null outside a scenario). */
  private currentScenarioUid: string | null = null;
  /** Cucumber: in-progress plan for the open scenario, emitted once at onSuiteEnd. */
  private currentScenarioPlan: {
    title: string;
    suiteName: string;
    suitePath: string[];
    cid: string;
    status: 'passed' | 'failed' | 'skipped';
    error?: Error;
    startedAt: Date;
  } | null = null;
  private cucumberStepNoticeLogged = false;
  /** When true, the TestPlanItService manages the test run lifecycle */
  private managedByService = false;
  /**
   * When true, the run was created outside this reporter — pinned by the
   * `testRunId` option or the `TESTPLANIT_RUN_ID` environment variable. The
   * reporter attaches results to it but never creates, mutates or completes it,
   * and never falls back to a different run.
   */
  private externallyManaged = false;

  /**
   * WebdriverIO uses this getter to determine if the reporter has finished async operations.
   * The test runner will wait for this to return true before terminating.
   */
  get isSynchronised(): boolean {
    return this.pendingOperations.size === 0;
  }

  constructor(options: TestPlanItReporterOptions) {
    super(options);

    this.reporterOptions = {
      caseIdPattern: /\[(\d+)\]/g,
      autoCreateTestCases: false,
      captureSteps: true,
      overwriteSteps: false,
      createFolderHierarchy: false,
      uploadScreenshots: true,
      includeStackTrace: true,
      excludeSkipped: false,
      completeRunOnFinish: true,
      oneReport: true,
      timeout: 30000,
      maxRetries: 3,
      verbose: false,
      ...options,
    };

    // Validate required options
    if (!this.reporterOptions.domain) {
      throw new Error('TestPlanIt reporter: domain is required');
    }
    if (!this.reporterOptions.apiToken) {
      throw new Error('TestPlanIt reporter: apiToken is required');
    }
    if (!this.reporterOptions.projectId) {
      throw new Error('TestPlanIt reporter: projectId is required');
    }

    // Initialize API client
    this.client = new TestPlanItClient({
      baseUrl: this.reporterOptions.domain,
      apiToken: this.reporterOptions.apiToken,
      timeout: this.reporterOptions.timeout,
      maxRetries: this.reporterOptions.maxRetries,
    });

    // Pin the run when its ID is known up front. A name given as `testRunId` is
    // resolved later, during initialization, since it needs an API call.
    let pinnedTestRunId: number | undefined;
    if (typeof this.reporterOptions.testRunId === 'number') {
      pinnedTestRunId = this.reporterOptions.testRunId;
      this.markExternallyManaged(`the testRunId option (${pinnedTestRunId})`);
    } else {
      const envTestRunId = parseEnvTestRunId(process.env[RUN_ID_ENV_VAR]);
      if (envTestRunId !== undefined) {
        pinnedTestRunId = envTestRunId;
        this.markExternallyManaged(`${RUN_ID_ENV_VAR}=${pinnedTestRunId}`);
      }
    }

    // Initialize state - testRunId will be resolved during initialization
    this.state = {
      testRunId: pinnedTestRunId,
      resolvedIds: {},
      results: new Map(),
      caseIdMap: new Map(),
      testRunCaseMap: new Map(),
      customFieldCaseMap: new Map(),
      folderPathMap: new Map(),
      caseStepsMap: new Map(),
      statusIds: {},
      initialized: false,
      stats: {
        testCasesFound: 0,
        testCasesCreated: 0,
        testCasesMoved: 0,
        foldersCreated: 0,
        testStepsCreated: 0,
        resultsPassed: 0,
        resultsFailed: 0,
        resultsSkipped: 0,
        screenshotsUploaded: 0,
        screenshotsFailed: 0,
        apiErrors: 0,
        apiRequests: 0,
        startTime: new Date(),
      },
    };
  }

  /**
   * Record that the run belongs to the pipeline rather than this invocation.
   * Completion is disabled so one shard cannot close a run that other shards,
   * agents or retry waves are still reporting into.
   */
  private markExternallyManaged(source: string): void {
    this.externallyManaged = true;
    if (this.reporterOptions.completeRunOnFinish) {
      this.reporterOptions.completeRunOnFinish = false;
      this.log(
        `Test run pinned by ${source} — completeRunOnFinish disabled; the pipeline completes the run`
      );
    }
  }

  /**
   * Log a message if verbose mode is enabled
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.reporterOptions.verbose) {
      console.log(`[TestPlanIt] ${message}`, ...args);
    }
  }

  /**
   * Log an error (always logs, not just in verbose mode)
   */
  private logError(message: string, error?: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error ?? '');
    const stack = error instanceof Error && error.stack ? `\n${error.stack}` : '';
    console.error(`[TestPlanIt] ERROR: ${message}`, errorMsg, stack);
  }

  /**
   * Track an async operation to prevent the runner from terminating early.
   * The operation is added to pendingOperations and removed when complete.
   * WebdriverIO checks isSynchronised and waits until all operations finish.
   */
  private trackOperation(operation: Promise<void>): void {
    this.pendingOperations.add(operation);
    operation.finally(() => {
      this.pendingOperations.delete(operation);
    });
  }

  /**
   * Decide whether to write a Cucumber scenario's captured steps to its case,
   * and write them via the shared mapper. No-op for non-Cucumber frameworks
   * (D-09). Writes on fresh create when captureSteps is on (D-04), or replaces
   * existing steps when overwriteSteps is on (D-05).
   */
  private async writeScenarioSteps(
    testCaseId: number,
    action: 'found' | 'created' | 'moved',
    result: TrackedTestResult,
  ): Promise<void> {
    if (this.detectedFramework !== 'cucumber') return;
    const titles = result.cucumberStepTitles;
    if (!titles || titles.length === 0) return;
    const rows = automationStepsToCaseSteps(adaptCucumberStepTitles(titles));
    if (action === 'created' && this.reporterOptions.captureSteps !== false) {
      await this.writeCaseSteps(testCaseId, rows, false);
    } else if (this.reporterOptions.overwriteSteps) {
      await this.writeCaseSteps(testCaseId, rows, true);
    }
  }

  /**
   * For NON-Cucumber frameworks (Mocha/Jasmine — no deterministic steps),
   * collect a case for opt-in, server-side LLM step derivation. Gated by
   * `captureSteps` (the general "populate steps" switch). A newly created
   * stepless case is always eligible; an existing/matched case is only eligible
   * when `overwriteSteps` is on (destructive re-derive). The actual request is
   * batched and sent once at onRunnerEnd; the server is inert if the project has
   * no LLM provider configured.
   */
  private collectForLlmDerivation(
    testCaseId: number,
    action: 'found' | 'created' | 'moved',
    result: TrackedTestResult,
  ): void {
    if (this.detectedFramework === 'cucumber') return;
    if (this.reporterOptions.captureSteps === false) return;
    const eligible =
      action === 'created' || this.reporterOptions.overwriteSteps === true;
    if (!eligible) return;
    this.llmDerivationCases.set(testCaseId, {
      testCaseId,
      name: result.testName,
      className: result.suiteName || null,
      failure: result.errorMessage || null,
      systemOut: null,
      ...(result.commands && result.commands.length > 0
        ? { commands: result.commands }
        : {}),
    });
  }

  /**
   * Send the single batched LLM step-derivation request for the non-Cucumber
   * cases collected this run. Called once at onRunnerEnd. Provider-gated +
   * inert server-side when no LLM provider is configured; wrapped so a failure
   * never affects the run.
   */
  private async requestLlmDerivation(): Promise<void> {
    if (this.llmDerivationCases.size === 0) return;
    if (!this.state.testRunId || !this.reporterOptions.projectId) return;
    const cases = [...this.llmDerivationCases.values()];
    this.llmDerivationCases.clear();
    try {
      const { enqueued } = await this.client.requestStepDerivation({
        projectId: this.reporterOptions.projectId,
        testRunId: this.state.testRunId,
        overwrite: this.reporterOptions.overwriteSteps === true,
        cases,
      });
      if (enqueued) {
        this.log(
          `Requested AI step derivation for ${cases.length} low-structure case(s).`,
        );
      }
    } catch (error) {
      this.logError('Failed to request AI step derivation', error);
    }
  }

  /**
   * Write derived case Steps for a case (ported from the Playwright reporter).
   * Dedups in-flight writes per case id; when `replace` is set, soft-deletes
   * existing steps first and SKIPS the create if the delete fails (never-clobber
   * guard, CORE-01). Passes `CaseStepRow[]` directly to `createSteps` so the
   * mapper's `expectedResult` is preserved (D-06).
   */
  private writeCaseSteps(
    testCaseId: number,
    caseStepRows: CaseStepRow[] | undefined,
    replace: boolean,
  ): Promise<void> {
    if (!caseStepRows || caseStepRows.length === 0) return Promise.resolve();

    const existing = this.state.caseStepsMap.get(testCaseId);
    if (existing) return existing;

    const promise = (async () => {
      if (replace) {
        try {
          const removed = await this.client.softDeleteCaseSteps(testCaseId);
          this.log(`Cleared ${removed} existing step(s) on case:`, testCaseId);
        } catch (error) {
          this.logError(`Failed to clear existing steps on case ${testCaseId}; skipping step write`, error);
          return;
        }
      }
      try {
        await this.client.createSteps({ testCaseId, steps: caseStepRows });
        this.state.stats.testStepsCreated += caseStepRows.length;
        this.log(`Wrote ${caseStepRows.length} step(s) to case:`, testCaseId);
      } catch (error) {
        this.logError(`Failed to create steps on case ${testCaseId}`, error);
      }
    })();

    this.state.caseStepsMap.set(testCaseId, promise);
    promise.catch(() => this.state.caseStepsMap.delete(testCaseId));
    return promise;
  }

  /**
   * Initialize the reporter (create test run, fetch statuses)
   */
  private async initialize(): Promise<void> {
    // If already initialized successfully, return immediately
    if (this.state.initialized) return;

    // If we have a previous error, throw it again to prevent retrying
    if (this.state.initError) {
      throw this.state.initError;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Log initialization start (only happens when we have results to report)
      this.log('Initializing reporter...');
      this.log(`  Domain: ${this.reporterOptions.domain}`);
      this.log(`  Project ID: ${this.reporterOptions.projectId}`);
      this.log(`  oneReport: ${this.reporterOptions.oneReport}`);

      // Resolve any string IDs to numeric IDs
      this.log('Resolving option IDs...');
      await this.resolveOptionIds();

      // Fetch status mappings
      this.log('Fetching status mappings...');
      await this.fetchStatusMappings();

      // Handle oneReport mode - check for existing shared state.
      // An externally managed run is never replaced by shared state, and never
      // discarded by the "start fresh" recovery paths below.
      if (this.reporterOptions.oneReport && !this.state.testRunId && !this.externallyManaged) {
        const sharedState = readSharedState(this.reporterOptions.projectId);
        if (sharedState) {
          if (sharedState.managedByService) {
            // Service manages the run — just use the IDs, skip all lifecycle management
            this.state.testRunId = sharedState.testRunId;
            this.state.testSuiteId = sharedState.testSuiteId;
            this.managedByService = true;
            this.log(`Using service-managed test run: ${sharedState.testRunId}`);
          } else {
            // Legacy oneReport mode — validate and join the existing run
            this.state.testRunId = sharedState.testRunId;
            this.state.testSuiteId = sharedState.testSuiteId;
            this.log(`Using shared test run from file: ${sharedState.testRunId}`);

            // In legacy mode, skip runs where all workers have finished
            if (sharedState.activeWorkers === 0) {
              this.log('Previous test run completed (activeWorkers=0), starting fresh');
              deleteSharedState(this.reporterOptions.projectId);
              this.state.testRunId = undefined;
              this.state.testSuiteId = undefined;
            } else {
              // Validate the shared test run still exists, is not completed, and is not deleted
              try {
                const testRun = await this.client.getTestRun(this.state.testRunId);
                if (testRun.isDeleted) {
                  this.log(`Shared test run ${testRun.id} is deleted, starting fresh`);
                  this.state.testRunId = undefined;
                  this.state.testSuiteId = undefined;
                  deleteSharedState(this.reporterOptions.projectId);
                } else if (testRun.isCompleted) {
                  this.log(`Shared test run ${testRun.id} is already completed, starting fresh`);
                  this.state.testRunId = undefined;
                  this.state.testSuiteId = undefined;
                  deleteSharedState(this.reporterOptions.projectId);
                } else {
                  this.log(`Validated shared test run: ${testRun.name} (ID: ${testRun.id})`);
                  incrementWorkerCount(this.reporterOptions.projectId);
                }
              } catch {
                this.log('Shared test run no longer exists, will create new one');
                this.state.testRunId = undefined;
                this.state.testSuiteId = undefined;
                deleteSharedState(this.reporterOptions.projectId);
              }
            }
          }
        }
      }

      // Create or validate test run (skip if service-managed)
      if (this.externallyManaged) {
        await this.validateExternallyManagedTestRun();
      } else if (!this.state.testRunId && !this.managedByService) {
        // In oneReport mode, use atomic write to prevent race conditions
        if (this.reporterOptions.oneReport) {
          // Create the test run first
          await this.createTestRun();
          this.log(`Created test run with ID: ${this.state.testRunId}`);

          // Try to write shared state - first writer wins
          const finalState = writeSharedStateIfAbsent(this.reporterOptions.projectId, {
            testRunId: this.state.testRunId!,
            testSuiteId: this.state.testSuiteId,
            createdAt: new Date().toISOString(),
            activeWorkers: 1,
          });

          // Check if another worker wrote first
          if (finalState && finalState.testRunId !== this.state.testRunId) {
            this.log(`Another worker created test run first, switching from ${this.state.testRunId} to ${finalState.testRunId}`);
            this.state.testRunId = finalState.testRunId;
            this.state.testSuiteId = finalState.testSuiteId;
          }
        } else {
          await this.createTestRun();
          this.log(`Created test run with ID: ${this.state.testRunId}`);
        }
      } else if (this.state.testRunId && !this.reporterOptions.oneReport && !this.managedByService) {
        // Validate existing test run (only when not using oneReport or service)
        try {
          const testRun = await this.client.getTestRun(this.state.testRunId);
          this.log(`Using existing test run: ${testRun.name} (ID: ${testRun.id})`);
        } catch (error) {
          throw new Error(`Test run ${this.state.testRunId} not found or not accessible`);
        }
      }

      this.state.initialized = true;
      this.log('Reporter initialized successfully');
    } catch (error) {
      this.state.initError = error instanceof Error ? error : new Error(String(error));
      this.logError('Failed to initialize reporter:', error);
      throw error;
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
        error
      );
    }
  }

  /**
   * Resolve option names to numeric IDs
   */
  private async resolveOptionIds(): Promise<void> {
    const projectId = this.reporterOptions.projectId;

    // Resolve testRunId if it's a string. A numeric ID from the option or the
    // environment already pinned the run, so the name lookup is skipped.
    if (typeof this.reporterOptions.testRunId === 'string' && !this.state.testRunId) {
      const testRun = await this.client.findTestRunByName(projectId, this.reporterOptions.testRunId);
      if (!testRun) {
        throw new Error(`Test run not found: "${this.reporterOptions.testRunId}"`);
      }
      this.state.testRunId = testRun.id;
      this.state.resolvedIds.testRunId = testRun.id;
      this.log(`Resolved test run "${this.reporterOptions.testRunId}" -> ${testRun.id}`);
      this.markExternallyManaged(`the testRunId option ("${this.reporterOptions.testRunId}")`);
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

    // Resolve parentFolderId if it's a string
    if (typeof this.reporterOptions.parentFolderId === 'string') {
      let folder = await this.client.findFolderByName(projectId, this.reporterOptions.parentFolderId);
      if (!folder) {
        // If createFolderHierarchy is enabled, create the parent folder
        if (this.reporterOptions.createFolderHierarchy) {
          this.log(`Parent folder "${this.reporterOptions.parentFolderId}" not found, creating it...`);
          folder = await this.client.createFolder({
            projectId,
            name: this.reporterOptions.parentFolderId,
          });
          this.log(`Created parent folder "${this.reporterOptions.parentFolderId}" -> ${folder.id}`);
        } else {
          throw new Error(`Folder not found: "${this.reporterOptions.parentFolderId}"`);
        }
      }
      this.state.resolvedIds.parentFolderId = folder.id;
      this.log(`Resolved folder "${this.reporterOptions.parentFolderId}" -> ${folder.id}`);
    } else if (typeof this.reporterOptions.parentFolderId === 'number') {
      this.state.resolvedIds.parentFolderId = this.reporterOptions.parentFolderId;
    }

    // Resolve templateId if it's a string
    if (typeof this.reporterOptions.templateId === 'string') {
      const template = await this.client.findTemplateByName(projectId, this.reporterOptions.templateId);
      if (!template) {
        throw new Error(`Template not found: "${this.reporterOptions.templateId}"`);
      }
      this.state.resolvedIds.templateId = template.id;
      this.log(`Resolved template "${this.reporterOptions.templateId}" -> ${template.id}`);
    } else if (typeof this.reporterOptions.templateId === 'number') {
      this.state.resolvedIds.templateId = this.reporterOptions.templateId;
    }

  }

  /**
   * Resolve the option names that are only read when creating a test run.
   */
  private async resolveRunFieldIds(): Promise<void> {
    const projectId = this.reporterOptions.projectId;

    // Resolve configId if it's a string
    if (typeof this.reporterOptions.configId === 'string') {
      const config = await this.client.findConfigurationByName(projectId, this.reporterOptions.configId);
      if (!config) {
        throw new Error(`Configuration not found: "${this.reporterOptions.configId}"`);
      }
      this.state.resolvedIds.configId = config.id;
      this.log(`Resolved configuration "${this.reporterOptions.configId}" -> ${config.id}`);
    } else if (typeof this.reporterOptions.configId === 'number') {
      this.state.resolvedIds.configId = this.reporterOptions.configId;
    }

    // Resolve milestoneId if it's a string
    if (typeof this.reporterOptions.milestoneId === 'string') {
      const milestone = await this.client.findMilestoneByName(projectId, this.reporterOptions.milestoneId);
      if (!milestone) {
        throw new Error(`Milestone not found: "${this.reporterOptions.milestoneId}"`);
      }
      this.state.resolvedIds.milestoneId = milestone.id;
      this.log(`Resolved milestone "${this.reporterOptions.milestoneId}" -> ${milestone.id}`);
    } else if (typeof this.reporterOptions.milestoneId === 'number') {
      this.state.resolvedIds.milestoneId = this.reporterOptions.milestoneId;
    }

    // Resolve stateId if it's a string
    if (typeof this.reporterOptions.stateId === 'string') {
      const state = await this.client.findWorkflowStateByName(projectId, this.reporterOptions.stateId);
      if (!state) {
        throw new Error(`Workflow state not found: "${this.reporterOptions.stateId}"`);
      }
      this.state.resolvedIds.stateId = state.id;
      this.log(`Resolved workflow state "${this.reporterOptions.stateId}" -> ${state.id}`);
    } else if (typeof this.reporterOptions.stateId === 'number') {
      this.state.resolvedIds.stateId = this.reporterOptions.stateId;
    }

    // Resolve tagIds if they contain strings
    if (this.reporterOptions.tagIds && this.reporterOptions.tagIds.length > 0) {
      this.state.resolvedIds.tagIds = await this.client.resolveTagIds(projectId, this.reporterOptions.tagIds);
      this.log(`Resolved tags: ${this.state.resolvedIds.tagIds.join(', ')}`);
    }
  }

  /**
   * Fetch status ID mappings from TestPlanIt
   */
  private async fetchStatusMappings(): Promise<void> {
    const statuses: NormalizedStatus[] = ['passed', 'failed', 'skipped', 'blocked'];

    for (const status of statuses) {
      const statusId = await this.client.getStatusId(this.reporterOptions.projectId, status);
      if (statusId) {
        this.state.statusIds[status] = statusId;
        this.log(`Status mapping: ${status} -> ${statusId}`);
      }
    }

    if (!this.state.statusIds.passed || !this.state.statusIds.failed) {
      throw new Error('Could not find required status mappings (passed/failed) in TestPlanIt');
    }
  }

  /**
   * Map test status to JUnit result type
   */
  private mapStatusToJUnitType(status: 'passed' | 'failed' | 'skipped' | 'pending'): JUnitResultType {
    switch (status) {
      case 'passed':
        return 'PASSED';
      case 'failed':
        return 'FAILURE';
      case 'skipped':
      case 'pending':
        return 'SKIPPED';
      default:
        return 'FAILURE';
    }
  }

  /**
   * Create the JUnit test suite for this test run
   */
  private async createJUnitTestSuite(): Promise<void> {
    if (this.state.testSuiteId) {
      return; // Already created (either from shared state or previous call)
    }

    if (!this.state.testRunId) {
      throw new Error('Cannot create JUnit test suite without a test run ID');
    }

    // In oneReport mode, check if another worker has already created a suite.
    // The state file is keyed by project, so a suite recorded by an earlier
    // invocation can belong to a different run — only adopt a matching one.
    if (this.reporterOptions.oneReport) {
      const sharedState = readSharedState(this.reporterOptions.projectId);
      if (sharedState?.testSuiteId && sharedState.testRunId === this.state.testRunId) {
        this.state.testSuiteId = sharedState.testSuiteId;
        this.log('Using shared JUnit test suite from file:', sharedState.testSuiteId);
        return;
      }
    }

    const suiteName = this.formatRunName(this.resolveTestSuiteNameTemplate());

    this.log('Creating JUnit test suite...');

    const testSuite = await this.client.createJUnitTestSuite({
      testRunId: this.state.testRunId,
      name: suiteName,
      time: 0, // Will be updated incrementally
      tests: 0,
      failures: 0,
      errors: 0,
      skipped: 0,
    });

    this.state.testSuiteId = testSuite.id;
    this.log('Created JUnit test suite with ID:', testSuite.id);

    // Update shared state with suite ID if in oneReport mode, so the other
    // workers of this invocation report into the same suite
    if (this.reporterOptions.oneReport) {
      const nextState = {
        testRunId: this.state.testRunId,
        testSuiteId: this.state.testSuiteId,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      };
      const finalState = this.externallyManaged
        ? writeSharedStateForRun(this.reporterOptions.projectId, nextState)
        : writeSharedStateIfAbsent(this.reporterOptions.projectId, nextState);

      // Check if another worker wrote first — use their suite
      if (finalState && finalState.testSuiteId !== this.state.testSuiteId) {
        this.log(`Another worker created test suite first, switching from ${this.state.testSuiteId} to ${finalState.testSuiteId}`);
        this.state.testSuiteId = finalState.testSuiteId;
      }
    }
  }

  /**
   * Map WebdriverIO framework name to TestPlanIt test run type
   */
  private getTestRunType(): TestPlanItReporterOptions['testRunType'] {
    // If explicitly set by user, use that
    if (this.reporterOptions.testRunType) {
      return this.reporterOptions.testRunType;
    }

    // Auto-detect from WebdriverIO framework config
    if (this.detectedFramework) {
      const framework = this.detectedFramework.toLowerCase();
      if (framework === 'mocha') return 'MOCHA';
      if (framework === 'cucumber') return 'CUCUMBER';
      // jasmine and others map to REGULAR
      return 'REGULAR';
    }

    // Default fallback
    return 'MOCHA';
  }

  /**
   * Create a new test run
   */
  private async createTestRun(): Promise<void> {
    const runName = this.formatRunName(this.reporterOptions.runName || '{suite} - {date} {time}');
    const testRunType = this.getTestRunType();

    this.log('Creating test run:', runName, '(type:', testRunType + ')');

    const testRun = await this.client.createTestRun({
      projectId: this.reporterOptions.projectId,
      name: runName,
      testRunType,
      configId: this.state.resolvedIds.configId,
      milestoneId: this.state.resolvedIds.milestoneId,
      stateId: this.state.resolvedIds.stateId,
      tagIds: this.state.resolvedIds.tagIds,
    });

    this.state.testRunId = testRun.id;
    this.log('Created test run with ID:', testRun.id);
  }

  /**
   * Template for this invocation's JUnit suite name.
   *
   * A pinned run collects a suite per invocation, so its default names them by
   * capability and spec to tell shards apart. A run this reporter created holds
   * one suite, named after the run.
   */
  private resolveTestSuiteNameTemplate(): string {
    if (this.reporterOptions.testSuiteName) {
      return this.reporterOptions.testSuiteName;
    }
    if (this.externallyManaged) {
      return EXTERNALLY_MANAGED_SUITE_NAME;
    }
    return this.reporterOptions.runName || '{suite} - {date} {time}';
  }

  /**
   * Format the run name with placeholders
   */
  private formatRunName(template: string): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0];
    const browser = this.state.capabilities?.browserName || 'unknown';
    const platform = this.state.capabilities?.platformName || process.platform;

    // Get spec file name from currentSpec (e.g., "/path/to/test.spec.ts" -> "test.spec.ts")
    let spec = 'unknown';
    if (this.currentSpec) {
      const parts = this.currentSpec.split('/');
      spec = parts[parts.length - 1] || 'unknown';
      // Remove common extensions for cleaner names
      spec = spec.replace(/\.(spec|test)\.(ts|js|mjs|cjs)$/, '');
    }

    // Get the root suite name (first describe block)
    const suite = this.currentSuite[0] || 'Tests';

    return template
      .replace('{date}', date)
      .replace('{time}', time)
      .replace('{browser}', browser)
      .replace('{platform}', platform)
      .replace('{spec}', spec)
      .replace('{suite}', suite);
  }

  /**
   * Parse case IDs from test title using the configured pattern
   * @example With default pattern: "[1761] [1762] should load the page" -> [1761, 1762]
   * @example With C-prefix pattern: "C12345 C67890 should load the page" -> [12345, 67890]
   */
  private parseCaseIds(title: string): { caseIds: number[]; cleanTitle: string } {
    const pattern = this.reporterOptions.caseIdPattern || /\[(\d+)\]/g;
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'g') : new RegExp(pattern.source, 'g');
    const caseIds: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(title)) !== null) {
      // Find the first capturing group that has a value (supports patterns with multiple groups)
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          caseIds.push(parseInt(match[i], 10));
          break;
        }
      }
    }

    // Remove matched patterns from title
    const cleanTitle = title.replace(regex, '').trim().replace(/\s+/g, ' ');

    return { caseIds, cleanTitle };
  }

  /**
   * Extract the custom-field identifier from a test title using
   * `matchByCustomField.idPattern` (default `/^(\d+)/`). Returns the first
   * capturing group, or the whole match when the pattern has no group. The
   * value is returned as a string; the API client matches it against both the
   * numeric and string forms of the stored value. Returns undefined when the
   * pattern doesn't match. Independent of `parseCaseIds`.
   */
  private parseCustomFieldId(title: string): string | undefined {
    const cfg = this.reporterOptions.matchByCustomField;
    if (!cfg) return undefined;

    const pattern = cfg.idPattern ?? /^(\d+)/;
    // Build a fresh, non-global RegExp so we never inherit `lastIndex` state
    // from a shared global-flagged pattern across calls.
    const source = typeof pattern === 'string' ? pattern : pattern.source;
    const flags = typeof pattern === 'string' ? '' : pattern.flags.replace('g', '');
    const regex = new RegExp(source, flags);

    const match = regex.exec(title);
    if (!match) return undefined;

    // First non-empty capturing group, else the whole match.
    const captured = match.slice(1).find((g) => g != null && g !== '') ?? match[0];
    return captured != null && captured !== '' ? captured : undefined;
  }

  /**
   * Opt-in resolution: find an existing case by a custom field value parsed
   * from the test title (see `matchByCustomField`). Returns the matched case
   * ID, or undefined to fall through to the name + className + source matching
   * / `autoCreateTestCases` flow.
   *
   * Never throws: a title the pattern doesn't match, a field that doesn't
   * exist, no matching case, or an API error all log and return undefined so
   * the standard flow still runs.
   */
  private async resolveCaseByCustomField(result: TrackedTestResult): Promise<number | undefined> {
    const cfg = this.reporterOptions.matchByCustomField;
    if (!cfg) return undefined;

    const value = this.parseCustomFieldId(result.originalTitle);
    if (value === undefined) {
      this.log('matchByCustomField: no id parsed from title:', result.originalTitle);
      return undefined;
    }

    // Cache hits AND misses so a retried test (same title) doesn't re-query.
    const cacheKey = `${cfg.fieldName}::${value}`;
    if (this.state.customFieldCaseMap.has(cacheKey)) {
      return this.state.customFieldCaseMap.get(cacheKey) ?? undefined;
    }

    try {
      const match = await this.client.findTestCaseByCustomField({
        projectId: this.reporterOptions.projectId,
        fieldName: cfg.fieldName,
        value,
      });

      if (match) {
        this.state.customFieldCaseMap.set(cacheKey, match.id);
        this.log(`matchByCustomField: matched case ${match.id} via ${cfg.fieldName}=${value}`);
        // The matched case (typically MANUAL, automated=false) is now receiving
        // automated results — flip it to automated so it stops showing as "not
        // automated". Skips when already true; never throws.
        await this.ensureCaseAutomated(match.id, match.automated);
        return match.id;
      }

      this.state.customFieldCaseMap.set(cacheKey, null);
      this.log(`matchByCustomField: no case with ${cfg.fieldName}=${value}; falling through`);
      return undefined;
    } catch (error) {
      // Do not cache errors (they may be transient). Log and fall through so a
      // lookup failure never aborts reporting the result.
      this.logError(`matchByCustomField lookup failed for ${cfg.fieldName}=${value}; falling through`, error);
      return undefined;
    }
  }

  /**
   * Flip a matched case to `automated: true` when it isn't already, so a case
   * that started manual but now receives automated results reflects that in
   * TestPlanIt. Skips the write when the case is already automated (no
   * redundant API call per run) and never throws — a failed update logs and is
   * swallowed so it can't abort reporting the result.
   */
  private async ensureCaseAutomated(caseId: number, currentAutomated: boolean | undefined): Promise<void> {
    if (currentAutomated === true) return;
    try {
      await this.client.updateTestCase(caseId, { automated: true });
      this.log(`matchByCustomField: flipped case ${caseId} to automated`);
    } catch (error) {
      this.logError(`matchByCustomField: failed to set automated on case ${caseId}; continuing`, error);
    }
  }

  /**
   * Get the full suite path as a string
   */
  private getFullSuiteName(): string {
    return this.currentSuite.join(' > ');
  }

  /**
   * Create a unique key for a test case
   */
  private createCaseKey(suiteName: string, testName: string): string {
    return `${suiteName}::${testName}`;
  }

  // ============================================================================
  // WebdriverIO Reporter Hooks
  // ============================================================================

  onRunnerStart(runner: RunnerStats): void {
    this.log('Runner started:', runner.cid);
    this.state.capabilities = runner.capabilities as WebdriverIO.Capabilities;

    // Auto-detect the test framework from WebdriverIO config
    // This is accessed via runner.config.framework (e.g., 'mocha', 'cucumber', 'jasmine')
    const config = runner.config as { framework?: string } | undefined;
    if (config?.framework) {
      this.detectedFramework = config.framework;
      this.log('Detected framework:', this.detectedFramework);
    }

    // Step capture only applies to @wdio/cucumber-framework. Emit a one-time
    // notice if captureSteps is on but the detected framework can't provide
    // steps (Mocha/Jasmine have no native step structure — D-10).
    if (
      this.detectedFramework &&
      this.detectedFramework !== 'cucumber' &&
      this.reporterOptions.captureSteps !== false &&
      !this.cucumberStepNoticeLogged
    ) {
      this.cucumberStepNoticeLogged = true;
      this.log(
        `captureSteps only applies to Cucumber scenarios; step capture is unavailable for framework "${this.detectedFramework}".`,
      );
    }

    // Don't initialize here - wait until we have actual test results to report
    // This avoids creating empty test runs for specs with no matching tests
  }

  onSuiteStart(suite: SuiteStats): void {
    if (suite.title) {
      this.currentSuite.push(suite.title);
      this.log('Suite started:', this.getFullSuiteName());
    }

    // Cucumber: a scenario is a suite with type 'scenario'. Begin accumulating
    // its steps; the case + its Steps are emitted once at onSuiteEnd (D-01/D-12).
    if ((suite as unknown as { type?: string }).type === 'scenario' && this.detectedFramework === 'cucumber') {
      this.currentScenarioUid = suite.uid;
      this.pendingScenarioSteps.set(suite.uid, []);
      // The scenario title can carry a "Scenario:"/"Scenario Outline:" prefix.
      const scenarioTitle = (suite.title || '').replace(/^Scenario(?: Outline)?:\s*/, '').trim();
      this.currentScenarioPlan = {
        title: scenarioTitle,
        // Feature path WITHOUT this scenario (currentSuite already includes it).
        suiteName: this.currentSuite.slice(0, -1).join(' > '),
        suitePath: this.currentSuite.slice(0, -1),
        cid: (suite as unknown as { cid?: string }).cid ?? '',
        status: 'passed',
        startedAt: suite.start ? new Date(suite.start) : new Date(),
      };
    }
  }

  onSuiteEnd(suite: SuiteStats): void {
    // Cucumber: close the scenario — emit ONE reportResult for the whole
    // scenario carrying the accumulated step titles (D-01/D-12).
    if (
      (suite as unknown as { type?: string }).type === 'scenario' &&
      this.detectedFramework === 'cucumber' &&
      this.currentScenarioPlan
    ) {
      const plan = this.currentScenarioPlan;
      const stepTitles = this.pendingScenarioSteps.get(suite.uid) ?? [];
      this.pendingScenarioSteps.delete(suite.uid);
      this.currentScenarioUid = null;
      this.currentScenarioPlan = null;

      const { caseIds, cleanTitle } = this.parseCaseIds(plan.title);
      const fullTitle = plan.suiteName ? `${plan.suiteName} > ${cleanTitle}` : cleanTitle;
      const result: TrackedTestResult = {
        caseId: caseIds[0],
        suiteName: plan.suiteName,
        suitePath: plan.suitePath,
        testName: cleanTitle,
        fullTitle,
        originalTitle: plan.title,
        status: plan.status,
        duration: 0,
        errorMessage: plan.error?.message,
        stackTrace: this.reporterOptions.includeStackTrace ? plan.error?.stack : undefined,
        startedAt: plan.startedAt,
        finishedAt: new Date(),
        browser: this.state.capabilities?.browserName,
        platform: this.state.capabilities?.platformName || process.platform,
        screenshots: [],
        retryAttempt: 0,
        uid: `${plan.cid}_${fullTitle}`,
        specFile: this.currentSpec,
        cucumberStepTitles: stepTitles,
      };
      this.state.results.set(result.uid, result);
      this.trackOperation(this.reportResult(result, caseIds));
    }

    if (suite.title) {
      this.log('Suite ended:', this.getFullSuiteName());
      this.currentSuite.pop();
    }
  }

  onTestStart(test: TestStats): void {
    this.log('Test started:', test.title);
    // Track the current test for screenshot association
    const { cleanTitle } = this.parseCaseIds(test.title);
    const suiteName = this.getFullSuiteName();
    const fullTitle = suiteName ? `${suiteName} > ${cleanTitle}` : cleanTitle;
    this.currentTestUid = `${test.cid}_${fullTitle}`;
    this.currentCid = test.cid;
    if (!this.testCommands.has(this.currentTestUid)) {
      this.testCommands.set(this.currentTestUid, []);
    }
  }

  /**
   * Capture the ordered low-level automation commands a test runs. Fed to AI
   * step derivation (non-Cucumber) so the steps mirror what the test actually
   * did. Cheap no-op outside a test / when nothing is being captured.
   */
  onBeforeCommand(commandArgs: BeforeCommandArgs): void {
    const uid = this.currentTestUid;
    if (!uid) return;
    const list = this.testCommands.get(uid);
    if (!list || list.length >= TestPlanItReporter.MAX_COMMANDS_PER_TEST) return;
    const formatted = this.formatCommand(commandArgs);
    if (formatted) list.push(formatted);
  }

  /**
   * Render a WebdriverIO command into a compact one-line string for the LLM,
   * e.g. `navigateTo {"url":"https://app/login"}` or `elementSendKeys {"text":"a@b.com"}`.
   * Returns null for commands with no useful signal.
   */
  private formatCommand(commandArgs: BeforeCommandArgs): string | null {
    const name = commandArgs.command || commandArgs.endpoint || commandArgs.method;
    if (!name) return null;
    let body = '';
    if (commandArgs.body !== undefined && commandArgs.body !== null) {
      try {
        const json = JSON.stringify(commandArgs.body);
        if (json && json !== '{}' && json !== 'null') {
          body = ` ${json.length > 300 ? `${json.slice(0, 300)}…` : json}`;
        }
      } catch {
        // non-serializable body — skip the args, keep the command name
      }
    }
    return `${name}${body}`;
  }

  /**
   * Capture screenshots from WebdriverIO commands
   */
  onAfterCommand(commandArgs: AfterCommandArgs): void {
    // Check if this is a screenshot command
    if (!this.reporterOptions.uploadScreenshots) {
      return;
    }

    // WebdriverIO uses 'takeScreenshot' as the command name or '/screenshot' endpoint
    const isScreenshotCommand =
      commandArgs.command === 'takeScreenshot' ||
      commandArgs.command === 'saveScreenshot' ||
      commandArgs.endpoint?.includes('/screenshot');

    if (!isScreenshotCommand) {
      return;
    }

    this.log(`Screenshot command detected: ${commandArgs.command}, endpoint: ${commandArgs.endpoint}`);

    // For saveScreenshot, the result is the file path, not base64 data
    // We need to handle both takeScreenshot (returns base64) and saveScreenshot (saves to file)
    const result = commandArgs.result as Record<string, unknown> | string | undefined;
    const resultValue = (typeof result === 'object' && result !== null ? result.value : result) ?? result;

    if (!resultValue) {
      this.log('No result value in screenshot command');
      return;
    }

    // The result should be base64-encoded screenshot data
    const screenshotData = resultValue as string;
    if (typeof screenshotData !== 'string') {
      this.log(`Screenshot result is not a string: ${typeof screenshotData}`);
      return;
    }

    // Check if this looks like a file path rather than base64 data
    // File paths start with / (Unix) or drive letter like C:\ (Windows)
    // Base64 PNG data starts with "iVBORw0KGgo" (PNG header)
    const looksLikeFilePath =
      screenshotData.startsWith('/') ||
      /^[A-Za-z]:[\\\/]/.test(screenshotData) ||
      screenshotData.startsWith('./') ||
      screenshotData.startsWith('../');

    if (looksLikeFilePath) {
      this.log(`Screenshot result appears to be a file path: ${screenshotData.substring(0, 100)}`);
      return;
    }

    // Store the screenshot associated with the current test
    if (this.currentTestUid) {
      const buffer = Buffer.from(screenshotData, 'base64');
      const existing = this.pendingScreenshots.get(this.currentTestUid) || [];
      existing.push(buffer);
      this.pendingScreenshots.set(this.currentTestUid, existing);
      this.log('Captured screenshot for test:', this.currentTestUid, `(${buffer.length} bytes)`);
    } else {
      this.log('No current test UID to associate screenshot with');
    }
  }

  onTestPass(test: TestStats): void {
    this.handleTestEnd(test, 'passed');
  }

  onTestFail(test: TestStats): void {
    this.handleTestEnd(test, 'failed');
  }

  onTestSkip(test: TestStats): void {
    this.handleTestEnd(test, 'skipped');
  }

  /**
   * Handle test completion
   */
  private handleTestEnd(test: TestStats, status: 'passed' | 'failed' | 'skipped'): void {
    // Cucumber: each Gherkin step fires as a test. Accumulate the step title
    // under the open scenario and SUPPRESS per-step reporting — the scenario's
    // single case + Steps are emitted at onSuiteEnd (D-01/D-12).
    if (this.detectedFramework === 'cucumber' && this.currentScenarioUid !== null) {
      this.pendingScenarioSteps.get(this.currentScenarioUid)?.push(test.title);
      if (this.currentScenarioPlan) {
        if (status === 'failed' && this.currentScenarioPlan.status !== 'failed') {
          this.currentScenarioPlan.status = 'failed';
          this.currentScenarioPlan.error = test.error;
        } else if (status === 'skipped' && this.currentScenarioPlan.status === 'passed') {
          this.currentScenarioPlan.status = 'skipped';
        }
      }
      return;
    }

    const { caseIds, cleanTitle } = this.parseCaseIds(test.title);
    const suiteName = this.getFullSuiteName();
    const suitePath = [...this.currentSuite]; // Copy the current suite hierarchy
    const fullTitle = suiteName ? `${suiteName} > ${cleanTitle}` : cleanTitle;
    const uid = `${test.cid}_${fullTitle}`;

    // Calculate duration from timestamps for reliability
    // WebdriverIO's test.duration can be inconsistent in some versions
    const startTime = new Date(test.start).getTime();
    const endTime = test.end ? new Date(test.end).getTime() : Date.now();
    const durationMs = endTime - startTime;

    // Format WebdriverIO command output if available
    let commandOutput: string | undefined;
    if (test.output && test.output.length > 0) {
      commandOutput = test.output
        .map((o) => {
          const parts: string[] = [];
          if (o.method) parts.push(`[${o.method}]`);
          if (o.endpoint) parts.push(o.endpoint);
          if (o.result !== undefined) {
            const resultStr = typeof o.result === 'string' ? o.result : JSON.stringify(o.result);
            // Truncate long results
            parts.push(resultStr.length > 200 ? resultStr.substring(0, 200) + '...' : resultStr);
          }
          return parts.join(' ');
        })
        .join('\n');
    }

    const result: TrackedTestResult = {
      caseId: caseIds[0], // Primary case ID
      suiteName,
      suitePath,
      testName: cleanTitle,
      fullTitle,
      originalTitle: test.title,
      status,
      duration: durationMs,
      errorMessage: test.error?.message,
      stackTrace: this.reporterOptions.includeStackTrace ? test.error?.stack : undefined,
      startedAt: new Date(test.start),
      finishedAt: new Date(endTime),
      browser: this.state.capabilities?.browserName,
      platform: this.state.capabilities?.platformName || process.platform,
      screenshots: [],
      retryAttempt: test.retries || 0,
      uid,
      specFile: this.currentSpec,
      commandOutput,
      commands: this.testCommands.get(uid),
    };
    this.testCommands.delete(uid);

    this.state.results.set(uid, result);
    this.log(`Test ${status}:`, cleanTitle, caseIds.length > 0 ? `(Case IDs: ${caseIds.join(', ')})` : '');

    // Report result asynchronously - track operation so WebdriverIO waits for completion
    const reportPromise = this.reportResult(result, caseIds);
    this.trackOperation(reportPromise);
  }

  /**
   * Report a single test result to TestPlanIt
   */
  private async reportResult(result: TrackedTestResult, caseIds: number[]): Promise<void> {
    try {
      // Checked before any API work so an all-skipped spec never creates a
      // run. Catches both the Mocha/Jasmine per-test path and the Cucumber
      // per-scenario path, which both funnel through here.
      if (
        this.reporterOptions.excludeSkipped &&
        (result.status === 'skipped' || result.status === 'pending')
      ) {
        this.log(`Excluding skipped test (excludeSkipped): ${result.testName}`);
        return;
      }

      // Check if this result can be reported BEFORE initializing
      // This prevents creating empty test runs for tests without case IDs.
      // matchByCustomField is also a resolution path, so its presence keeps the
      // result eligible even when autoCreateTestCases is disabled.
      if (
        caseIds.length === 0 &&
        !this.reporterOptions.autoCreateTestCases &&
        !this.reporterOptions.matchByCustomField
      ) {
        console.warn(`[TestPlanIt] WARNING: Skipping "${result.testName}" - no case ID found and autoCreateTestCases is disabled. Set autoCreateTestCases: true to automatically find or create test cases by name.`);
        return;
      }

      // Now we know this result can be reported, so initialize if needed
      await this.initialize();

      if (!this.state.testRunId) {
        this.logError('No test run ID available, skipping result');
        return;
      }

      // Create JUnit test suite if not already created
      await this.createJUnitTestSuite();

      if (!this.state.testSuiteId) {
        this.logError('No test suite ID available, skipping result');
        return;
      }

      // Get or create repository case
      let repositoryCaseId: number | undefined;
      const caseKey = this.createCaseKey(result.suiteName, result.testName);

      // DEBUG: Always log key info about this test
      this.log('DEBUG: Processing test:', result.testName);
      this.log('DEBUG: suiteName:', result.suiteName);
      this.log('DEBUG: suitePath:', JSON.stringify(result.suitePath));
      this.log('DEBUG: caseIds from title:', JSON.stringify(caseIds));
      this.log('DEBUG: autoCreateTestCases:', this.reporterOptions.autoCreateTestCases);
      this.log('DEBUG: createFolderHierarchy:', this.reporterOptions.createFolderHierarchy);

      if (caseIds.length > 0) {
        // Use the provided case ID directly as repository case ID
        repositoryCaseId = caseIds[0];
        this.log('DEBUG: Using case ID from title:', repositoryCaseId);
        // Explicitly-linked Cucumber case ([123]): the case pre-exists, so only
        // overwriteSteps replaces its steps (never on a plain re-run — D-05).
        if (this.reporterOptions.overwriteSteps) {
          await this.writeScenarioSteps(caseIds[0], 'found', result);
        }
        // Non-Cucumber: collect this matched case for opt-in LLM derivation
        // (self-gated — only with overwriteSteps, since the case pre-exists).
        this.collectForLlmDerivation(caseIds[0], 'found', result);
      }

      // Opt-in: resolve an existing case by a custom field value (e.g. a legacy
      // external ID) BEFORE the name/className/source matching + auto-create flow.
      // On a match, attach the result directly to that case regardless of its
      // source (typically MANUAL) — no create, no folder, no link — the same
      // direct-attach treatment as an explicit case ID in the title.
      if (repositoryCaseId === undefined && this.reporterOptions.matchByCustomField) {
        const matchedId = await this.resolveCaseByCustomField(result);
        if (matchedId !== undefined) {
          repositoryCaseId = matchedId;
          this.state.stats.testCasesFound++;
          this.log('DEBUG: Attaching to case matched by custom field:', repositoryCaseId);
          // The matched case pre-exists, so only overwriteSteps replaces its
          // steps (mirrors the explicit case-ID 'found' path — D-05).
          if (this.reporterOptions.overwriteSteps) {
            await this.writeScenarioSteps(matchedId, 'found', result);
          }
          this.collectForLlmDerivation(matchedId, 'found', result);
        }
      }

      // Fall back to name + className + source matching / auto-create.
      if (repositoryCaseId === undefined && this.reporterOptions.autoCreateTestCases) {
        // Check cache first
        if (this.state.caseIdMap.has(caseKey)) {
          repositoryCaseId = this.state.caseIdMap.get(caseKey);
          this.log('DEBUG: Found in cache:', caseKey, '->', repositoryCaseId);
        } else {
          // Determine the target folder ID
          let folderId = this.state.resolvedIds.parentFolderId;
          const templateId = this.state.resolvedIds.templateId;

          this.log('DEBUG: Initial folderId (parentFolderId):', folderId);
          this.log('DEBUG: templateId:', templateId);

          if (!folderId || !templateId) {
            this.logError('autoCreateTestCases requires parentFolderId and templateId');
            return;
          }

          // Create folder hierarchy based on suite structure if enabled
          this.log('DEBUG: Checking folder hierarchy - createFolderHierarchy:', this.reporterOptions.createFolderHierarchy, 'suitePath.length:', result.suitePath.length);
          if (this.reporterOptions.createFolderHierarchy && result.suitePath.length > 0) {
            const folderPathKey = result.suitePath.join(' > ');
            this.log('DEBUG: Will create folder hierarchy for path:', folderPathKey);

            // Check folder cache first
            if (this.state.folderPathMap.has(folderPathKey)) {
              folderId = this.state.folderPathMap.get(folderPathKey)!;
              this.log('Using cached folder ID for path:', folderPathKey, '->', folderId);
            } else {
              // Create the folder hierarchy
              this.log('Creating folder hierarchy:', result.suitePath.join(' > '));
              this.log('DEBUG: Calling findOrCreateFolderPath with projectId:', this.reporterOptions.projectId, 'suitePath:', JSON.stringify(result.suitePath), 'parentFolderId:', this.state.resolvedIds.parentFolderId);
              const folder = await this.client.findOrCreateFolderPath(
                this.reporterOptions.projectId,
                result.suitePath,
                this.state.resolvedIds.parentFolderId
              );
              folderId = folder.id;
              this.state.folderPathMap.set(folderPathKey, folderId);
              this.log('Created/found folder:', folder.name, '(ID:', folder.id + ')');
            }
          } else {
            this.log('DEBUG: Skipping folder hierarchy - createFolderHierarchy:', this.reporterOptions.createFolderHierarchy, 'suitePath.length:', result.suitePath.length);
          }

          this.log('DEBUG: Final folderId for test case:', folderId);

          const { testCase, action } = await this.client.findOrCreateTestCase({
            projectId: this.reporterOptions.projectId,
            folderId,
            templateId,
            name: result.testName,
            className: result.suiteName || undefined,
            source: 'API',
            automated: true,
          });

          // Track statistics based on action
          if (action === 'found') {
            this.state.stats.testCasesFound++;
          } else if (action === 'created') {
            this.state.stats.testCasesCreated++;
          } else if (action === 'moved') {
            this.state.stats.testCasesMoved++;
          }

          repositoryCaseId = testCase.id;
          this.state.caseIdMap.set(caseKey, repositoryCaseId);
          this.log(`${action === 'found' ? 'Found' : action === 'created' ? 'Created' : 'Moved'} test case:`, testCase.id, testCase.name, 'in folder:', folderId);

          // Cucumber: write the scenario's Given/When/Then as case Steps
          // (D-04 on create / D-05 overwrite). No-op for non-Cucumber (D-09).
          await this.writeScenarioSteps(testCase.id, action, result);
          // Non-Cucumber: collect for opt-in LLM derivation (self-gated).
          this.collectForLlmDerivation(testCase.id, action, result);
        }
      }

      if (!repositoryCaseId) {
        this.log('No repository case ID, skipping result');
        return;
      }

      // Get or create test run case
      const runCaseKey = `${this.state.testRunId}_${repositoryCaseId}`;

      if (!this.state.testRunCaseMap.has(runCaseKey)) {
        const testRunCase = await this.client.findOrAddTestCaseToRun({
          testRunId: this.state.testRunId,
          repositoryCaseId,
        });
        this.state.testRunCaseMap.set(runCaseKey, testRunCase.id);
        this.log('Added case to run:', testRunCase.id);
      }

      // Get status ID for the JUnit result
      const statusId = this.state.statusIds[result.status] || this.state.statusIds.failed!;

      // Map status to JUnit result type
      const junitType = this.mapStatusToJUnitType(result.status);

      // Build error message/content for failed tests
      let message: string | undefined;
      let content: string | undefined;

      if (result.errorMessage) {
        message = result.errorMessage;
      }
      if (result.stackTrace) {
        content = result.stackTrace;
      }

      // Create the JUnit test result
      // WebdriverIO provides duration in milliseconds, JUnit expects seconds
      const durationInSeconds = result.duration / 1000;
      const junitResult = await this.client.createJUnitTestResult({
        testSuiteId: this.state.testSuiteId,
        repositoryCaseId,
        type: junitType,
        message,
        content,
        statusId,
        time: durationInSeconds,
        executedAt: result.finishedAt,
        file: result.specFile,
        systemOut: result.commandOutput,
      });

      this.log('Created JUnit test result:', junitResult.id, '(type:', junitType + ')');
      this.reportedResultCount++;

      // Store the JUnit result ID for deferred screenshot upload
      // Screenshots taken in afterTest hook won't be available yet, so we upload them in onRunnerEnd
      result.junitResultId = junitResult.id;

      // Update reporter stats (suite stats are calculated by backend from JUnitTestResult rows)
      if (result.status === 'failed') {
        this.state.stats.resultsFailed++;
      } else if (result.status === 'skipped') {
        this.state.stats.resultsSkipped++;
      } else {
        this.state.stats.resultsPassed++;
      }
    } catch (error) {
      this.state.stats.apiErrors++;
      this.logError(`Failed to report result for ${result.testName}:`, error);
    }
  }

  /**
   * Called when the entire test session ends
   */
  async onRunnerEnd(runner: RunnerStats): Promise<void> {
    // If no tests were tracked and no initialization was started, silently skip
    // This handles specs with no matching tests (all filtered out by grep, etc.)
    if (this.state.results.size === 0 && !this.initPromise) {
      this.log('No test results to report, skipping');
      return;
    }

    this.log('Runner ended, waiting for initialization and pending results...');

    // Wait for initialization to complete (might still be in progress)
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // Error already captured in state.initError
      }
    }

    // Wait for any remaining pending operations
    // (WebdriverIO waits via isSynchronised, but we also wait here for safety)
    await Promise.allSettled([...this.pendingOperations]);

    // Check if initialization failed
    if (this.state.initError) {
      console.error('\n[TestPlanIt] FAILED: Reporter initialization failed');
      console.error(`  Error: ${this.state.initError.message}`);
      console.error('  No results were reported to TestPlanIt.');
      console.error('  Please check your configuration and API connectivity.');
      return;
    }

    // If no test run was created (no reportable results), silently skip
    if (!this.state.testRunId) {
      this.log('No test run created, skipping summary');
      return;
    }

    // Fire the single opt-in AI step-derivation request for the non-Cucumber
    // cases collected this run (inert server-side without an LLM provider).
    await this.requestLlmDerivation();

    // If no results were actually reported to TestPlanIt, silently skip
    // This handles the case where tests ran but none had valid case IDs
    if (this.reportedResultCount === 0) {
      this.log('No results were reported to TestPlanIt, skipping summary');
      return;
    }

    // Upload any pending screenshots
    // Screenshots are uploaded here (deferred) because afterTest hooks run after onTestFail/onTestPass,
    // so screenshots taken in afterTest wouldn't be available during reportResult
    if (this.reporterOptions.uploadScreenshots && this.pendingScreenshots.size > 0) {
      this.log(`Uploading screenshots for ${this.pendingScreenshots.size} test(s)...`);

      // Create upload promises for all screenshots and track them
      // This ensures WebdriverIO waits for uploads to complete (via isSynchronised)
      const uploadPromises: Promise<void>[] = [];

      for (const [uid, screenshots] of this.pendingScreenshots.entries()) {
        const result = this.state.results.get(uid);
        if (!result?.junitResultId) {
          this.log(`Skipping screenshots for ${uid} - no JUnit result ID`);
          continue;
        }

        this.log(`Uploading ${screenshots.length} screenshot(s) for test:`, result.testName);
        for (let i = 0; i < screenshots.length; i++) {
          const uploadPromise = (async () => {
            try {
              // Create a meaningful file name: testName_status_screenshot#.png
              // Sanitize test name for filename (remove special chars, limit length)
              const sanitizedTestName = result.testName
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .substring(0, 50);
              const fileName = `${sanitizedTestName}_${result.status}_${i + 1}.png`;

              // Build a descriptive note with test context
              const noteParts: string[] = [];
              noteParts.push(`Test: ${result.testName}`);
              if (result.suiteName) {
                noteParts.push(`Suite: ${result.suiteName}`);
              }
              noteParts.push(`Status: ${result.status}`);
              if (result.browser) {
                noteParts.push(`Browser: ${result.browser}`);
              }
              if (result.errorMessage) {
                // Truncate error message if too long
                const errorPreview = result.errorMessage.length > 200
                  ? result.errorMessage.substring(0, 200) + '...'
                  : result.errorMessage;
                noteParts.push(`Error: ${errorPreview}`);
              }
              const note = noteParts.join('\n');

              this.log(`Starting upload of ${fileName} (${screenshots[i].length} bytes) to JUnit result ${result.junitResultId}...`);
              await this.client.uploadJUnitAttachment(
                result.junitResultId!,
                screenshots[i],
                fileName,
                'image/png',
                note
              );
              this.state.stats.screenshotsUploaded++;
              this.log(`Uploaded screenshot ${i + 1}/${screenshots.length} for ${result.testName}`);
            } catch (uploadError) {
              this.state.stats.screenshotsFailed++;
              const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
              const errorStack = uploadError instanceof Error ? uploadError.stack : undefined;
              this.logError(`Failed to upload screenshot ${i + 1}:`, errorMessage);
              if (errorStack) {
                this.logError('Stack trace:', errorStack);
              }
            }
          })();

          // Track this operation so WebdriverIO waits for it
          this.trackOperation(uploadPromise);
          uploadPromises.push(uploadPromise);
        }
      }

      // Wait for all uploads to complete before proceeding
      await Promise.allSettled(uploadPromises);

      // Clear all pending screenshots
      this.pendingScreenshots.clear();
    }

    // Note: JUnit test suite statistics (tests, failures, errors, skipped, time) are NOT updated here.
    // The backend calculates these dynamically from JUnitTestResult rows in the summary API.
    // This ensures correct totals when multiple workers/spec files report to the same test run.

    // Complete the test run if configured
    // When managedByService is true, the service handles completion in onComplete — skip entirely
    // In legacy oneReport mode, decrement worker count and only complete when last worker finishes
    if (this.managedByService) {
      this.log('Skipping test run completion (managed by TestPlanItService)');
    } else if (this.externallyManaged) {
      this.log(`Skipping test run completion (test run ${this.state.testRunId} is managed externally)`);
      if (this.reporterOptions.oneReport) {
        decrementWorkerCount(this.reporterOptions.projectId);
      }
    } else if (this.reporterOptions.completeRunOnFinish) {
      if (this.reporterOptions.oneReport) {
        // Decrement worker count and check if we're the last worker
        const isLastWorker = decrementWorkerCount(this.reporterOptions.projectId);
        if (isLastWorker) {
          const completeRunOp = (async () => {
            try {
              await this.client.completeTestRun(this.state.testRunId!, this.reporterOptions.projectId);
              this.log('Test run completed (last worker):', this.state.testRunId);
              deleteSharedState(this.reporterOptions.projectId);
            } catch (error) {
              this.logError('Failed to complete test run:', error);
            }
          })();
          this.trackOperation(completeRunOp);
          await completeRunOp;
        } else {
          this.log('Skipping test run completion (waiting for other workers to finish)');
        }
      } else {
        const completeRunOp = (async () => {
          try {
            await this.client.completeTestRun(this.state.testRunId!, this.reporterOptions.projectId);
            this.log('Test run completed:', this.state.testRunId);
          } catch (error) {
            this.logError('Failed to complete test run:', error);
          }
        })();
        this.trackOperation(completeRunOp);
        await completeRunOp;
      }
    } else if (this.reporterOptions.oneReport) {
      // Even if not completing, decrement worker count in legacy mode
      decrementWorkerCount(this.reporterOptions.projectId);
    }

    // Print summary
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

    if (this.reporterOptions.autoCreateTestCases && totalCases > 0) {
      console.log('[TestPlanIt]');
      console.log('[TestPlanIt]   Test Cases:');
      console.log(`[TestPlanIt]     Found (existing): ${stats.testCasesFound}`);
      console.log(`[TestPlanIt]     Created (new):    ${stats.testCasesCreated}`);
      if (stats.testCasesMoved > 0) {
        console.log(`[TestPlanIt]     Moved (restored): ${stats.testCasesMoved}`);
      }
    }

    if (this.reporterOptions.uploadScreenshots && (stats.screenshotsUploaded > 0 || stats.screenshotsFailed > 0)) {
      console.log('[TestPlanIt]');
      console.log('[TestPlanIt]   Screenshots:');
      console.log(`[TestPlanIt]     Uploaded: ${stats.screenshotsUploaded}`);
      if (stats.screenshotsFailed > 0) {
        console.log(`[TestPlanIt]     Failed:   ${stats.screenshotsFailed}`);
      }
    }

    if (stats.apiErrors > 0) {
      console.log('[TestPlanIt]');
      console.log(`[TestPlanIt]   ⚠ API Errors: ${stats.apiErrors}`);
    }

    console.log('[TestPlanIt]');
    console.log(`[TestPlanIt]   View results: ${this.reporterOptions.domain}/projects/runs/${this.reporterOptions.projectId}/${this.state.testRunId}`);
    console.log('[TestPlanIt] ═══════════════════════════════════════════════════════\n');
  }

  /**
   * Get the current state (for debugging)
   */
  getState(): ReporterState {
    return this.state;
  }
}
