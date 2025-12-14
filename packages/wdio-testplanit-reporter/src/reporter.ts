import WDIOReporter, { type RunnerStats, type SuiteStats, type TestStats, type AfterCommandArgs } from '@wdio/reporter';
import { TestPlanItClient } from '@testplanit/api';
import type { NormalizedStatus, JUnitResultType } from '@testplanit/api';
import type { TestPlanItReporterOptions, TrackedTestResult, ReporterState } from './types.js';

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
      createFolderHierarchy: false,
      uploadScreenshots: true,
      includeStackTrace: true,
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

    // Initialize state - testRunId will be resolved during initialization
    this.state = {
      testRunId: typeof this.reporterOptions.testRunId === 'number' ? this.reporterOptions.testRunId : undefined,
      resolvedIds: {},
      results: new Map(),
      caseIdMap: new Map(),
      testRunCaseMap: new Map(),
      folderPathMap: new Map(),
      statusIds: {},
      initialized: false,
      testSuiteStats: {
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 0,
      },
      stats: {
        testCasesFound: 0,
        testCasesCreated: 0,
        testCasesMoved: 0,
        foldersCreated: 0,
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

      // Resolve any string IDs to numeric IDs
      this.log('Resolving option IDs...');
      await this.resolveOptionIds();

      // Fetch status mappings
      this.log('Fetching status mappings...');
      await this.fetchStatusMappings();

      // Create or validate test run
      if (!this.state.testRunId) {
        await this.createTestRun();
        this.log(`Created test run with ID: ${this.state.testRunId}`);
      } else {
        // Validate existing test run
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
   * Resolve option names to numeric IDs
   */
  private async resolveOptionIds(): Promise<void> {
    const projectId = this.reporterOptions.projectId;

    // Resolve testRunId if it's a string
    if (typeof this.reporterOptions.testRunId === 'string') {
      const testRun = await this.client.findTestRunByName(projectId, this.reporterOptions.testRunId);
      if (!testRun) {
        throw new Error(`Test run not found: "${this.reporterOptions.testRunId}"`);
      }
      this.state.testRunId = testRun.id;
      this.state.resolvedIds.testRunId = testRun.id;
      this.log(`Resolved test run "${this.reporterOptions.testRunId}" -> ${testRun.id}`);
    }

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
      return; // Already created
    }

    if (!this.state.testRunId) {
      throw new Error('Cannot create JUnit test suite without a test run ID');
    }

    const runName = this.formatRunName(this.reporterOptions.runName || '{suite} - {date} {time}');

    this.log('Creating JUnit test suite...');

    const testSuite = await this.client.createJUnitTestSuite({
      testRunId: this.state.testRunId,
      name: runName,
      time: 0, // Will be updated incrementally
      tests: 0,
      failures: 0,
      errors: 0,
      skipped: 0,
    });

    this.state.testSuiteId = testSuite.id;
    this.log('Created JUnit test suite with ID:', testSuite.id);
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
    });

    this.state.testRunId = testRun.id;
    this.log('Created test run with ID:', testRun.id);
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

    // Don't initialize here - wait until we have actual test results to report
    // This avoids creating empty test runs for specs with no matching tests
  }

  onSuiteStart(suite: SuiteStats): void {
    if (suite.title) {
      this.currentSuite.push(suite.title);
      this.log('Suite started:', this.getFullSuiteName());
    }
  }

  onSuiteEnd(suite: SuiteStats): void {
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
    };

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
      // Check if this result can be reported BEFORE initializing
      // This prevents creating empty test runs for tests without case IDs
      if (caseIds.length === 0 && !this.reporterOptions.autoCreateTestCases) {
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
      } else if (this.reporterOptions.autoCreateTestCases) {
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
        }
      } else {
        this.log('DEBUG: autoCreateTestCases is false, not creating test case');
      }

      if (!repositoryCaseId) {
        this.log('No repository case ID, skipping result');
        return;
      }

      // Get or create test run case
      let testRunCaseId: number | undefined;
      const runCaseKey = `${this.state.testRunId}_${repositoryCaseId}`;

      if (this.state.testRunCaseMap.has(runCaseKey)) {
        testRunCaseId = this.state.testRunCaseMap.get(runCaseKey);
      } else {
        const testRunCase = await this.client.findOrAddTestCaseToRun({
          testRunId: this.state.testRunId,
          repositoryCaseId,
        });
        testRunCaseId = testRunCase.id;
        this.state.testRunCaseMap.set(runCaseKey, testRunCaseId);
        this.log('Added case to run:', testRunCaseId);
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

      // Update suite statistics and reporter stats
      this.state.testSuiteStats.tests++;
      this.state.testSuiteStats.time += durationInSeconds;
      if (result.status === 'failed') {
        this.state.testSuiteStats.failures++;
        this.state.stats.resultsFailed++;
      } else if (result.status === 'skipped') {
        this.state.testSuiteStats.skipped++;
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
              const fileName = `screenshot_${i + 1}_${Date.now()}.png`;
              this.log(`Starting upload of ${fileName} (${screenshots[i].length} bytes) to JUnit result ${result.junitResultId}...`);
              await this.client.uploadJUnitAttachment(
                result.junitResultId!,
                screenshots[i],
                fileName,
                'image/png'
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

    // Update the JUnit test suite with final statistics
    // Track this operation to prevent WebdriverIO from terminating early
    if (this.state.testSuiteId) {
      const updateSuiteOp = (async () => {
        try {
          await this.client.updateJUnitTestSuite(this.state.testSuiteId!, {
            tests: this.state.testSuiteStats.tests,
            failures: this.state.testSuiteStats.failures,
            errors: this.state.testSuiteStats.errors,
            skipped: this.state.testSuiteStats.skipped,
            time: this.state.testSuiteStats.time,
          });
          this.log('Updated test suite statistics:', this.state.testSuiteStats);
        } catch (error) {
          this.logError('Failed to update test suite statistics:', error);
        }
      })();
      this.trackOperation(updateSuiteOp);
      await updateSuiteOp;
    }

    // Complete the test run if configured
    // Track this operation to prevent WebdriverIO from terminating early
    if (this.reporterOptions.completeRunOnFinish) {
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
