'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var WDIOReporter = require('@wdio/reporter');
var api = require('@testplanit/api');
var fs = require('fs');
var path = require('path');
var os = require('os');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var WDIOReporter__default = /*#__PURE__*/_interopDefault(WDIOReporter);
var fs__namespace = /*#__PURE__*/_interopNamespace(fs);
var path__namespace = /*#__PURE__*/_interopNamespace(path);
var os__namespace = /*#__PURE__*/_interopNamespace(os);

// src/reporter.ts

// src/cucumberAdapter.ts
var PRIMARY_KEYWORDS = {
  Given: "precondition",
  When: "action",
  Then: "assertion"
};
var INHERITING_KEYWORDS = ["And", "But", "*"];
function adaptCucumberStepTitles(stepTitles) {
  const result = [];
  let lastPrimaryKind = "action";
  for (const raw of stepTitles) {
    const trimmed = raw.trim();
    let title = trimmed;
    let kind = lastPrimaryKind;
    let matched = false;
    for (const kw of Object.keys(PRIMARY_KEYWORDS)) {
      if (trimmed.startsWith(kw + " ")) {
        title = trimmed.slice(kw.length + 1);
        kind = PRIMARY_KEYWORDS[kw];
        lastPrimaryKind = kind;
        matched = true;
        break;
      }
    }
    if (!matched) {
      for (const kw of INHERITING_KEYWORDS) {
        if (trimmed.startsWith(kw + " ")) {
          title = trimmed.slice(kw.length + 1);
          kind = lastPrimaryKind;
          matched = true;
          break;
        }
      }
    }
    result.push({ title, kind });
  }
  return result;
}
var STALE_THRESHOLD_MS = 4 * 60 * 60 * 1e3;
function getSharedStateFilePath(projectId) {
  const fileName = `.testplanit-reporter-${projectId}.json`;
  return path__namespace.join(os__namespace.tmpdir(), fileName);
}
function acquireLock(lockPath, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fs__namespace.writeFileSync(lockPath, process.pid.toString(), { flag: "wx" });
      return true;
    } catch {
    }
  }
  return false;
}
function releaseLock(lockPath) {
  try {
    fs__namespace.unlinkSync(lockPath);
  } catch {
  }
}
function withLock(projectId, callback) {
  const filePath = getSharedStateFilePath(projectId);
  const lockPath = `${filePath}.lock`;
  if (!acquireLock(lockPath)) {
    return void 0;
  }
  try {
    return callback(filePath);
  } finally {
    releaseLock(lockPath);
  }
}
function readSharedState(projectId) {
  const filePath = getSharedStateFilePath(projectId);
  try {
    if (!fs__namespace.existsSync(filePath)) {
      return null;
    }
    const content = fs__namespace.readFileSync(filePath, "utf-8");
    const state = JSON.parse(content);
    const createdAt = new Date(state.createdAt);
    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    if (createdAt < staleThreshold) {
      deleteSharedState(projectId);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}
function writeSharedState(projectId, state) {
  withLock(projectId, (filePath) => {
    fs__namespace.writeFileSync(filePath, JSON.stringify(state, null, 2));
  });
}
function writeSharedStateIfAbsent(projectId, state) {
  return withLock(projectId, (filePath) => {
    if (fs__namespace.existsSync(filePath)) {
      const content = fs__namespace.readFileSync(filePath, "utf-8");
      const existingState = JSON.parse(content);
      if (!existingState.testSuiteId && state.testSuiteId) {
        existingState.testSuiteId = state.testSuiteId;
        fs__namespace.writeFileSync(filePath, JSON.stringify(existingState, null, 2));
      }
      return existingState;
    }
    fs__namespace.writeFileSync(filePath, JSON.stringify(state, null, 2));
    return state;
  });
}
function deleteSharedState(projectId) {
  const filePath = getSharedStateFilePath(projectId);
  try {
    if (fs__namespace.existsSync(filePath)) {
      fs__namespace.unlinkSync(filePath);
    }
  } catch {
  }
}
function incrementWorkerCount(projectId) {
  withLock(projectId, (filePath) => {
    if (fs__namespace.existsSync(filePath)) {
      const content = fs__namespace.readFileSync(filePath, "utf-8");
      const state = JSON.parse(content);
      state.activeWorkers = (state.activeWorkers || 0) + 1;
      fs__namespace.writeFileSync(filePath, JSON.stringify(state, null, 2));
    }
  });
}
function decrementWorkerCount(projectId) {
  const result = withLock(projectId, (filePath) => {
    if (fs__namespace.existsSync(filePath)) {
      const content = fs__namespace.readFileSync(filePath, "utf-8");
      const state = JSON.parse(content);
      state.activeWorkers = Math.max(0, (state.activeWorkers || 1) - 1);
      fs__namespace.writeFileSync(filePath, JSON.stringify(state, null, 2));
      return state.activeWorkers === 0;
    }
    return false;
  });
  return result ?? false;
}

// src/reporter.ts
var TestPlanItReporter = class _TestPlanItReporter extends WDIOReporter__default.default {
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
   * Low-level automation commands captured per running test uid (via
   * onBeforeCommand), fed to AI step derivation for non-Cucumber tests so the
   * steps reflect what the test actually did. Capped per test to bound payload.
   */
  testCommands = /* @__PURE__ */ new Map();
  static MAX_COMMANDS_PER_TEST = 100;
  /** Cucumber: accumulated step titles per active scenario suite uid. */
  pendingScenarioSteps = /* @__PURE__ */ new Map();
  /**
   * Non-Cucumber cases (no deterministic steps) collected across the run for a
   * single opt-in, batched LLM step-derivation request at onRunnerEnd. Keyed by
   * testCaseId so a case is requested at most once per run.
   */
  llmDerivationCases = /* @__PURE__ */ new Map();
  /** Cucumber: uid of the scenario suite currently open (null outside a scenario). */
  currentScenarioUid = null;
  /** Cucumber: in-progress plan for the open scenario, emitted once at onSuiteEnd. */
  currentScenarioPlan = null;
  cucumberStepNoticeLogged = false;
  /** When true, the TestPlanItService manages the test run lifecycle */
  managedByService = false;
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
      captureSteps: true,
      overwriteSteps: false,
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
    this.client = new api.TestPlanItClient({
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
      customFieldCaseMap: /* @__PURE__ */ new Map(),
      folderPathMap: /* @__PURE__ */ new Map(),
      caseStepsMap: /* @__PURE__ */ new Map(),
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
   * Decide whether to write a Cucumber scenario's captured steps to its case,
   * and write them via the shared mapper. No-op for non-Cucumber frameworks
   * (D-09). Writes on fresh create when captureSteps is on (D-04), or replaces
   * existing steps when overwriteSteps is on (D-05).
   */
  async writeScenarioSteps(testCaseId, action, result) {
    if (this.detectedFramework !== "cucumber") return;
    const titles = result.cucumberStepTitles;
    if (!titles || titles.length === 0) return;
    const rows = api.automationStepsToCaseSteps(adaptCucumberStepTitles(titles));
    if (action === "created" && this.reporterOptions.captureSteps !== false) {
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
  collectForLlmDerivation(testCaseId, action, result) {
    if (this.detectedFramework === "cucumber") return;
    if (this.reporterOptions.captureSteps === false) return;
    const eligible = action === "created" || this.reporterOptions.overwriteSteps === true;
    if (!eligible) return;
    this.llmDerivationCases.set(testCaseId, {
      testCaseId,
      name: result.testName,
      className: result.suiteName || null,
      failure: result.errorMessage || null,
      systemOut: null,
      ...result.commands && result.commands.length > 0 ? { commands: result.commands } : {}
    });
  }
  /**
   * Send the single batched LLM step-derivation request for the non-Cucumber
   * cases collected this run. Called once at onRunnerEnd. Provider-gated +
   * inert server-side when no LLM provider is configured; wrapped so a failure
   * never affects the run.
   */
  async requestLlmDerivation() {
    if (this.llmDerivationCases.size === 0) return;
    if (!this.state.testRunId || !this.reporterOptions.projectId) return;
    const cases = [...this.llmDerivationCases.values()];
    this.llmDerivationCases.clear();
    try {
      const { enqueued } = await this.client.requestStepDerivation({
        projectId: this.reporterOptions.projectId,
        testRunId: this.state.testRunId,
        overwrite: this.reporterOptions.overwriteSteps === true,
        cases
      });
      if (enqueued) {
        this.log(
          `Requested AI step derivation for ${cases.length} low-structure case(s).`
        );
      }
    } catch (error) {
      this.logError("Failed to request AI step derivation", error);
    }
  }
  /**
   * Write derived case Steps for a case (ported from the Playwright reporter).
   * Dedups in-flight writes per case id; when `replace` is set, soft-deletes
   * existing steps first and SKIPS the create if the delete fails (never-clobber
   * guard, CORE-01). Passes `CaseStepRow[]` directly to `createSteps` so the
   * mapper's `expectedResult` is preserved (D-06).
   */
  writeCaseSteps(testCaseId, caseStepRows, replace) {
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
        const sharedState = readSharedState(this.reporterOptions.projectId);
        if (sharedState) {
          if (sharedState.managedByService) {
            this.state.testRunId = sharedState.testRunId;
            this.state.testSuiteId = sharedState.testSuiteId;
            this.managedByService = true;
            this.log(`Using service-managed test run: ${sharedState.testRunId}`);
          } else {
            this.state.testRunId = sharedState.testRunId;
            this.state.testSuiteId = sharedState.testSuiteId;
            this.log(`Using shared test run from file: ${sharedState.testRunId}`);
            if (sharedState.activeWorkers === 0) {
              this.log("Previous test run completed (activeWorkers=0), starting fresh");
              deleteSharedState(this.reporterOptions.projectId);
              this.state.testRunId = void 0;
              this.state.testSuiteId = void 0;
            } else {
              try {
                const testRun = await this.client.getTestRun(this.state.testRunId);
                if (testRun.isDeleted) {
                  this.log(`Shared test run ${testRun.id} is deleted, starting fresh`);
                  this.state.testRunId = void 0;
                  this.state.testSuiteId = void 0;
                  deleteSharedState(this.reporterOptions.projectId);
                } else if (testRun.isCompleted) {
                  this.log(`Shared test run ${testRun.id} is already completed, starting fresh`);
                  this.state.testRunId = void 0;
                  this.state.testSuiteId = void 0;
                  deleteSharedState(this.reporterOptions.projectId);
                } else {
                  this.log(`Validated shared test run: ${testRun.name} (ID: ${testRun.id})`);
                  incrementWorkerCount(this.reporterOptions.projectId);
                }
              } catch {
                this.log("Shared test run no longer exists, will create new one");
                this.state.testRunId = void 0;
                this.state.testSuiteId = void 0;
                deleteSharedState(this.reporterOptions.projectId);
              }
            }
          }
        }
      }
      if (!this.state.testRunId && !this.managedByService) {
        if (this.reporterOptions.oneReport) {
          await this.createTestRun();
          this.log(`Created test run with ID: ${this.state.testRunId}`);
          const finalState = writeSharedStateIfAbsent(this.reporterOptions.projectId, {
            testRunId: this.state.testRunId,
            testSuiteId: this.state.testSuiteId,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            activeWorkers: 1
          });
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
    if (this.reporterOptions.oneReport) {
      const sharedState = readSharedState(this.reporterOptions.projectId);
      if (sharedState?.testSuiteId) {
        this.state.testSuiteId = sharedState.testSuiteId;
        this.log("Using shared JUnit test suite from file:", sharedState.testSuiteId);
        return;
      }
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
      const finalState = writeSharedStateIfAbsent(this.reporterOptions.projectId, {
        testRunId: this.state.testRunId,
        testSuiteId: this.state.testSuiteId,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        activeWorkers: 1
      });
      if (finalState && finalState.testSuiteId !== this.state.testSuiteId) {
        this.log(`Another worker created test suite first, switching from ${this.state.testSuiteId} to ${finalState.testSuiteId}`);
        this.state.testSuiteId = finalState.testSuiteId;
      }
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
   * Extract the custom-field identifier from a test title using
   * `matchByCustomField.idPattern` (default `/^(\d+)/`). Returns the first
   * capturing group, or the whole match when the pattern has no group. The
   * value is returned as a string; the API client matches it against both the
   * numeric and string forms of the stored value. Returns undefined when the
   * pattern doesn't match. Independent of `parseCaseIds`.
   */
  parseCustomFieldId(title) {
    const cfg = this.reporterOptions.matchByCustomField;
    if (!cfg) return void 0;
    const pattern = cfg.idPattern ?? /^(\d+)/;
    const source = typeof pattern === "string" ? pattern : pattern.source;
    const flags = typeof pattern === "string" ? "" : pattern.flags.replace("g", "");
    const regex = new RegExp(source, flags);
    const match = regex.exec(title);
    if (!match) return void 0;
    const captured = match.slice(1).find((g) => g != null && g !== "") ?? match[0];
    return captured != null && captured !== "" ? captured : void 0;
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
  async resolveCaseByCustomField(result) {
    const cfg = this.reporterOptions.matchByCustomField;
    if (!cfg) return void 0;
    const value = this.parseCustomFieldId(result.originalTitle);
    if (value === void 0) {
      this.log("matchByCustomField: no id parsed from title:", result.originalTitle);
      return void 0;
    }
    const cacheKey = `${cfg.fieldName}::${value}`;
    if (this.state.customFieldCaseMap.has(cacheKey)) {
      return this.state.customFieldCaseMap.get(cacheKey) ?? void 0;
    }
    try {
      const match = await this.client.findTestCaseByCustomField({
        projectId: this.reporterOptions.projectId,
        fieldName: cfg.fieldName,
        value
      });
      if (match) {
        this.state.customFieldCaseMap.set(cacheKey, match.id);
        this.log(`matchByCustomField: matched case ${match.id} via ${cfg.fieldName}=${value}`);
        await this.ensureCaseAutomated(match.id, match.automated);
        return match.id;
      }
      this.state.customFieldCaseMap.set(cacheKey, null);
      this.log(`matchByCustomField: no case with ${cfg.fieldName}=${value}; falling through`);
      return void 0;
    } catch (error) {
      this.logError(`matchByCustomField lookup failed for ${cfg.fieldName}=${value}; falling through`, error);
      return void 0;
    }
  }
  /**
   * Flip a matched case to `automated: true` when it isn't already, so a case
   * that started manual but now receives automated results reflects that in
   * TestPlanIt. Skips the write when the case is already automated (no
   * redundant API call per run) and never throws — a failed update logs and is
   * swallowed so it can't abort reporting the result.
   */
  async ensureCaseAutomated(caseId, currentAutomated) {
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
    if (this.detectedFramework && this.detectedFramework !== "cucumber" && this.reporterOptions.captureSteps !== false && !this.cucumberStepNoticeLogged) {
      this.cucumberStepNoticeLogged = true;
      this.log(
        `captureSteps only applies to Cucumber scenarios; step capture is unavailable for framework "${this.detectedFramework}".`
      );
    }
  }
  onSuiteStart(suite) {
    if (suite.title) {
      this.currentSuite.push(suite.title);
      this.log("Suite started:", this.getFullSuiteName());
    }
    if (suite.type === "scenario" && this.detectedFramework === "cucumber") {
      this.currentScenarioUid = suite.uid;
      this.pendingScenarioSteps.set(suite.uid, []);
      const scenarioTitle = (suite.title || "").replace(/^Scenario(?: Outline)?:\s*/, "").trim();
      this.currentScenarioPlan = {
        title: scenarioTitle,
        // Feature path WITHOUT this scenario (currentSuite already includes it).
        suiteName: this.currentSuite.slice(0, -1).join(" > "),
        suitePath: this.currentSuite.slice(0, -1),
        cid: suite.cid ?? "",
        status: "passed",
        startedAt: suite.start ? new Date(suite.start) : /* @__PURE__ */ new Date()
      };
    }
  }
  onSuiteEnd(suite) {
    if (suite.type === "scenario" && this.detectedFramework === "cucumber" && this.currentScenarioPlan) {
      const plan = this.currentScenarioPlan;
      const stepTitles = this.pendingScenarioSteps.get(suite.uid) ?? [];
      this.pendingScenarioSteps.delete(suite.uid);
      this.currentScenarioUid = null;
      this.currentScenarioPlan = null;
      const { caseIds, cleanTitle } = this.parseCaseIds(plan.title);
      const fullTitle = plan.suiteName ? `${plan.suiteName} > ${cleanTitle}` : cleanTitle;
      const result = {
        caseId: caseIds[0],
        suiteName: plan.suiteName,
        suitePath: plan.suitePath,
        testName: cleanTitle,
        fullTitle,
        originalTitle: plan.title,
        status: plan.status,
        duration: 0,
        errorMessage: plan.error?.message,
        stackTrace: this.reporterOptions.includeStackTrace ? plan.error?.stack : void 0,
        startedAt: plan.startedAt,
        finishedAt: /* @__PURE__ */ new Date(),
        browser: this.state.capabilities?.browserName,
        platform: this.state.capabilities?.platformName || process.platform,
        screenshots: [],
        retryAttempt: 0,
        uid: `${plan.cid}_${fullTitle}`,
        specFile: this.currentSpec,
        cucumberStepTitles: stepTitles
      };
      this.state.results.set(result.uid, result);
      this.trackOperation(this.reportResult(result, caseIds));
    }
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
    if (!this.testCommands.has(this.currentTestUid)) {
      this.testCommands.set(this.currentTestUid, []);
    }
  }
  /**
   * Capture the ordered low-level automation commands a test runs. Fed to AI
   * step derivation (non-Cucumber) so the steps mirror what the test actually
   * did. Cheap no-op outside a test / when nothing is being captured.
   */
  onBeforeCommand(commandArgs) {
    const uid = this.currentTestUid;
    if (!uid) return;
    const list = this.testCommands.get(uid);
    if (!list || list.length >= _TestPlanItReporter.MAX_COMMANDS_PER_TEST) return;
    const formatted = this.formatCommand(commandArgs);
    if (formatted) list.push(formatted);
  }
  /**
   * Render a WebdriverIO command into a compact one-line string for the LLM,
   * e.g. `navigateTo {"url":"https://app/login"}` or `elementSendKeys {"text":"a@b.com"}`.
   * Returns null for commands with no useful signal.
   */
  formatCommand(commandArgs) {
    const name = commandArgs.command || commandArgs.endpoint || commandArgs.method;
    if (!name) return null;
    let body = "";
    if (commandArgs.body !== void 0 && commandArgs.body !== null) {
      try {
        const json = JSON.stringify(commandArgs.body);
        if (json && json !== "{}" && json !== "null") {
          body = ` ${json.length > 300 ? `${json.slice(0, 300)}\u2026` : json}`;
        }
      } catch {
      }
    }
    return `${name}${body}`;
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
    if (this.detectedFramework === "cucumber" && this.currentScenarioUid !== null) {
      this.pendingScenarioSteps.get(this.currentScenarioUid)?.push(test.title);
      if (this.currentScenarioPlan) {
        if (status === "failed" && this.currentScenarioPlan.status !== "failed") {
          this.currentScenarioPlan.status = "failed";
          this.currentScenarioPlan.error = test.error;
        } else if (status === "skipped" && this.currentScenarioPlan.status === "passed") {
          this.currentScenarioPlan.status = "skipped";
        }
      }
      return;
    }
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
      commandOutput,
      commands: this.testCommands.get(uid)
    };
    this.testCommands.delete(uid);
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
      if (caseIds.length === 0 && !this.reporterOptions.autoCreateTestCases && !this.reporterOptions.matchByCustomField) {
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
        if (this.reporterOptions.overwriteSteps) {
          await this.writeScenarioSteps(caseIds[0], "found", result);
        }
        this.collectForLlmDerivation(caseIds[0], "found", result);
      }
      if (repositoryCaseId === void 0 && this.reporterOptions.matchByCustomField) {
        const matchedId = await this.resolveCaseByCustomField(result);
        if (matchedId !== void 0) {
          repositoryCaseId = matchedId;
          this.state.stats.testCasesFound++;
          this.log("DEBUG: Attaching to case matched by custom field:", repositoryCaseId);
          if (this.reporterOptions.overwriteSteps) {
            await this.writeScenarioSteps(matchedId, "found", result);
          }
          this.collectForLlmDerivation(matchedId, "found", result);
        }
      }
      if (repositoryCaseId === void 0 && this.reporterOptions.autoCreateTestCases) {
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
          await this.writeScenarioSteps(testCase.id, action, result);
          this.collectForLlmDerivation(testCase.id, action, result);
        }
      }
      if (!repositoryCaseId) {
        this.log("No repository case ID, skipping result");
        return;
      }
      const runCaseKey = `${this.state.testRunId}_${repositoryCaseId}`;
      if (!this.state.testRunCaseMap.has(runCaseKey)) {
        const testRunCase = await this.client.findOrAddTestCaseToRun({
          testRunId: this.state.testRunId,
          repositoryCaseId
        });
        this.state.testRunCaseMap.set(runCaseKey, testRunCase.id);
        this.log("Added case to run:", testRunCase.id);
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
      if (result.status === "failed") {
        this.state.stats.resultsFailed++;
      } else if (result.status === "skipped") {
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
    await this.requestLlmDerivation();
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
    if (this.managedByService) {
      this.log("Skipping test run completion (managed by TestPlanItService)");
    } else if (this.reporterOptions.completeRunOnFinish) {
      if (this.reporterOptions.oneReport) {
        const isLastWorker = decrementWorkerCount(this.reporterOptions.projectId);
        if (isLastWorker) {
          const completeRunOp = (async () => {
            try {
              await this.client.completeTestRun(this.state.testRunId, this.reporterOptions.projectId);
              this.log("Test run completed (last worker):", this.state.testRunId);
              deleteSharedState(this.reporterOptions.projectId);
            } catch (error) {
              this.logError("Failed to complete test run:", error);
            }
          })();
          this.trackOperation(completeRunOp);
          await completeRunOp;
        } else {
          this.log("Skipping test run completion (waiting for other workers to finish)");
        }
      } else {
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
      }
    } else if (this.reporterOptions.oneReport) {
      decrementWorkerCount(this.reporterOptions.projectId);
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
var TestPlanItService = class {
  options;
  client;
  verbose;
  testRunId;
  testSuiteId;
  constructor(serviceOptions) {
    if (!serviceOptions.domain) {
      throw new Error("TestPlanIt service: domain is required");
    }
    if (!serviceOptions.apiToken) {
      throw new Error("TestPlanIt service: apiToken is required");
    }
    if (!serviceOptions.projectId) {
      throw new Error("TestPlanIt service: projectId is required");
    }
    this.options = {
      completeRunOnFinish: true,
      runName: "Automated Tests - {date} {time}",
      testRunType: "MOCHA",
      timeout: 3e4,
      maxRetries: 3,
      verbose: false,
      ...serviceOptions
    };
    this.verbose = this.options.verbose ?? false;
    this.client = new api.TestPlanItClient({
      baseUrl: this.options.domain,
      apiToken: this.options.apiToken,
      timeout: this.options.timeout,
      maxRetries: this.options.maxRetries
    });
  }
  /**
   * Log a message if verbose mode is enabled
   */
  log(message, ...args) {
    if (this.verbose) {
      console.log(`[TestPlanIt Service] ${message}`, ...args);
    }
  }
  /**
   * Log an error (always logs, not just in verbose mode)
   */
  logError(message, error) {
    const errorMsg = error instanceof Error ? error.message : String(error ?? "");
    console.error(`[TestPlanIt Service] ERROR: ${message}`, errorMsg);
  }
  /**
   * Format run name with available placeholders.
   * Note: {browser}, {spec}, and {suite} are NOT available in the service context
   * since it runs before any workers start.
   */
  formatRunName(template) {
    const now = /* @__PURE__ */ new Date();
    const date = now.toISOString().split("T")[0];
    const time = now.toTimeString().split(" ")[0];
    const platform = process.platform;
    return template.replace("{date}", date).replace("{time}", time).replace("{platform}", platform).replace("{browser}", "unknown").replace("{spec}", "unknown").replace("{suite}", "Tests");
  }
  /**
   * Resolve string option IDs to numeric IDs using the API client.
   */
  async resolveIds() {
    const projectId = this.options.projectId;
    const resolved = {};
    if (typeof this.options.configId === "string") {
      const config = await this.client.findConfigurationByName(projectId, this.options.configId);
      if (!config) {
        throw new Error(`Configuration not found: "${this.options.configId}"`);
      }
      resolved.configId = config.id;
      this.log(`Resolved configuration "${this.options.configId}" -> ${config.id}`);
    } else if (typeof this.options.configId === "number") {
      resolved.configId = this.options.configId;
    }
    if (typeof this.options.milestoneId === "string") {
      const milestone = await this.client.findMilestoneByName(projectId, this.options.milestoneId);
      if (!milestone) {
        throw new Error(`Milestone not found: "${this.options.milestoneId}"`);
      }
      resolved.milestoneId = milestone.id;
      this.log(`Resolved milestone "${this.options.milestoneId}" -> ${milestone.id}`);
    } else if (typeof this.options.milestoneId === "number") {
      resolved.milestoneId = this.options.milestoneId;
    }
    if (typeof this.options.stateId === "string") {
      const state = await this.client.findWorkflowStateByName(projectId, this.options.stateId);
      if (!state) {
        throw new Error(`Workflow state not found: "${this.options.stateId}"`);
      }
      resolved.stateId = state.id;
      this.log(`Resolved workflow state "${this.options.stateId}" -> ${state.id}`);
    } else if (typeof this.options.stateId === "number") {
      resolved.stateId = this.options.stateId;
    }
    if (this.options.tagIds && this.options.tagIds.length > 0) {
      resolved.tagIds = await this.client.resolveTagIds(projectId, this.options.tagIds);
      this.log(`Resolved tags: ${resolved.tagIds.join(", ")}`);
    }
    return resolved;
  }
  /**
   * onPrepare - Runs once in the main process before any workers start.
   *
   * Creates the test run and JUnit test suite, then writes shared state
   * so all worker reporters can find and use the pre-created run.
   */
  async onPrepare() {
    this.log("Preparing test run...");
    this.log(`  Domain: ${this.options.domain}`);
    this.log(`  Project ID: ${this.options.projectId}`);
    try {
      deleteSharedState(this.options.projectId);
      const resolved = await this.resolveIds();
      const runName = this.formatRunName(this.options.runName ?? "Automated Tests - {date} {time}");
      this.log(`Creating test run: "${runName}" (type: ${this.options.testRunType})`);
      const testRun = await this.client.createTestRun({
        projectId: this.options.projectId,
        name: runName,
        testRunType: this.options.testRunType,
        configId: resolved.configId,
        milestoneId: resolved.milestoneId,
        stateId: resolved.stateId,
        tagIds: resolved.tagIds
      });
      this.testRunId = testRun.id;
      this.log(`Created test run with ID: ${this.testRunId}`);
      this.log("Creating JUnit test suite...");
      const testSuite = await this.client.createJUnitTestSuite({
        testRunId: this.testRunId,
        name: runName,
        time: 0,
        tests: 0,
        failures: 0,
        errors: 0,
        skipped: 0
      });
      this.testSuiteId = testSuite.id;
      this.log(`Created JUnit test suite with ID: ${this.testSuiteId}`);
      const sharedState = {
        testRunId: this.testRunId,
        testSuiteId: this.testSuiteId,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        activeWorkers: 0,
        // Not used in service-managed mode
        managedByService: true
      };
      writeSharedState(this.options.projectId, sharedState);
      this.log("Wrote shared state file for workers");
      console.log(`[TestPlanIt Service] Test run created: "${runName}" (ID: ${this.testRunId})`);
    } catch (error) {
      this.logError("Failed to prepare test run:", error);
      deleteSharedState(this.options.projectId);
      throw error;
    }
  }
  /**
   * afterTest - Runs in each worker process after each test.
   *
   * Captures a screenshot on test failure when `captureScreenshots` is enabled.
   * The screenshot is intercepted and uploaded by the reporter automatically.
   */
  async afterTest(_test, _context, result) {
    if (!this.options.captureScreenshots || result.passed) {
      return;
    }
    try {
      await globalThis.browser?.takeScreenshot();
    } catch (error) {
      this.log("Failed to capture screenshot:", error);
    }
  }
  /**
   * onComplete - Runs once in the main process after all workers finish.
   *
   * Completes the test run and cleans up the shared state file.
   */
  async onComplete(exitCode) {
    this.log(`All workers finished (exit code: ${exitCode})`);
    try {
      if (this.testRunId && this.options.completeRunOnFinish) {
        this.log(`Completing test run ${this.testRunId}...`);
        await this.client.completeTestRun(this.testRunId, this.options.projectId);
        this.log("Test run completed successfully");
      }
      if (this.testRunId) {
        console.log("\n[TestPlanIt Service] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
        console.log(`[TestPlanIt Service]   Test Run ID: ${this.testRunId}`);
        if (this.options.completeRunOnFinish) {
          console.log("[TestPlanIt Service]   Status: Completed");
        }
        console.log(`[TestPlanIt Service]   View: ${this.options.domain}/projects/runs/${this.options.projectId}/${this.testRunId}`);
        console.log("[TestPlanIt Service] \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
      }
    } catch (error) {
      this.logError("Failed to complete test run:", error);
    } finally {
      deleteSharedState(this.options.projectId);
      this.log("Cleaned up shared state file");
    }
  }
};

Object.defineProperty(exports, "TestPlanItClient", {
  enumerable: true,
  get: function () { return api.TestPlanItClient; }
});
Object.defineProperty(exports, "TestPlanItError", {
  enumerable: true,
  get: function () { return api.TestPlanItError; }
});
exports.TestPlanItReporter = TestPlanItReporter;
exports.TestPlanItService = TestPlanItService;
exports.default = TestPlanItReporter;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map