import WDIOReporter from '@wdio/reporter';
import { TestPlanItClient } from '@testplanit/api';
export { TestPlanItClient, TestPlanItError } from '@testplanit/api';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// src/reporter.ts
var TestPlanItReporter = class extends WDIOReporter {
  client;
  reporterOptions;
  state;
  currentSuite = [];
  initPromise = null;
  pendingOperations = /* @__PURE__ */ new Set();
  reportedResultCount = 0;
  detectedFramework = null;
  currentTestUid = null;
  currentCid = null;
  pendingScreenshots = /* @__PURE__ */ new Map();
  /**
   * WebdriverIO uses this getter to determine if the reporter has finished async operations.
   * The test runner will wait for this to return true before terminating.
   */
  get isSynchronised() {
    return this.pendingOperations.size === 0;
  }
  constructor(options) {
    super(options);
    this.reporterOptions = {
      caseIdPattern: /\[(\d+)\]/g,
      autoCreateTestCases: false,
      createFolderHierarchy: false,
      uploadScreenshots: true,
      includeStackTrace: true,
      completeRunOnFinish: true,
      oneReport: true,
      timeout: 3e4,
      maxRetries: 3,
      verbose: false,
      ...options
    };
    if (!this.reporterOptions.domain) {
      throw new Error("TestPlanIt reporter: domain is required");
    }
    if (!this.reporterOptions.apiToken) {
      throw new Error("TestPlanIt reporter: apiToken is required");
    }
    if (!this.reporterOptions.projectId) {
      throw new Error("TestPlanIt reporter: projectId is required");
    }
    this.client = new TestPlanItClient({
      baseUrl: this.reporterOptions.domain,
      apiToken: this.reporterOptions.apiToken,
      timeout: this.reporterOptions.timeout,
      maxRetries: this.reporterOptions.maxRetries
    });
    this.state = {
      testRunId: typeof this.reporterOptions.testRunId === "number" ? this.reporterOptions.testRunId : void 0,
      resolvedIds: {},
      results: /* @__PURE__ */ new Map(),
      caseIdMap: /* @__PURE__ */ new Map(),
      testRunCaseMap: /* @__PURE__ */ new Map(),
      folderPathMap: /* @__PURE__ */ new Map(),
      statusIds: {},
      initialized: false,
      testSuiteStats: {
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0,
        time: 0
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
        startTime: /* @__PURE__ */ new Date()
      }
    };
  }
  /**
   * Log a message if verbose mode is enabled
   */
  log(message, ...args) {
    if (this.reporterOptions.verbose) {
      console.log(`[TestPlanIt] ${message}`, ...args);
    }
  }
  /**
   * Log an error (always logs, not just in verbose mode)
   */
  logError(message, error) {
    const errorMsg = error instanceof Error ? error.message : String(error ?? "");
    const stack = error instanceof Error && error.stack ? `
${error.stack}` : "";
    console.error(`[TestPlanIt] ERROR: ${message}`, errorMsg, stack);
  }
  /**
   * Get the path to the shared state file for oneReport mode.
   * Uses a file in the temp directory with a name based on the project ID.
   */
  getSharedStateFilePath() {
    const fileName = `.testplanit-reporter-${this.reporterOptions.projectId}.json`;
    return path.join(os.tmpdir(), fileName);
  }
  /**
   * Read shared state from file (for oneReport mode).
   * Returns null if file doesn't exist or is stale (older than 4 hours).
   */
  readSharedState() {
    const filePath = this.getSharedStateFilePath();
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const state = JSON.parse(content);
      const createdAt = new Date(state.createdAt);
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1e3);
      if (createdAt < fourHoursAgo) {
        this.log("Shared state file is stale, ignoring");
        this.deleteSharedState();
        return null;
      }
      return state;
    } catch (error) {
      this.log("Failed to read shared state file:", error);
      return null;
    }
  }
  /**
   * Write shared state to file (for oneReport mode).
   * Uses a lock file to prevent race conditions.
   * Only writes if the file doesn't exist yet (first writer wins).
   */
  writeSharedState(state) {
    const filePath = this.getSharedStateFilePath();
    const lockPath = `${filePath}.lock`;
    try {
      let lockAcquired = false;
      for (let i = 0; i < 10; i++) {
        try {
          fs.writeFileSync(lockPath, process.pid.toString(), { flag: "wx" });
          lockAcquired = true;
          break;
        } catch {
          const sleepMs = 50 * Math.pow(2, i) + Math.random() * 50;
          const start = Date.now();
          while (Date.now() - start < sleepMs) {
          }
        }
      }
      if (!lockAcquired) {
        this.log("Could not acquire lock for shared state file");
        return;
      }
      try {
        if (fs.existsSync(filePath)) {
          this.log("Shared state file already exists, not overwriting");
          return;
        }
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
        this.log("Wrote shared state file:", filePath);
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
        }
      }
    } catch (error) {
      this.log("Failed to write shared state file:", error);
    }
  }
  /**
   * Delete shared state file (cleanup after run completes).
   */
  deleteSharedState() {
    const filePath = this.getSharedStateFilePath();
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.log("Deleted shared state file");
      }
    } catch (error) {
      this.log("Failed to delete shared state file:", error);
    }
  }
  /**
   * Track an async operation to prevent the runner from terminating early.
   * The operation is added to pendingOperations and removed when complete.
   * WebdriverIO checks isSynchronised and waits until all operations finish.
   */
  trackOperation(operation) {
    this.pendingOperations.add(operation);
    operation.finally(() => {
      this.pendingOperations.delete(operation);
    });
  }
  /**
   * Initialize the reporter (create test run, fetch statuses)
   */
  async initialize() {
    if (this.state.initialized) return;
    if (this.state.initError) {
      throw this.state.initError;
    }
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }
  async doInitialize() {
    try {
      this.log("Initializing reporter...");
      this.log(`  Domain: ${this.reporterOptions.domain}`);
      this.log(`  Project ID: ${this.reporterOptions.projectId}`);
      this.log(`  oneReport: ${this.reporterOptions.oneReport}`);
      this.log("Resolving option IDs...");
      await this.resolveOptionIds();
      this.log("Fetching status mappings...");
      await this.fetchStatusMappings();
      if (this.reporterOptions.oneReport && !this.state.testRunId) {
        const sharedState = this.readSharedState();
        if (sharedState) {
          this.state.testRunId = sharedState.testRunId;
          this.state.testSuiteId = sharedState.testSuiteId;
          this.log(`Using shared test run from file: ${sharedState.testRunId}`);
          try {
            const testRun = await this.client.getTestRun(this.state.testRunId);
            this.log(`Validated shared test run: ${testRun.name} (ID: ${testRun.id})`);
          } catch {
            this.log("Shared test run no longer exists, will create new one");
            this.state.testRunId = void 0;
            this.state.testSuiteId = void 0;
            this.deleteSharedState();
          }
        }
      }
      if (!this.state.testRunId) {
        if (this.reporterOptions.oneReport) {
          await this.createTestRun();
          this.log(`Created test run with ID: ${this.state.testRunId}`);
          this.writeSharedState({
            testRunId: this.state.testRunId,
            testSuiteId: this.state.testSuiteId,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          const finalState = this.readSharedState();
          if (finalState && finalState.testRunId !== this.state.testRunId) {
            this.log(`Another worker created test run first, switching from ${this.state.testRunId} to ${finalState.testRunId}`);
            this.state.testRunId = finalState.testRunId;
            this.state.testSuiteId = finalState.testSuiteId;
          }
        } else {
          await this.createTestRun();
          this.log(`Created test run with ID: ${this.state.testRunId}`);
        }
      } else if (!this.reporterOptions.oneReport) {
        try {
          const testRun = await this.client.getTestRun(this.state.testRunId);
          this.log(`Using existing test run: ${testRun.name} (ID: ${testRun.id})`);
        } catch (error) {
          throw new Error(`Test run ${this.state.testRunId} not found or not accessible`);
        }
      }
      this.state.initialized = true;
      this.log("Reporter initialized successfully");
    } catch (error) {
      this.state.initError = error instanceof Error ? error : new Error(String(error));
      this.logError("Failed to initialize reporter:", error);
      throw error;
    }
  }
  /**
   * Resolve option names to numeric IDs
   */
  async resolveOptionIds() {
    const projectId = this.reporterOptions.projectId;
    if (typeof this.reporterOptions.testRunId === "string") {
      const testRun = await this.client.findTestRunByName(projectId, this.reporterOptions.testRunId);
      if (!testRun) {
        throw new Error(`Test run not found: "${this.reporterOptions.testRunId}"`);
      }
      this.state.testRunId = testRun.id;
      this.state.resolvedIds.testRunId = testRun.id;
      this.log(`Resolved test run "${this.reporterOptions.testRunId}" -> ${testRun.id}`);
    }
    if (typeof this.reporterOptions.configId === "string") {
      const config = await this.client.findConfigurationByName(projectId, this.reporterOptions.configId);
      if (!config) {
        throw new Error(`Configuration not found: "${this.reporterOptions.configId}"`);
      }
      this.state.resolvedIds.configId = config.id;
      this.log(`Resolved configuration "${this.reporterOptions.configId}" -> ${config.id}`);
    } else if (typeof this.reporterOptions.configId === "number") {
      this.state.resolvedIds.configId = this.reporterOptions.configId;
    }
    if (typeof this.reporterOptions.milestoneId === "string") {
      const milestone = await this.client.findMilestoneByName(projectId, this.reporterOptions.milestoneId);
      if (!milestone) {
        throw new Error(`Milestone not found: "${this.reporterOptions.milestoneId}"`);
      }
      this.state.resolvedIds.milestoneId = milestone.id;
      this.log(`Resolved milestone "${this.reporterOptions.milestoneId}" -> ${milestone.id}`);
    } else if (typeof this.reporterOptions.milestoneId === "number") {
      this.state.resolvedIds.milestoneId = this.reporterOptions.milestoneId;
    }
    if (typeof this.reporterOptions.stateId === "string") {
      const state = await this.client.findWorkflowStateByName(projectId, this.reporterOptions.stateId);
      if (!state) {
        throw new Error(`Workflow state not found: "${this.reporterOptions.stateId}"`);
      }
      this.state.resolvedIds.stateId = state.id;
      this.log(`Resolved workflow state "${this.reporterOptions.stateId}" -> ${state.id}`);
    } else if (typeof this.reporterOptions.stateId === "number") {
      this.state.resolvedIds.stateId = this.reporterOptions.stateId;
    }
    if (typeof this.reporterOptions.parentFolderId === "string") {
      let folder = await this.client.findFolderByName(projectId, this.reporterOptions.parentFolderId);
      if (!folder) {
        if (this.reporterOptions.createFolderHierarchy) {
          this.log(`Parent folder "${this.reporterOptions.parentFolderId}" not found, creating it...`);
          folder = await this.client.createFolder({
            projectId,
            name: this.reporterOptions.parentFolderId
          });
          this.log(`Created parent folder "${this.reporterOptions.parentFolderId}" -> ${folder.id}`);
        } else {
          throw new Error(`Folder not found: "${this.reporterOptions.parentFolderId}"`);
        }
      }
      this.state.resolvedIds.parentFolderId = folder.id;
      this.log(`Resolved folder "${this.reporterOptions.parentFolderId}" -> ${folder.id}`);
    } else if (typeof this.reporterOptions.parentFolderId === "number") {
      this.state.resolvedIds.parentFolderId = this.reporterOptions.parentFolderId;
    }
    if (typeof this.reporterOptions.templateId === "string") {
      const template = await this.client.findTemplateByName(projectId, this.reporterOptions.templateId);
      if (!template) {
        throw new Error(`Template not found: "${this.reporterOptions.templateId}"`);
      }
      this.state.resolvedIds.templateId = template.id;
      this.log(`Resolved template "${this.reporterOptions.templateId}" -> ${template.id}`);
    } else if (typeof this.reporterOptions.templateId === "number") {
      this.state.resolvedIds.templateId = this.reporterOptions.templateId;
    }
    if (this.reporterOptions.tagIds && this.reporterOptions.tagIds.length > 0) {
      this.state.resolvedIds.tagIds = await this.client.resolveTagIds(projectId, this.reporterOptions.tagIds);
      this.log(`Resolved tags: ${this.state.resolvedIds.tagIds.join(", ")}`);
    }
  }
  /**
   * Fetch status ID mappings from TestPlanIt
   */
  async fetchStatusMappings() {
    const statuses = ["passed", "failed", "skipped", "blocked"];
    for (const status of statuses) {
      const statusId = await this.client.getStatusId(this.reporterOptions.projectId, status);
      if (statusId) {
        this.state.statusIds[status] = statusId;
        this.log(`Status mapping: ${status} -> ${statusId}`);
      }
    }
    if (!this.state.statusIds.passed || !this.state.statusIds.failed) {
      throw new Error("Could not find required status mappings (passed/failed) in TestPlanIt");
    }
  }
  /**
   * Map test status to JUnit result type
   */
  mapStatusToJUnitType(status) {
    switch (status) {
      case "passed":
        return "PASSED";
      case "failed":
        return "FAILURE";
      case "skipped":
      case "pending":
        return "SKIPPED";
      default:
        return "FAILURE";
    }
  }
  /**
   * Create the JUnit test suite for this test run
   */
  async createJUnitTestSuite() {
    if (this.state.testSuiteId) {
      return;
    }
    if (!this.state.testRunId) {
      throw new Error("Cannot create JUnit test suite without a test run ID");
    }
    const runName = this.formatRunName(this.reporterOptions.runName || "{suite} - {date} {time}");
    this.log("Creating JUnit test suite...");
    const testSuite = await this.client.createJUnitTestSuite({
      testRunId: this.state.testRunId,
      name: runName,
      time: 0,
      // Will be updated incrementally
      tests: 0,
      failures: 0,
      errors: 0,
      skipped: 0
    });
    this.state.testSuiteId = testSuite.id;
    this.log("Created JUnit test suite with ID:", testSuite.id);
    if (this.reporterOptions.oneReport) {
      this.writeSharedState({
        testRunId: this.state.testRunId,
        testSuiteId: this.state.testSuiteId,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  /**
   * Map WebdriverIO framework name to TestPlanIt test run type
   */
  getTestRunType() {
    if (this.reporterOptions.testRunType) {
      return this.reporterOptions.testRunType;
    }
    if (this.detectedFramework) {
      const framework = this.detectedFramework.toLowerCase();
      if (framework === "mocha") return "MOCHA";
      if (framework === "cucumber") return "CUCUMBER";
      return "REGULAR";
    }
    return "MOCHA";
  }
  /**
   * Create a new test run
   */
  async createTestRun() {
    const runName = this.formatRunName(this.reporterOptions.runName || "{suite} - {date} {time}");
    const testRunType = this.getTestRunType();
    this.log("Creating test run:", runName, "(type:", testRunType + ")");
    const testRun = await this.client.createTestRun({
      projectId: this.reporterOptions.projectId,
      name: runName,
      testRunType,
      configId: this.state.resolvedIds.configId,
      milestoneId: this.state.resolvedIds.milestoneId,
      stateId: this.state.resolvedIds.stateId,
      tagIds: this.state.resolvedIds.tagIds
    });
    this.state.testRunId = testRun.id;
    this.log("Created test run with ID:", testRun.id);
  }
  /**
   * Format the run name with placeholders
   */
  formatRunName(template) {
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toTimeString().split(" ")[0];
    const browser = this.state.capabilities?.browserName || "unknown";
    const platform = this.state.capabilities?.platformName || process.platform;
    let spec = "unknown";
    if (this.currentSpec) {
      const parts = this.currentSpec.split("/");
      spec = parts[parts.length - 1] || "unknown";
      spec = spec.replace(/\.(spec|test)\.(ts|js|mjs|cjs)$/, "");
    }
    const suite = this.currentSuite[0] || "Tests";
    return template.replace("{date}", date).replace("{time}", time).replace("{browser}", browser).replace("{platform}", platform).replace("{spec}", spec).replace("{suite}", suite);
  }
  /**
   * Parse case IDs from test title using the configured pattern
   * @example With default pattern: "[1761] [1762] should load the page" -> [1761, 1762]
   * @example With C-prefix pattern: "C12345 C67890 should load the page" -> [12345, 67890]
   */
  parseCaseIds(title) {
    const pattern = this.reporterOptions.caseIdPattern || /\[(\d+)\]/g;
    const regex = typeof pattern === "string" ? new RegExp(pattern, "g") : new RegExp(pattern.source, "g");
    const caseIds = [];
    let match;
    while ((match = regex.exec(title)) !== null) {
      for (let i = 1; i < match.length; i++) {
        if (match[i]) {
          caseIds.push(parseInt(match[i], 10));
          break;
        }
      }
    }
    const cleanTitle = title.replace(regex, "").trim().replace(/\s+/g, " ");
    return { caseIds, cleanTitle };
  }
  /**
   * Get the full suite path as a string
   */
  getFullSuiteName() {
    return this.currentSuite.join(" > ");
  }
  /**
   * Create a unique key for a test case
   */
  createCaseKey(suiteName, testName) {
    return `${suiteName}::${testName}`;
  }
  // ============================================================================
  // WebdriverIO Reporter Hooks
  // ============================================================================
  onRunnerStart(runner) {
    this.log("Runner started:", runner.cid);
    this.state.capabilities = runner.capabilities;
    const config = runner.config;
    if (config?.framework) {
      this.detectedFramework = config.framework;
      this.log("Detected framework:", this.detectedFramework);
    }
  }
  onSuiteStart(suite) {
    if (suite.title) {
      this.currentSuite.push(suite.title);
      this.log("Suite started:", this.getFullSuiteName());
    }
  }
  onSuiteEnd(suite) {
    if (suite.title) {
      this.log("Suite ended:", this.getFullSuiteName());
      this.currentSuite.pop();
    }
  }
  onTestStart(test) {
    this.log("Test started:", test.title);
    const { cleanTitle } = this.parseCaseIds(test.title);
    const suiteName = this.getFullSuiteName();
    const fullTitle = suiteName ? `${suiteName} > ${cleanTitle}` : cleanTitle;
    this.currentTestUid = `${test.cid}_${fullTitle}`;
    this.currentCid = test.cid;
  }
  /**
   * Capture screenshots from WebdriverIO commands
   */
  onAfterCommand(commandArgs) {
    if (!this.reporterOptions.uploadScreenshots) {
      return;
    }
    const isScreenshotCommand = commandArgs.command === "takeScreenshot" || commandArgs.command === "saveScreenshot" || commandArgs.endpoint?.includes("/screenshot");
    if (!isScreenshotCommand) {
      return;
    }
    this.log(`Screenshot command detected: ${commandArgs.command}, endpoint: ${commandArgs.endpoint}`);
    const result = commandArgs.result;
    const resultValue = (typeof result === "object" && result !== null ? result.value : result) ?? result;
    if (!resultValue) {
      this.log("No result value in screenshot command");
      return;
    }
    const screenshotData = resultValue;
    if (typeof screenshotData !== "string") {
      this.log(`Screenshot result is not a string: ${typeof screenshotData}`);
      return;
    }
    const looksLikeFilePath = screenshotData.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(screenshotData) || screenshotData.startsWith("./") || screenshotData.startsWith("../");
    if (looksLikeFilePath) {
      this.log(`Screenshot result appears to be a file path: ${screenshotData.substring(0, 100)}`);
      return;
    }
    if (this.currentTestUid) {
      const buffer = Buffer.from(screenshotData, "base64");
      const existing = this.pendingScreenshots.get(this.currentTestUid) || [];
      existing.push(buffer);
      this.pendingScreenshots.set(this.currentTestUid, existing);
      this.log("Captured screenshot for test:", this.currentTestUid, `(${buffer.length} bytes)`);
    } else {
      this.log("No current test UID to associate screenshot with");
    }
  }
  onTestPass(test) {
    this.handleTestEnd(test, "passed");
  }
  onTestFail(test) {
    this.handleTestEnd(test, "failed");
  }
  onTestSkip(test) {
    this.handleTestEnd(test, "skipped");
  }
  /**
   * Handle test completion
   */
  handleTestEnd(test, status) {
    const { caseIds, cleanTitle } = this.parseCaseIds(test.title);
    const suiteName = this.getFullSuiteName();
    const suitePath = [...this.currentSuite];
    const fullTitle = suiteName ? `${suiteName} > ${cleanTitle}` : cleanTitle;
    const uid = `${test.cid}_${fullTitle}`;
    const startTime = new Date(test.start).getTime();
    const endTime = test.end ? new Date(test.end).getTime() : Date.now();
    const durationMs = endTime - startTime;
    let commandOutput;
    if (test.output && test.output.length > 0) {
      commandOutput = test.output.map((o) => {
        const parts = [];
        if (o.method) parts.push(`[${o.method}]`);
        if (o.endpoint) parts.push(o.endpoint);
        if (o.result !== void 0) {
          const resultStr = typeof o.result === "string" ? o.result : JSON.stringify(o.result);
          parts.push(resultStr.length > 200 ? resultStr.substring(0, 200) + "..." : resultStr);
        }
        return parts.join(" ");
      }).join("\n");
    }
    const result = {
      caseId: caseIds[0],
      // Primary case ID
      suiteName,
      suitePath,
      testName: cleanTitle,
      fullTitle,
      originalTitle: test.title,
      status,
      duration: durationMs,
      errorMessage: test.error?.message,
      stackTrace: this.reporterOptions.includeStackTrace ? test.error?.stack : void 0,
      startedAt: new Date(test.start),
      finishedAt: new Date(endTime),
      browser: this.state.capabilities?.browserName,
      platform: this.state.capabilities?.platformName || process.platform,
      screenshots: [],
      retryAttempt: test.retries || 0,
      uid,
      specFile: this.currentSpec,
      commandOutput
    };
    this.state.results.set(uid, result);
    this.log(`Test ${status}:`, cleanTitle, caseIds.length > 0 ? `(Case IDs: ${caseIds.join(", ")})` : "");
    const reportPromise = this.reportResult(result, caseIds);
    this.trackOperation(reportPromise);
  }
  /**
   * Report a single test result to TestPlanIt
   */
  async reportResult(result, caseIds) {
    try {
      if (caseIds.length === 0 && !this.reporterOptions.autoCreateTestCases) {
        console.warn(`[TestPlanIt] WARNING: Skipping "${result.testName}" - no case ID found and autoCreateTestCases is disabled. Set autoCreateTestCases: true to automatically find or create test cases by name.`);
        return;
      }
      await this.initialize();
      if (!this.state.testRunId) {
        this.logError("No test run ID available, skipping result");
        return;
      }
      await this.createJUnitTestSuite();
      if (!this.state.testSuiteId) {
        this.logError("No test suite ID available, skipping result");
        return;
      }
      let repositoryCaseId;
      const caseKey = this.createCaseKey(result.suiteName, result.testName);
      this.log("DEBUG: Processing test:", result.testName);
      this.log("DEBUG: suiteName:", result.suiteName);
      this.log("DEBUG: suitePath:", JSON.stringify(result.suitePath));
      this.log("DEBUG: caseIds from title:", JSON.stringify(caseIds));
      this.log("DEBUG: autoCreateTestCases:", this.reporterOptions.autoCreateTestCases);
      this.log("DEBUG: createFolderHierarchy:", this.reporterOptions.createFolderHierarchy);
      if (caseIds.length > 0) {
        repositoryCaseId = caseIds[0];
        this.log("DEBUG: Using case ID from title:", repositoryCaseId);
      } else if (this.reporterOptions.autoCreateTestCases) {
        if (this.state.caseIdMap.has(caseKey)) {
          repositoryCaseId = this.state.caseIdMap.get(caseKey);
          this.log("DEBUG: Found in cache:", caseKey, "->", repositoryCaseId);
        } else {
          let folderId = this.state.resolvedIds.parentFolderId;
          const templateId = this.state.resolvedIds.templateId;
          this.log("DEBUG: Initial folderId (parentFolderId):", folderId);
          this.log("DEBUG: templateId:", templateId);
          if (!folderId || !templateId) {
            this.logError("autoCreateTestCases requires parentFolderId and templateId");
            return;
          }
          this.log("DEBUG: Checking folder hierarchy - createFolderHierarchy:", this.reporterOptions.createFolderHierarchy, "suitePath.length:", result.suitePath.length);
          if (this.reporterOptions.createFolderHierarchy && result.suitePath.length > 0) {
            const folderPathKey = result.suitePath.join(" > ");
            this.log("DEBUG: Will create folder hierarchy for path:", folderPathKey);
            if (this.state.folderPathMap.has(folderPathKey)) {
              folderId = this.state.folderPathMap.get(folderPathKey);
              this.log("Using cached folder ID for path:", folderPathKey, "->", folderId);
            } else {
              this.log("Creating folder hierarchy:", result.suitePath.join(" > "));
              this.log("DEBUG: Calling findOrCreateFolderPath with projectId:", this.reporterOptions.projectId, "suitePath:", JSON.stringify(result.suitePath), "parentFolderId:", this.state.resolvedIds.parentFolderId);
              const folder = await this.client.findOrCreateFolderPath(
                this.reporterOptions.projectId,
                result.suitePath,
                this.state.resolvedIds.parentFolderId
              );
              folderId = folder.id;
              this.state.folderPathMap.set(folderPathKey, folderId);
              this.log("Created/found folder:", folder.name, "(ID:", folder.id + ")");
            }
          } else {
            this.log("DEBUG: Skipping folder hierarchy - createFolderHierarchy:", this.reporterOptions.createFolderHierarchy, "suitePath.length:", result.suitePath.length);
          }
          this.log("DEBUG: Final folderId for test case:", folderId);
          const { testCase, action } = await this.client.findOrCreateTestCase({
            projectId: this.reporterOptions.projectId,
            folderId,
            templateId,
            name: result.testName,
            className: result.suiteName || void 0,
            source: "API",
            automated: true
          });
          if (action === "found") {
            this.state.stats.testCasesFound++;
          } else if (action === "created") {
            this.state.stats.testCasesCreated++;
          } else if (action === "moved") {
            this.state.stats.testCasesMoved++;
          }
          repositoryCaseId = testCase.id;
          this.state.caseIdMap.set(caseKey, repositoryCaseId);
          this.log(`${action === "found" ? "Found" : action === "created" ? "Created" : "Moved"} test case:`, testCase.id, testCase.name, "in folder:", folderId);
        }
      } else {
        this.log("DEBUG: autoCreateTestCases is false, not creating test case");
      }
      if (!repositoryCaseId) {
        this.log("No repository case ID, skipping result");
        return;
      }
      let testRunCaseId;
      const runCaseKey = `${this.state.testRunId}_${repositoryCaseId}`;
      if (this.state.testRunCaseMap.has(runCaseKey)) {
        testRunCaseId = this.state.testRunCaseMap.get(runCaseKey);
      } else {
        const testRunCase = await this.client.findOrAddTestCaseToRun({
          testRunId: this.state.testRunId,
          repositoryCaseId
        });
        testRunCaseId = testRunCase.id;
        this.state.testRunCaseMap.set(runCaseKey, testRunCaseId);
        this.log("Added case to run:", testRunCaseId);
      }
      const statusId = this.state.statusIds[result.status] || this.state.statusIds.failed;
      const junitType = this.mapStatusToJUnitType(result.status);
      let message;
      let content;
      if (result.errorMessage) {
        message = result.errorMessage;
      }
      if (result.stackTrace) {
        content = result.stackTrace;
      }
      const durationInSeconds = result.duration / 1e3;
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
        systemOut: result.commandOutput
      });
      this.log("Created JUnit test result:", junitResult.id, "(type:", junitType + ")");
      this.reportedResultCount++;
      result.junitResultId = junitResult.id;
      this.state.testSuiteStats.tests++;
      this.state.testSuiteStats.time += durationInSeconds;
      if (result.status === "failed") {
        this.state.testSuiteStats.failures++;
        this.state.stats.resultsFailed++;
      } else if (result.status === "skipped") {
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
  async onRunnerEnd(runner) {
    if (this.state.results.size === 0 && !this.initPromise) {
      this.log("No test results to report, skipping");
      return;
    }
    this.log("Runner ended, waiting for initialization and pending results...");
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
      }
    }
    await Promise.allSettled([...this.pendingOperations]);
    if (this.state.initError) {
      console.error("\n[TestPlanIt] FAILED: Reporter initialization failed");
      console.error(`  Error: ${this.state.initError.message}`);
      console.error("  No results were reported to TestPlanIt.");
      console.error("  Please check your configuration and API connectivity.");
      return;
    }
    if (!this.state.testRunId) {
      this.log("No test run created, skipping summary");
      return;
    }
    if (this.reportedResultCount === 0) {
      this.log("No results were reported to TestPlanIt, skipping summary");
      return;
    }
    if (this.reporterOptions.uploadScreenshots && this.pendingScreenshots.size > 0) {
      this.log(`Uploading screenshots for ${this.pendingScreenshots.size} test(s)...`);
      const uploadPromises = [];
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
              const sanitizedTestName = result.testName.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
              const fileName = `${sanitizedTestName}_${result.status}_${i + 1}.png`;
              const noteParts = [];
              noteParts.push(`Test: ${result.testName}`);
              if (result.suiteName) {
                noteParts.push(`Suite: ${result.suiteName}`);
              }
              noteParts.push(`Status: ${result.status}`);
              if (result.browser) {
                noteParts.push(`Browser: ${result.browser}`);
              }
              if (result.errorMessage) {
                const errorPreview = result.errorMessage.length > 200 ? result.errorMessage.substring(0, 200) + "..." : result.errorMessage;
                noteParts.push(`Error: ${errorPreview}`);
              }
              const note = noteParts.join("\n");
              this.log(`Starting upload of ${fileName} (${screenshots[i].length} bytes) to JUnit result ${result.junitResultId}...`);
              await this.client.uploadJUnitAttachment(
                result.junitResultId,
                screenshots[i],
                fileName,
                "image/png",
                note
              );
              this.state.stats.screenshotsUploaded++;
              this.log(`Uploaded screenshot ${i + 1}/${screenshots.length} for ${result.testName}`);
            } catch (uploadError) {
              this.state.stats.screenshotsFailed++;
              const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
              const errorStack = uploadError instanceof Error ? uploadError.stack : void 0;
              this.logError(`Failed to upload screenshot ${i + 1}:`, errorMessage);
              if (errorStack) {
                this.logError("Stack trace:", errorStack);
              }
            }
          })();
          this.trackOperation(uploadPromise);
          uploadPromises.push(uploadPromise);
        }
      }
      await Promise.allSettled(uploadPromises);
      this.pendingScreenshots.clear();
    }
    if (this.state.testSuiteId) {
      const updateSuiteOp = (async () => {
        try {
          await this.client.updateJUnitTestSuite(this.state.testSuiteId, {
            tests: this.state.testSuiteStats.tests,
            failures: this.state.testSuiteStats.failures,
            errors: this.state.testSuiteStats.errors,
            skipped: this.state.testSuiteStats.skipped,
            time: this.state.testSuiteStats.time
          });
          this.log("Updated test suite statistics:", this.state.testSuiteStats);
        } catch (error) {
          this.logError("Failed to update test suite statistics:", error);
        }
      })();
      this.trackOperation(updateSuiteOp);
      await updateSuiteOp;
    }
    if (this.reporterOptions.completeRunOnFinish && !this.reporterOptions.oneReport) {
      const completeRunOp = (async () => {
        try {
          await this.client.completeTestRun(this.state.testRunId, this.reporterOptions.projectId);
          this.log("Test run completed:", this.state.testRunId);
        } catch (error) {
          this.logError("Failed to complete test run:", error);
        }
      })();
      this.trackOperation(completeRunOp);
      await completeRunOp;
    } else if (this.reporterOptions.oneReport) {
      this.log("Skipping test run completion (oneReport mode - run will remain in progress)");
    }
    const stats = this.state.stats;
    const duration = ((Date.now() - stats.startTime.getTime()) / 1e3).toFixed(1);
    const totalResults = stats.resultsPassed + stats.resultsFailed + stats.resultsSkipped;
    const totalCases = stats.testCasesFound + stats.testCasesCreated + stats.testCasesMoved;
    console.log("\n[TestPlanIt] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log("[TestPlanIt] Results Summary");
    console.log("[TestPlanIt] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log(`[TestPlanIt]   Test Run ID: ${this.state.testRunId}`);
    console.log(`[TestPlanIt]   Duration: ${duration}s`);
    console.log("[TestPlanIt]");
    console.log("[TestPlanIt]   Test Results:");
    console.log(`[TestPlanIt]     \u2713 Passed:  ${stats.resultsPassed}`);
    console.log(`[TestPlanIt]     \u2717 Failed:  ${stats.resultsFailed}`);
    console.log(`[TestPlanIt]     \u25CB Skipped: ${stats.resultsSkipped}`);
    console.log(`[TestPlanIt]     Total:     ${totalResults}`);
    if (this.reporterOptions.autoCreateTestCases && totalCases > 0) {
      console.log("[TestPlanIt]");
      console.log("[TestPlanIt]   Test Cases:");
      console.log(`[TestPlanIt]     Found (existing): ${stats.testCasesFound}`);
      console.log(`[TestPlanIt]     Created (new):    ${stats.testCasesCreated}`);
      if (stats.testCasesMoved > 0) {
        console.log(`[TestPlanIt]     Moved (restored): ${stats.testCasesMoved}`);
      }
    }
    if (this.reporterOptions.uploadScreenshots && (stats.screenshotsUploaded > 0 || stats.screenshotsFailed > 0)) {
      console.log("[TestPlanIt]");
      console.log("[TestPlanIt]   Screenshots:");
      console.log(`[TestPlanIt]     Uploaded: ${stats.screenshotsUploaded}`);
      if (stats.screenshotsFailed > 0) {
        console.log(`[TestPlanIt]     Failed:   ${stats.screenshotsFailed}`);
      }
    }
    if (stats.apiErrors > 0) {
      console.log("[TestPlanIt]");
      console.log(`[TestPlanIt]   \u26A0 API Errors: ${stats.apiErrors}`);
    }
    console.log("[TestPlanIt]");
    console.log(`[TestPlanIt]   View results: ${this.reporterOptions.domain}/projects/runs/${this.reporterOptions.projectId}/${this.state.testRunId}`);
    console.log("[TestPlanIt] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
  }
  /**
   * Get the current state (for debugging)
   */
  getState() {
    return this.state;
  }
};

export { TestPlanItReporter, TestPlanItReporter as default };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map