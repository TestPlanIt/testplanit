import WDIOReporter from '@wdio/reporter';
import { TestPlanItClient } from '@testplanit/api';
export { TestPlanItClient, TestPlanItError } from '@testplanit/api';
import * as fs from 'fs';
import * as path from 'path';

// src/reporter.ts
var TestPlanItReporter = class extends WDIOReporter {
  client;
  reporterOptions;
  state;
  currentSuite = [];
  initPromise = null;
  pendingResults = [];
  constructor(options) {
    super(options);
    this.reporterOptions = {
      caseIdPattern: /\[(\d+)\]/g,
      autoCreateTestCases: false,
      uploadScreenshots: true,
      includeConsoleLogs: false,
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
      statusIds: {},
      initialized: false
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
   * Log an error
   */
  logError(message, error) {
    console.error(`[TestPlanIt] ${message}`, error instanceof Error ? error.message : error);
  }
  /**
   * Initialize the reporter (create test run, fetch statuses)
   */
  async initialize() {
    if (this.state.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }
  async doInitialize() {
    try {
      this.log("Initializing reporter...");
      await this.resolveOptionIds();
      await this.fetchStatusMappings();
      if (!this.state.testRunId) {
        await this.createTestRun();
      } else {
        try {
          const testRun = await this.client.getTestRun(this.state.testRunId);
          this.log("Using existing test run:", testRun.name);
        } catch (error) {
          throw new Error(`Test run ${this.state.testRunId} not found or not accessible`);
        }
      }
      this.state.initialized = true;
      this.log("Reporter initialized successfully. Test Run ID:", this.state.testRunId);
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
      const folder = await this.client.findFolderByName(projectId, this.reporterOptions.parentFolderId);
      if (!folder) {
        throw new Error(`Folder not found: "${this.reporterOptions.parentFolderId}"`);
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
   * Create a new test run
   */
  async createTestRun() {
    const runName = this.formatRunName(this.reporterOptions.runName || "WebdriverIO Test Run - {date} {time}");
    this.log("Creating test run:", runName);
    const testRun = await this.client.createTestRun({
      projectId: this.reporterOptions.projectId,
      name: runName,
      testRunType: "REGULAR",
      configId: this.state.resolvedIds.configId,
      milestoneId: this.state.resolvedIds.milestoneId,
      stateId: this.state.resolvedIds.stateId
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
    return template.replace("{date}", date).replace("{time}", time).replace("{browser}", browser).replace("{platform}", platform);
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
    this.initialize().catch((error) => {
      this.logError("Failed to initialize during runner start:", error);
    });
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
    const fullTitle = suiteName ? `${suiteName} > ${cleanTitle}` : cleanTitle;
    const uid = `${test.cid}_${fullTitle}`;
    const result = {
      caseId: caseIds[0],
      // Primary case ID
      suiteName,
      testName: cleanTitle,
      fullTitle,
      originalTitle: test.title,
      status,
      duration: test.duration || 0,
      errorMessage: test.error?.message,
      stackTrace: this.reporterOptions.includeStackTrace ? test.error?.stack : void 0,
      startedAt: new Date(test.start),
      finishedAt: new Date(test.end || Date.now()),
      browser: this.state.capabilities?.browserName,
      platform: this.state.capabilities?.platformName || process.platform,
      screenshots: [],
      consoleLogs: [],
      retryAttempt: test.retries || 0,
      uid
    };
    this.state.results.set(uid, result);
    this.log(`Test ${status}:`, cleanTitle, caseIds.length > 0 ? `(Case IDs: ${caseIds.join(", ")})` : "");
    const reportPromise = this.reportResult(result, caseIds);
    this.pendingResults.push(reportPromise);
  }
  /**
   * Report a single test result to TestPlanIt
   */
  async reportResult(result, caseIds) {
    try {
      await this.initialize();
      if (!this.state.testRunId) {
        this.logError("No test run ID available, skipping result");
        return;
      }
      if (caseIds.length === 0 && !this.reporterOptions.autoCreateTestCases) {
        console.warn(`[TestPlanIt] WARNING: Skipping "${result.testName}" - no case ID found and autoCreateTestCases is disabled. Set autoCreateTestCases: true to automatically find or create test cases by name.`);
        return;
      }
      let repositoryCaseId;
      const caseKey = this.createCaseKey(result.suiteName, result.testName);
      if (caseIds.length > 0) {
        repositoryCaseId = caseIds[0];
      } else if (this.reporterOptions.autoCreateTestCases) {
        if (this.state.caseIdMap.has(caseKey)) {
          repositoryCaseId = this.state.caseIdMap.get(caseKey);
        } else {
          const folderId = this.state.resolvedIds.parentFolderId;
          const templateId = this.state.resolvedIds.templateId;
          if (!folderId || !templateId) {
            this.logError("autoCreateTestCases requires parentFolderId and templateId");
            return;
          }
          const testCase = await this.client.findOrCreateTestCase({
            projectId: this.reporterOptions.projectId,
            folderId,
            templateId,
            name: result.testName,
            className: result.suiteName || void 0,
            source: "API",
            automated: true
          });
          repositoryCaseId = testCase.id;
          this.state.caseIdMap.set(caseKey, repositoryCaseId);
          this.log("Created/found test case:", testCase.id, testCase.name);
        }
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
      const evidence = {};
      const notes = {};
      if (result.errorMessage) {
        notes["error"] = result.errorMessage;
      }
      if (result.stackTrace) {
        evidence["stackTrace"] = result.stackTrace;
      }
      if (result.consoleLogs.length > 0) {
        evidence["consoleLogs"] = result.consoleLogs;
      }
      const testResult = await this.client.createTestResult({
        testRunId: this.state.testRunId,
        testRunCaseId,
        statusId,
        elapsed: result.duration,
        notes: Object.keys(notes).length > 0 ? notes : void 0,
        evidence: Object.keys(evidence).length > 0 ? evidence : void 0,
        attempt: result.retryAttempt + 1
      });
      this.log("Created test result:", testResult.id);
      if (this.reporterOptions.uploadScreenshots && result.status === "failed" && result.screenshots.length > 0) {
        for (const screenshotPath of result.screenshots) {
          await this.uploadScreenshot(testResult.id, screenshotPath);
        }
      }
    } catch (error) {
      this.logError(`Failed to report result for ${result.testName}:`, error);
    }
  }
  /**
   * Upload a screenshot attachment
   */
  async uploadScreenshot(testRunResultId, screenshotPath) {
    try {
      if (!fs.existsSync(screenshotPath)) {
        this.log("Screenshot file not found:", screenshotPath);
        return;
      }
      const fileBuffer = fs.readFileSync(screenshotPath);
      const fileName = path.basename(screenshotPath);
      await this.client.uploadAttachment(testRunResultId, fileBuffer, fileName, "image/png");
      this.log("Uploaded screenshot:", fileName);
    } catch (error) {
      this.logError("Failed to upload screenshot:", error);
    }
  }
  /**
   * Called when the entire test session ends
   */
  async onRunnerEnd(runner) {
    this.log("Runner ended, waiting for pending results...");
    await Promise.allSettled(this.pendingResults);
    if (this.reporterOptions.completeRunOnFinish && this.state.testRunId) {
      try {
        await this.client.completeTestRun(this.state.testRunId);
        this.log("Test run completed:", this.state.testRunId);
      } catch (error) {
        this.logError("Failed to complete test run:", error);
      }
    }
    const passed = Array.from(this.state.results.values()).filter((r) => r.status === "passed").length;
    const failed = Array.from(this.state.results.values()).filter((r) => r.status === "failed").length;
    const skipped = Array.from(this.state.results.values()).filter((r) => r.status === "skipped").length;
    console.log("\n[TestPlanIt] Results Summary:");
    console.log(`  Test Run ID: ${this.state.testRunId}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  URL: ${this.reporterOptions.domain}/projects/${this.reporterOptions.projectId}/test-runs/${this.state.testRunId}`);
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